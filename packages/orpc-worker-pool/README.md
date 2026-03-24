# oRPC Worker Pool

An [oRPC](https://orpc.dev) plugin that offloads CPU-intensive procedures to a managed pool of Node.js worker threads, keeping your main thread responsive.

## Use Cases

Node.js runs JavaScript on a single thread. Any procedure that does heavy computation — image processing, data parsing, cryptography, report generation — will block the event loop and stall all other requests while it runs.

`orpc-worker-pool` solves this by routing marked procedures to a pool of worker threads that run in parallel. The main thread stays free to handle incoming requests while workers churn through the expensive work.

Good candidates for offloading:
- Image/video processing and transformation
- Large file parsing (CSV, XML, JSON)
- Cryptographic operations (hashing, encryption)
- Report generation or PDF rendering
- Any tight loop or CPU-bound algorithm

## Requirements

- Node.js >= 22
- `@orpc/server` ^1.13.0 (peer dependency)

## Installation

```bash
npm install @robiscoding/orpc-worker-pool
# or
pnpm add @robiscoding/orpc-worker-pool
```

## Getting Started

### 1. Mark procedures for offloading

Add `meta: { offload: true }` to any procedure you want to run in a worker thread:

```ts
// router.ts
import { os } from '@orpc/server'

export const router = {
  hashPassword: os
    .meta({ offload: true }) // set offload to true to run in worker thread
    .input(z.object({ password: z.string() }))
    .handler(async ({ input }) => {
      // This runs in a worker thread
      return expensiveHash(input.password)
    }),

  greet: os
    .input(z.object({ name: z.string() }))
    .handler(async ({ input }) => {
      // No offload meta — runs on the main thread as normal
      return `Hello, ${input.name}`
    }),
}
```

### 2. Register the plugin

Pass a `WorkerOffloadPlugin` instance to your oRPC server. The `routerPath` must point to the compiled JS file that exports your router. Worker threads load it fresh each time.

```ts
// server.ts
import { createServer } from '@orpc/server'
import { WorkerOffloadPlugin } from '@robiscoding/orpc-worker-pool'
import { router } from './router'
import { fileURLToPath } from 'url'
import path from 'path'

const plugin = new WorkerOffloadPlugin({
  routerPath: path.join(__dirname, 'router.js'), // path to the compiled router
  pool: 4,          // number of worker threads (default: 4)
  queueLimit: 100,  // max queued tasks before rejecting (default: 100); useful for adding backpressure
})

const handler = createServer(router, {
  plugins: [plugin],
})

// Shut down workers gracefully on exit
process.on('SIGTERM', () => plugin.terminate())
```

## Usage Guide

### Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `routerPath` | `string` | **required** | Absolute path to the compiled JS file exporting your router |
| `pool` | `number` | `4` | Number of worker threads to spawn |
| `queueLimit` | `number` | `100` | Max number of tasks that can be queued when all workers are busy |

### Error Handling

Errors thrown inside a worker are serialized across the thread boundary and wrapped in `WorkerOffloadPluginError`. Because `postMessage` uses structured clone, custom error properties are preserved via the `.defined` and `.code` fields.

- If the procedure threw an `ORPCError`, `.defined` is `true` and `.code` holds the error code.
- Otherwise `.defined` is `false` and only the message is preserved.

```ts
import { WorkerOffloadPluginError } from '@robiscoding/orpc-worker-pool'

try {
  await client.hashPassword({ password: '...' })
} catch (err) {
  if (err instanceof WorkerOffloadPluginError) {
    if (err.defined) {
      // A known ORPCError — err.code has the oRPC error code
      console.error('Procedure error:', err.code, err.message)
    } else {
      // An unexpected error from the worker
      console.error('Worker error:', err.message)
    }
  }
}
```

### Graceful Shutdown

Call `plugin.terminate()` before your process exits to drain in-flight tasks and shut down worker threads cleanly:

```ts
process.on('SIGTERM', async () => {
  await plugin.terminate()
  process.exit(0)
})
```

Any tasks still queued or in-flight when `terminate()` is called are immediately rejected with a `WorkerOffloadPluginError`.

## License

MIT
