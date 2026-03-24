# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

TypeScript monorepo of oRPC plugin adapters. Uses pnpm workspaces with tsup for building. Current packages: `orpc-worker-pool` (offloads oRPC procedures to a Node.js worker thread pool).

## Commands

Run from the repo root — all scripts use `pnpm -r` to execute across packages:

```bash
pnpm build       # Build all packages
pnpm dev         # Watch mode for all packages
pnpm test        # Run tests across all packages
pnpm typecheck   # Type-check all packages
```

To run a command in a single package:
```bash
pnpm --filter orpc-worker-pool build
pnpm --filter orpc-worker-pool test
```

## Monorepo Structure

Each package under `packages/` is an independent publishable unit with its own `package.json`, `tsconfig.json`, and `tsup.config.ts`. They extend `tsconfig.base.json` at the root.

**tsconfig.base.json** settings that matter:
- Target: ES2020, Module: ESNext, moduleResolution: bundler
- Strict mode enabled, declaration files emitted

## orpc-worker-pool

Offloads marked oRPC procedures to a pool of Node.js worker threads. Key files:

- `worker-offload-plugin.ts` — `WorkerOffloadPlugin` class; intercepts procedures with `meta.offload: true` and dispatches them to the pool
- `worker-thread.ts` — runs inside each worker; resolves and calls the procedure, serializes results/errors back via `postMessage`
- `worker-offload-plugin-error.ts` — `WorkerOffloadPluginError` (extends `Error`); used for all plugin-level errors. Has a static `WorkerOffloadPluginError.from(err)` factory that wraps any thrown value (including `ORPCError`) into a plugin error with `defined` and `code` properties

**Important:** `postMessage` uses structured clone, which drops custom properties (`defined`, `code`) from `WorkerOffloadPluginError` when crossing the thread boundary. Errors received from the worker arrive as plain `Error` instances with only their `message` preserved.

## oRPC Integration Pattern

Plugins integrate with the oRPC ecosystem (`@orpc/server`, `@orpc/client`, `@orpc/contract`, `@orpc/shared`) at version 1.x. New packages should declare these as `peerDependencies` to avoid version conflicts with the consumer's oRPC installation.
