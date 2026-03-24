---
name: code-review
description: >
  Comprehensive code review for a pnpm workspace monorepo
  project using Node 22, tsup for bundling, and vitest for testing. Use this skill whenever the user asks to review code, check a PR, audit a package, review their project structure, or asks if their tests are good enough. Also trigger when the user shares files and says things like "does this look right?", "can you review this?", "what am I missing?", "is this production-ready?", or pastes code and asks for feedback. This skill enforces integration test coverage as a hard requirement and applies opinionated best practices for the specific stack.
---

# Code Review Skill

You are performing a thorough code review. Your goal is to be a senior engineering partner — direct, specific, and actionable. Don't hedge; point out real problems.

## Stack Context

| Layer           | Tool                              |
| --------------- | --------------------------------- |
| Language        | TypeScript (strict mode expected) |
| Runtime         | Node 22 (use its native features) |
| Package manager | pnpm with workspaces              |
| Build           | tsup                              |
| Testing         | vitest                            |
| Repo structure  | Monorepo                          |

---

## Review Process

Follow this sequence every time. Do not skip sections.

### 0. Gather Context First

Before reviewing, understand:

- What is the package/module's **purpose**?
- Is this a **library** (consumed by other packages), a **service** (runs as a process), or a **CLI**?
- What **phase** is the code in? (exploratory, shipping, maintaining)

If the user hasn't told you, ask briefly — one question, then proceed with assumptions stated.

### 1. Project / Monorepo Structure

Read `package.json`, `pnpm-workspace.yaml`, and `tsconfig.json` at the root.

Check:

- [ ] `pnpm-workspace.yaml` defines `packages` globs correctly
- [ ] Root `package.json` has `"private": true`
- [ ] Each workspace package has its own `package.json` with correct `name` (scoped: `@scope/pkg-name`)
- [ ] `tsconfig.json` at root uses `composite: true` or project references if packages depend on each other
- [ ] Each package extends the root tsconfig: `"extends": "../../tsconfig.json"`
- [ ] `engines` field set to `{ "node": ">=22" }` where relevant
- [ ] No cross-package `require()` calls — only proper imports through declared workspace dependencies

**Common issues to flag:**

- Missing `"type": "module"` when using ESM
- Workspace packages that `import` each other without listing as a dependency in `package.json`
- Root-level `node_modules` hoisting causing phantom dependencies

---

### 2. TypeScript Strictness

Check `tsconfig.json` for the following flags. Flag any that are missing or disabled:

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true,
  "exactOptionalPropertyTypes": true,
  "verbatimModuleSyntax": true
}
```

In the code itself, look for:

- [ ] No `any` — suggest `unknown` + type narrowing, or a specific type
- [ ] No non-null assertions (`!`) without a comment explaining why it's safe
- [ ] `as` casts only where necessary and justified by a comment
- [ ] Enums: prefer `const enum` or string literal unions (avoid runtime enums in libraries)
- [ ] Return types explicitly declared on exported functions
- [ ] `satisfies` operator used where appropriate (validates shape without widening)

---

### 3. tsup Build Configuration

Read `tsup.config.ts` (or the `tsup` field in `package.json`).

Check:

- [ ] `entry` correctly points to source entrypoints
- [ ] `format: ['esm', 'cjs']` (or justified single-format choice)
- [ ] `dts: true` — type declarations must be emitted for libraries
- [ ] `sourcemap: true` for debuggability
- [ ] `clean: true` to avoid stale artifacts
- [ ] `splitting: false` unless explicitly needed (simpler output)
- [ ] `treeshake: true` for libraries to reduce consumer bundle size
- [ ] `package.json` `exports` field matches tsup output paths exactly

**Check `package.json` exports alignment:**

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "files": ["dist"]
}
```

Flag if `files` is missing — this means unpublished source leaks into npm packages.

---

### 4. Testing — The Core Section

> **Philosophy**: For a dev, tests are your safety net AND your documentation. Integration tests are non-negotiable. Unit tests are valuable but secondary.

Read the full contents of every `*.test.ts` and `*.spec.ts` file.

#### 4a. vitest Configuration

Check `vitest.config.ts`:

- [ ] `environment` set correctly (`node` for Node services, `jsdom`/`happy-dom` for browser code)
- [ ] `coverage` configured with thresholds:
  ```ts
  coverage: {
    provider: 'v8',
    thresholds: {
      lines: 80,
      functions: 80,
      branches: 70,
    }
  }
  ```
- [ ] `testTimeout` set (suggest `10_000` for integration tests, `5_000` default)
- [ ] `globalSetup` / `setupFiles` used for shared test infrastructure (DB connections, test servers)

#### 4b. Integration Test Coverage (Hard Requirement)

Integration tests must exist and cover **real behavior across module/system boundaries**.

Minimum integration test checklist — flag anything missing:

**For any HTTP server/API:**

- [ ] Happy path for each route
- [ ] Error path for each route (4xx and 5xx)
- [ ] Authentication/authorization behavior
- [ ] Input validation rejection
- [ ] Real HTTP client (use `fetch`, not mocked) against the actual server started in `beforeAll`

**For any database interaction:**

