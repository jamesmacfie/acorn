// vitest runs under system Node, but the app runs under Electron. better-sqlite3 and node-pty are
// native modules, and one compiled .node can only match a single ABI — so the test runner and the
// app can't share a build. `pnpm rebuild` is shadowed by the root "rebuild" script (which produces
// the Electron ABI via electron-rebuild), so this rebuilds the two modules for the CURRENT Node ABI
// directly. The `test` script runs it first; it's a no-op when better-sqlite3 already loads, so the
// inner test loop stays fast. Run `pnpm run rebuild` to switch back to the Electron ABI before
// `pnpm dev`.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

try {
  new (require('better-sqlite3'))(':memory:').close() // already on the Node ABI → nothing to do
  process.exit(0)
} catch {
  // wrong ABI (or never built) — fall through and rebuild
}

console.log(`Rebuilding native modules for Node ABI ${process.versions.modules}…`)
// Paths are the version-agnostic symlinks in this package's node_modules; `pnpm -C` follows them.
execFileSync('pnpm', ['-C', 'node_modules/better-sqlite3', 'run', 'build-release'], { stdio: 'inherit' })
execFileSync('pnpm', ['-C', 'node_modules/node-pty', 'exec', 'node-gyp', 'rebuild'], { stdio: 'inherit' })
