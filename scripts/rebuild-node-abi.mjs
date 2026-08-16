// vitest runs under system Node, but the app runs under Electron. A native module compiled with
// node-gyp matches one ABI at a time, so the test runner and the app can't always share a build.
// `pnpm rebuild` is shadowed by the root "rebuild" script (which produces the Electron ABI via
// electron-rebuild), so this rebuilds for the CURRENT Node ABI directly.
//
// node-pty is the only native module left — SQLite is now the runtime's own `node:sqlite`
// (packages/node-core/src/main/sqlite.ts), which has no ABI to get wrong. node-pty builds against
// node-addon-api (N-API), so on a platform where its prebuilt binary is used the probe below simply
// succeeds and this exits immediately. That is deliberately left to the probe rather than asserted
// here: the day it stops being true, this still does the right thing.
//
// Lives at the repo ROOT and runs ONCE before `turbo run test`, never as a per-package step. Every
// workspace package resolves to the same physical copy, so a package rebuilding it while a sibling's
// tests are loading it is a race that fails the sibling.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

// node-pty 1.1.0 publishes prebuilds/<platform>-<arch>/spawn-helper as mode 644 and never chmods it
// in its own install/postinstall, so node-pty's posix_spawnp of the helper dies with EACCES and
// reports "posix_spawnp failed". The probe below can't catch it — pty.node is N-API and loads fine.
// The packaged app is unaffected (electron-builder's node-gyp rebuild writes build/Release at 755,
// which node-pty prefers), so this only ever bites tests. Re-run after every install: the file is
// hard-linked from the pnpm store, so a fresh install restores the broken mode.
if (process.platform !== 'win32') {
  const ptyDir = dirname(require.resolve('node-pty/package.json'))
  const helper = join(ptyDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
  if (existsSync(helper)) chmodSync(helper, 0o755)
}

try {
  require('node-pty') // already loadable on this ABI → nothing to do
  process.exit(0)
} catch {
  // wrong ABI (or never built) — fall through and rebuild
}

console.log(`Rebuilding node-pty for Node ABI ${process.versions.modules}…`)
// Resolve the real package directory through Node rather than assuming a node_modules layout:
// under pnpm only the declaring package has the symlink, and that package is no longer this one.
const dirOf = (pkg) => dirname(require.resolve(`${pkg}/package.json`))
execFileSync('pnpm', ['-C', dirOf('node-pty'), 'exec', 'node-gyp', 'rebuild'], { stdio: 'inherit' })
