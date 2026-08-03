// better-sqlite3 is a native module built for ONE ABI at a time (docs/local-development.md): a
// compiled .node matches Electron's ABI or plain Node's, never both. Load it lazily so a mismatch
// surfaces as an actionable error naming the right rebuild script, instead of a bare
// NODE_MODULE_VERSION stack at import time.
//
// Split out of main/bindings.ts so main/pluginStorage.ts can share it without importing the whole
// bindings module (which pulls in the schema, the device service and the TLS cert).
import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)

export function loadDatabase(): typeof import('better-sqlite3') {
  try {
    return nodeRequire('better-sqlite3') as typeof import('better-sqlite3')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('NODE_MODULE_VERSION') || msg.includes('was compiled against a different Node.js version')) {
      const fix = process.versions.electron
        ? 'pnpm --filter @acorn/desktop electron:rebuild (this is an Electron process)'
        : 'pnpm rebuild:node (this is a plain Node process)'
      throw new Error(`better-sqlite3 is built for the wrong ABI. Run: ${fix}\n\nOriginal error: ${msg}`)
    }
    throw e
  }
}
