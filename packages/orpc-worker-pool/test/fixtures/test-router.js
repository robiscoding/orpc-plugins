import { ORPCError } from '@orpc/server'

export const router = {
    echo: {
        '~orpc': {
            handler: async ({ input }) => input,
        },
    },
    sleep: {
        '~orpc': {
            handler: async ({ input }) => {
                await new Promise(resolve => setTimeout(resolve, input.ms ?? 50))
                return 'done'
            },
        },
    },
    fail: {
        '~orpc': {
            handler: async () => {
                throw new Error('procedure failed')
            },
        },
    },
    failWithOrpcError: {
        '~orpc': {
            handler: async () => {
                throw new ORPCError('FORBIDDEN', { message: 'not allowed' })
            },
        },
    },
    crashWorker: {
        '~orpc': {
            // Returns a promise that never resolves, then throws an uncaught
            // exception to kill the worker while the task is still in-flight.
            handler: async () => new Promise(() => {
                setTimeout(() => { throw new Error('simulated worker crash') }, 20)
            }),
        },
    },
}
