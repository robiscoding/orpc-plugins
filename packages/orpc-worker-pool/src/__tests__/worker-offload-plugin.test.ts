import { describe, it, expect, vi, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import nodePath from 'node:path'
const pkgRoot = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../..')
const routerPath = nodePath.join(pkgRoot, 'test/fixtures/test-router.js')

// Import from dist so __dirname inside the plugin resolves to dist/,
// where worker-thread.js lives after the build.
const { WorkerOffloadPlugin, WorkerOffloadPluginError } = await import(nodePath.join(pkgRoot, 'dist/index.js'))

const offloadProcedure = { '~orpc': { meta: { offload: true } } }
const normalProcedure = { '~orpc': { meta: {} } }

describe('WorkerOffloadPlugin', () => {
    let plugin: any

    afterEach(async () => {
        await plugin?.terminate()
        plugin = undefined
    })

    it('throws when routerPath is not provided', () => {
        expect(() => new WorkerOffloadPlugin({})).toThrow('routerPath is required')
    })

    it('calls next() when procedure does not have offload meta', async () => {
        plugin = new WorkerOffloadPlugin({ routerPath })
        const next = vi.fn().mockResolvedValue('next result')
        const result = await plugin.intercept({ procedure: normalProcedure, path: ['echo'], input: {}, next })
        expect(next).toHaveBeenCalled()
        expect(result).toBe('next result')
    })

    it('offloads and returns procedure result', async () => {
        plugin = new WorkerOffloadPlugin({ routerPath, pool: 1 })
        const result = await plugin.intercept({
            procedure: offloadProcedure,
            path: ['echo'],
            input: { hello: 'world' },
            next: () => Promise.resolve(),
        })
        expect(result).toEqual({ hello: 'world' })
    })

    it('rejects with TOO_MANY_REQUESTS when queue is full', async () => {
        plugin = new WorkerOffloadPlugin({ routerPath, pool: 1, queueLimit: 0 })
        plugin.intercept({ procedure: offloadProcedure, path: ['echo'], input: {}, next: () => Promise.resolve() }).catch(() => {})
        await expect(
            plugin.intercept({ procedure: offloadProcedure, path: ['echo'], input: {}, next: () => Promise.resolve() })
        ).rejects.toBeInstanceOf(WorkerOffloadPluginError)
    })

    it('executes queued tasks when a worker becomes free', async () => {
        plugin = new WorkerOffloadPlugin({ routerPath, pool: 1 })
        // Both fire simultaneously; second will be queued while worker handles first
        const [r1, r2] = await Promise.all([
            plugin.intercept({ procedure: offloadProcedure, path: ['sleep'], input: { ms: 50 }, next: () => Promise.resolve() }),
            plugin.intercept({ procedure: offloadProcedure, path: ['echo'], input: { queued: true }, next: () => Promise.resolve() }),
        ])
        expect(r1).toBe('done')
        expect(r2).toEqual({ queued: true })
    })

    it('propagates ORPCError thrown by a procedure', async () => {
        plugin = new WorkerOffloadPlugin({ routerPath, pool: 1 })
        await expect(
            plugin.intercept({ procedure: offloadProcedure, path: ['failWithOrpcError'], input: {}, next: () => Promise.resolve() })
        ).rejects.toThrow('not allowed')
    })

    it('propagates generic errors from a procedure as Error', async () => {
        plugin = new WorkerOffloadPlugin({ routerPath, pool: 1 })
        await expect(
            plugin.intercept({ procedure: offloadProcedure, path: ['fail'], input: {}, next: () => Promise.resolve() })
        ).rejects.toThrow('procedure failed')
    })

    it('rejects with NOT_FOUND when procedure path does not exist in worker', async () => {
        plugin = new WorkerOffloadPlugin({ routerPath, pool: 1 })
        await expect(
            plugin.intercept({ procedure: offloadProcedure, path: ['nonexistent'], input: {}, next: () => Promise.resolve() })
        ).rejects.toThrow('nonexistent not found in worker')
    })
})

describe('WorkerOffloadPlugin — worker crash recovery', () => {
    let plugin: any

    afterEach(async () => {
        await plugin?.terminate()
        plugin = undefined
    })

    it('rejects the in-flight task when the worker crashes', async () => {
        plugin = new WorkerOffloadPlugin({ routerPath, pool: 1 })
        await expect(
            plugin.intercept({ procedure: offloadProcedure, path: ['crashWorker'], input: {}, next: () => Promise.resolve() })
        ).rejects.toThrow('Worker crashed')
    })

    it('spawns a replacement worker and resumes normal operation after a crash', async () => {
        plugin = new WorkerOffloadPlugin({ routerPath, pool: 1 })
        await expect(
            plugin.intercept({ procedure: offloadProcedure, path: ['crashWorker'], input: {}, next: () => Promise.resolve() })
        ).rejects.toThrow()

        const result = await plugin.intercept({
            procedure: offloadProcedure,
            path: ['echo'],
            input: { after: 'crash' },
            next: () => Promise.resolve(),
        })
        expect(result).toEqual({ after: 'crash' })
    })

    it('processes queued tasks on the replacement worker after a crash', async () => {
        plugin = new WorkerOffloadPlugin({ routerPath, pool: 1 })

        const [crashed, queued] = await Promise.allSettled([
            plugin.intercept({ procedure: offloadProcedure, path: ['crashWorker'], input: {}, next: () => Promise.resolve() }),
            plugin.intercept({ procedure: offloadProcedure, path: ['echo'], input: { queued: true }, next: () => Promise.resolve() }),
        ])

        expect(crashed.status).toBe('rejected')
        expect(queued.status).toBe('fulfilled')
        expect((queued as PromiseFulfilledResult<unknown>).value).toEqual({ queued: true })
    })
})

describe('WorkerOffloadPlugin — terminate', () => {
    it('rejects in-flight tasks when terminated', async () => {
        const plugin = new WorkerOffloadPlugin({ routerPath, pool: 1 })
        const pending = plugin.intercept({
            procedure: offloadProcedure,
            path: ['sleep'],
            input: { ms: 60_000 },
            next: () => Promise.resolve(),
        })

        const assertion = expect(pending).rejects.toThrow('Worker pool terminated')
        await plugin.terminate()
        await assertion
    })

    it('rejects queued tasks when terminated', async () => {
        const plugin = new WorkerOffloadPlugin({ routerPath, pool: 1 })
        plugin.intercept({ procedure: offloadProcedure, path: ['sleep'], input: { ms: 60_000 }, next: () => Promise.resolve() }).catch(() => {})
        const queued = plugin.intercept({ procedure: offloadProcedure, path: ['echo'], input: {}, next: () => Promise.resolve() })
        const assertion = expect(queued).rejects.toThrow('Worker pool terminated')
        await plugin.terminate()
        await assertion
    })
})
