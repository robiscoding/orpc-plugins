import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export function setup() {
    const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    execSync('pnpm build', { cwd: pkgRoot, stdio: 'inherit' })
}
