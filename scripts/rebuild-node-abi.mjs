// vitest runs under system Node, but the app runs under Electron. better-sqlite3 and node-pty are
// native modules, and one compiled .node can only match a single ABI — so the test runner and the
// app can't share a build. `pnpm rebuild` is shadowed by the root "rebuild" script (which produces
// the Electron ABI via electron-rebuild), so this rebuilds the two modules for the CURRENT Node ABI
// directly. It's a no-op when better-sqlite3 already loads, so the inner test loop stays fast. Run
// `pnpm run rebuild` to switch back to the Electron ABI before `pnpm dev`.
//
// Lives at the repo ROOT and runs ONCE before `turbo run test`, never as a per-package step. Every
// workspace package resolves to the same physical better-sqlite3 in the pnpm store, so a package
// rebuilding it while a sibling's tests are loading it is a race that fails the sibling.
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
// Resolve the real package directories through Node rather than assuming a node_modules layout:
// under pnpm only the declaring package has the symlink, and that package is no longer this one.
import { dirname } from 'node:path'
const dirOf = (pkg) => dirname(require.resolve(`${pkg}/package.json`))
execFileSync('pnpm', ['-C', dirOf('better-sqlite3'), 'run', 'build-release'], { stdio: 'inherit' })
execFileSync('pnpm', ['-C', dirOf('node-pty'), 'exec', 'node-gyp', 'rebuild'], { stdio: 'inherit' })
