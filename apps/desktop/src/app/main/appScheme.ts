import { net, protocol } from 'electron'
import { statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PLUGIN_SCHEME } from './pluginScheme'

// The renderer's own origin: docs/electron.md § Renderer origin and protocol handler.
export const APP_ORIGIN = 'app://acorn'

const ROOT = join(import.meta.dirname, '../../dist/client')

// The CSP and its directives: docs/electron.md § Renderer origin and protocol handler.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "worker-src 'self' blob:", // Monaco's five ?worker chunks; blob: covers a bundler that inlines one
  // frame-src names only the plugin scheme: docs/electron.md § Renderer origin and protocol handler.
  `frame-src ${PLUGIN_SCHEME}:`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

// The highlighter worker's separate CSP: docs/electron.md § The syntax-highlighter worker's separate
// policy.
const WORKER_CSP = ["default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'", "connect-src 'none'"].join('; ')

// Why this pattern matches only the worker entry, and what happens if a rename breaks it:
// docs/electron.md § The syntax-highlighter worker's separate policy.
export const HIGHLIGHT_WORKER = /^\/assets\/worker-highlighter\.worker-[\w-]+\.js$/

export function registerAppScheme(): void {
  protocol.handle('app', async (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname)
    const resolved = join(ROOT, pathname)
    // Traversal guard: `join` normalizes, but a percent-encoded `..` arrives intact until
    // `decodeURIComponent` runs, so the resolved path is checked again after that.
    if (resolved !== ROOT && !resolved.startsWith(ROOT + sep)) return new Response(null, { status: 403 })

    // Anything that is not a file on disk is a client-side route (/:owner/:repo/:number), so this
    // serves the shell. Simpler than the node's SPA fallback, since under app:// there are no API
    // paths to exclude; the API is IPC.
    const isFile = statSync(resolved, { throwIfNoEntry: false })?.isFile() === true
    // net.fetch, not readFile: docs/electron.md § Renderer origin and protocol handler.
    const file = await net.fetch(pathToFileURL(isFile ? resolved : join(ROOT, 'index.html')).toString())
    // Rebuilt rather than mutated: docs/electron.md § Renderer origin and protocol handler.
    const headers = new Headers(file.headers)
    headers.set('content-security-policy', HIGHLIGHT_WORKER.test(pathname) ? WORKER_CSP : CSP)
    return new Response(file.body, { status: file.status, statusText: file.statusText, headers })
  })
}
