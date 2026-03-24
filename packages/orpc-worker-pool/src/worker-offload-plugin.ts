import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { WorkerOffloadPluginError } from './worker-offload-plugin-error'

export type WorkerOffloadPluginOptions = {
    pool: number;
    routerPath: string;
    queueLimit: number;
}

interface Task {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    message?: { procedurePath: string[]; input: unknown };
}

type DispatchParams = {
    worker: Worker;
    task: Task;
}

export class WorkerOffloadPlugin {
    private workers: Worker[] = []
    private idleWorkers: Worker[] = []
    private pendingTasks = new Map<number, Task>();
    private workerTasks = new Map<Worker, Set<number>>();
    private config: WorkerOffloadPluginOptions;
    private callId = 0;
    private queue: Array<Task>


    constructor(o: Partial<WorkerOffloadPluginOptions>) {
        if (!o.routerPath) {
            throw new WorkerOffloadPluginError('routerPath is required')
        }
        this.config = {
            pool: o.pool ?? 4,
            routerPath: o.routerPath,
            queueLimit: o.queueLimit ?? 100
        }
        this.queue = [];
        for (let i = 0; i < this.config.pool; i++) {
            this.spawnWorker();
        }
    }

    private spawnWorker() {
        const worker = new Worker(path.join(__dirname, 'worker-thread.js'), {
            workerData: {
                routerPath: this.config.routerPath,
            },
        });
        worker.on('message', ({ id, success, result, error }) => {
            const task = this.pendingTasks.get(id);
            if (!task) {
                return;
            }
            this.pendingTasks.delete(id);
            this.workerTasks.get(worker)?.delete(id);
            if (success) {
                task.resolve(result);
            } else {
                task.reject(error);
            }
            const nextTask = this.queue.shift();
            if (nextTask) {
                this.dispatch({
                    worker,
                    task: nextTask
                });
            } else {
                this.idleWorkers.push(worker);
            }
        })

        worker.on('error', (err) => {
            console.error('[orpc-worker-pool] Worker error:', err);

            // Reject all tasks that were in-flight on this worker
            const ownedIds = this.workerTasks.get(worker) ?? new Set<number>();
            for (const id of ownedIds) {
                const task = this.pendingTasks.get(id);
                if (task) {
                    this.pendingTasks.delete(id);
                    task.reject(new WorkerOffloadPluginError(`Worker crashed: ${err.message}`));
                }
            }
            this.workerTasks.delete(worker);

            this.workers = this.workers.filter(w => w !== worker);
            this.idleWorkers = this.idleWorkers.filter(w => w !== worker);

            this.spawnWorker();
        })

        this.workers.push(worker);
        this.workerTasks.set(worker, new Set());

        // Give queued tasks to this worker immediately, otherwise mark idle
        const nextTask = this.queue.shift();
        if (nextTask) {
            this.dispatch({ worker, task: nextTask });
        } else {
            this.idleWorkers.push(worker);
        }
    }

    private dispatch({
        worker,
        task
    }: DispatchParams) {
        const id = this.callId++;
        this.pendingTasks.set(id, task);
        this.workerTasks.get(worker)?.add(id);
        worker.postMessage({ ...task.message, id })
    }

    async terminate(): Promise<void> {
        for (const task of this.queue) {
            task.reject(new WorkerOffloadPluginError('Worker pool terminated'));
        }
        this.queue = [];

        for (const task of this.pendingTasks.values()) {
            task.reject(new WorkerOffloadPluginError('Worker pool terminated'));
        }
        this.pendingTasks.clear();
        this.workerTasks.clear();

        await Promise.all(this.workers.map(w => w.terminate()));
        this.workers = [];
        this.idleWorkers = [];
    }

    private offload(procedurePath: string[], input: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const message = { procedurePath, input };
            const task: Task = { resolve, reject, message };
            const idleWorker = this.idleWorkers.pop();

            if (idleWorker) {
                this.dispatch({
                    worker: idleWorker,
                    task
                });
            } else if (this.queue.length < this.config.queueLimit){
                this.queue.push(task);
            } else {
                reject(new WorkerOffloadPluginError('Worker pool queue is full'))
            }
        })
    }

    async intercept(options: { procedure: any; path: string[]; next: () => Promise<any>, input: unknown}) {
        const { procedure, path, next, input } = options;

        if (!procedure['~orpc'].meta?.offload) {
            return next();
        }

        return this.offload(path, input)
    }
}