- [ ] Test uses a real DB (SQLite in-memory, Postgres via testcontainer, etc.) — NOT mocked
- [ ] Migrations run before tests
- [ ] Data isolation per test (transactions rolled back, or fresh schema per suite)
- [ ] CRUD lifecycle tested end-to-end

**For any queue/event system:**

- [ ] Message produced and consumed successfully in a real cycle
- [ ] Dead-letter / error handling path tested

**For libraries:**

- [ ] Integration test that imports the _built_ output (`dist/`) not just the source — catches build issues
- [ ] Tests the public API surface, not internal implementation

**For CLIs:**

- [ ] Tests spawn the actual binary via `execa` or `child_process`
- [ ] Tests stdin/stdout/stderr/exit code

**Example pattern — HTTP integration test with vitest:**

```ts
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createServer } from "../src/server.js";

describe("POST /users", () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    server = await createServer({ port: 0 }); // random port
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it("creates a user and returns 201", async () => {
    const res = await fetch(`${baseUrl}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: expect.any(String), name: "Alice" });
  });

  it("returns 400 for missing email", async () => {
    const res = await fetch(`${baseUrl}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(res.status).toBe(400);
  });
});
```

#### 4c. Unit Test Quality

- [ ] Tests describe behavior, not implementation (`it('returns empty array when no items')`, not `it('calls filter()')`)
- [ ] No `expect(true).toBe(true)` or vacuous assertions
- [ ] No tests that only test mocks (if everything is mocked, you're testing nothing)
- [ ] `vi.mock()` used sparingly — only for I/O boundaries (network, disk, time)
- [ ] `vi.useFakeTimers()` used for time-dependent logic instead of `setTimeout` in tests
- [ ] Each `describe` block has a clear subject; each `it` has one behavior being verified
- [ ] No test file over ~200 lines without justification — split by concern

#### 4d. Test Coverage Gaps

After reading tests, identify:

1. **Uncovered happy paths** — main flows with no test
2. **Uncovered error paths** — what happens when external calls fail?
3. **Edge cases** — empty inputs, null, very large inputs, concurrent calls
4. **Race conditions** — async code that could interleave
5. **Missing integration boundary tests** — modules that interact but are only unit-tested in isolation

---

### 5. Node 22 Usage

Flag outdated patterns. Node 22 supports:

- [ ] `fetch` natively — no need for `node-fetch` or `axios` for simple cases
- [ ] `--experimental-strip-types` (or `tsx`) for running TS directly in dev
- [ ] `URL` and `URLSearchParams` globally — no import needed
- [ ] `fs/promises` — flag `fs.readFileSync` in async contexts
- [ ] `crypto.randomUUID()` — no need for `uuid` package
- [ ] `structuredClone()` — no need for `lodash/cloneDeep` for plain objects
- [ ] Top-level `await` in ESM modules
- [ ] `AbortController` / `AbortSignal` for cancellation
- [ ] Native `assert` module with `assert/strict`

---

### 6. Code Quality & Architecture

#### Error Handling

- [ ] Async functions have try/catch or return `Result<T, E>` types
- [ ] Errors are typed — custom error classes or discriminated union results
- [ ] No swallowed errors (`catch (e) {}`)
- [ ] `Promise.allSettled` used when you need all results regardless of failure
- [ ] Unhandled promise rejections: is `process.on('unhandledRejection')` handled at the entry point?

**Prefer explicit Result types over thrown errors for expected failures:**

```ts
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
```

#### Async Patterns

- [ ] No `async` functions that never `await` (remove the keyword)
- [ ] No `await` inside loops where `Promise.all` would work
- [ ] No floating promises (always `await` or handle `.catch()`)

#### Module Design

- [ ] Each module has a single clear responsibility
- [ ] No circular imports between workspace packages
- [ ] Barrel files (`index.ts`) re-export only intentional public API
- [ ] Internal helpers not re-exported from barrel

#### Security

- [ ] No secrets or API keys in source — use `process.env` + `.env` files
- [ ] `.env` files in `.gitignore`
- [ ] Input sanitization for anything touching a filesystem path (path traversal)
- [ ] Dependency audit: run `pnpm audit` — flag any high/critical severity

---

### 7. Developer Experience

- [ ] `package.json` scripts cover: `build`, `test`, `test:integration`, `lint`, `typecheck`, `dev`
- [ ] `typecheck` script (`tsc --noEmit`) is separate from `build`
- [ ] `.npmrc` has `shamefully-hoist=false` (default for pnpm) and `strict-peer-dependencies=true`
- [ ] `vitest` `watch` mode works for inner-loop development
- [ ] Readme documents: how to install, how to run tests, how to build

---

## Output Format

Structure your review as:

```
## Code Review: [package or feature name]

### 🔴 Must Fix (blocks correctness or safety)
- ...

### 🟡 Should Fix (best practice, will cause problems later)
- ...

### 🟢 Nice to Have (polish, DX improvements)
- ...

### ✅ What's Done Well
- ...

### 📋 Integration Test Coverage Summary
[Table or list: each integration boundary → covered / missing / partial]

### 🎯 Top 3 Next Actions
1.
2.
3.
```

Be specific: include file names, line references, and code snippets showing the fix. Don't just say "add error handling" — show what the error handling should look like.
