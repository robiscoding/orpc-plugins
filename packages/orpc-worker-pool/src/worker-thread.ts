import { parentPort, workerData } from 'node:worker_threads'
import { ORPCError } from '@orpc/server'
import { WorkerOffloadPluginError } from './worker-offload-plugin-error'

const { router } = await import(workerData.routerPath)

function resolvePath(obj: any, path: string[]): any {
    return path.reduce((current, key) => current?.[key], obj)
}

parentPort!.on('message', async ({ id, procedurePath, input }) => {
    try {
        const procedure = resolvePath(router, procedurePath);

        if (!procedure) {
            throw new ORPCError('NOT_FOUND', {
                message: `Procedure ${procedurePath.join('.')} not found in worker`
            })
        }

        const result = await procedure['~orpc'].handler({ input, context: {}, path: procedurePath })
        parentPort!.postMessage({ id, success: true, result });
    } catch (err) {
        parentPort!.postMessage({ id, success: false, error: WorkerOffloadPluginError.from(err) });
    }
})