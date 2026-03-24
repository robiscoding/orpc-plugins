import { ORPCError } from '@orpc/server'

export class WorkerOffloadPluginError extends Error {
    readonly defined: boolean;
    readonly code?: string;

    constructor(message: string, options: { defined?: boolean; code?: string } = {}) {
        super(message);
        this.name = 'WorkerOffloadPluginError';
        this.defined = options.defined ?? false;
        this.code = options.code;
    }

    static from(err: unknown): WorkerOffloadPluginError {
        if (err instanceof ORPCError) {
            return new WorkerOffloadPluginError(err.message, { defined: true, code: err.code });
        }
        return new WorkerOffloadPluginError((err as Error).message ?? String(err));
    }
}
