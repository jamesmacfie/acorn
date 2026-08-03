import { net, protocol } from 'electron'
import { statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// The renderer's own origin. It is bundled with the desktop app and no longer served by a node
// (docs/vNext/architecture.md § How the client talks to nodes): nodes serve no web assets, and the
// window must be able to reach N of them without inheriting any one's origin.
export const APP_ORIGIN = 'app://acorn'

const ROOT = join(import.meta.dirname, '../../dist/client')

export function registerAppScheme(): void {
  protocol.handle('app', (request) => {
    const resolved = join(ROOT, decodeURIComponent(new URL(request.url).pathname))
    // Traversal guard. `join` normalizes, and Chromium normalizes a standard scheme's path before we
    // see it, but a percent-encoded `..` would arrive intact through decodeURIComponent — so this is
    // the check that keeps the handler from reading outside the bundled renderer.
    if (resolved !== ROOT && !resolved.startsWith(ROOT + sep)) return new Response(null, { status: 403 })

    // Anything that is not a file on disk is a client-side route (/:owner/:repo/:number), so serve the
    // shell. Simpler than the node's SPA fallback because under app:// there are no API paths to
    // exclude — the API is IPC.
    const isFile = statSync(resolved, { throwIfNoEntry: false })?.isFile() === true
    // net.fetch over a file:// URL rather than readFile: it gives MIME sniffing (module scripts fail
    // their type check without it), range requests and a streamed body for free.
    return net.fetch(pathToFileURL(isFile ? resolved : join(ROOT, 'index.html')).toString())
  })
}
