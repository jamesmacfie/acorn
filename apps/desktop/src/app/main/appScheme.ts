import { net, protocol } from 'electron'
import { statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// The renderer's own origin. It is bundled with the desktop app and no longer served by a node
// (docs/vNext/architecture.md § How the client talks to nodes): nodes serve no web assets, and the
// window must be able to reach N of them without inheriting any one's origin.
export const APP_ORIGIN = 'app://acorn'

const ROOT = join(import.meta.dirname, '../../dist/client')

// Set as a response HEADER, not an index.html meta tag: a header cannot be overridden by markup that
// gets injected into the document, and a meta tag can be preceded by content it therefore fails to
// cover.
//
// Two directives are not the obvious value and are the reason this is worth reading:
//   style-src 'unsafe-inline'  REQUIRED. Shiki emits `style="color:#…"` attributes into the HTML that
//                              reaches innerHTML, and style *attributes* are CSP-gated. (Solid's
//                              `el.style.x = v` is not — this is only about attributes in markup.)
//   img-src https:             GitHub avatars (ui/UserAvatar.tsx, still used for PR authors). A
//                              hardening candidate: narrowing it to github.com/avatars.githubusercontent.com
//                              is a one-line change once nothing else renders a remote image.
// connect-src 'self' is the one worth stating plainly: ALL node traffic is IPC through the broker, so
// the renderer needs no network permission at all (docs/vNext/security.md).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "worker-src 'self' blob:", // Monaco's five ?worker chunks; blob: covers a bundler that inlines one
  "frame-src 'none'", // the preview pane is a main-owned WebContentsView, never an iframe
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export function registerAppScheme(): void {
  protocol.handle('app', async (request) => {
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
    const file = await net.fetch(pathToFileURL(isFile ? resolved : join(ROOT, 'index.html')).toString())
    // Rebuilt rather than mutated: a fetch Response's headers are immutable. The body is still the
    // stream net.fetch handed us, so this does not buffer the file.
    const headers = new Headers(file.headers)
    headers.set('content-security-policy', CSP)
    return new Response(file.body, { status: file.status, statusText: file.statusText, headers })
  })
}
