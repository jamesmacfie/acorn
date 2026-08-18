import { net, protocol } from 'electron'
import { statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PLUGIN_SCHEME } from './pluginScheme'

// The renderer's own origin. It is bundled with the desktop app and no longer served by a node
// (docs/architecture-overview.md § How the client talks to nodes): nodes serve no web assets, and the
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
// the renderer needs no network permission at all (docs/security.md).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "worker-src 'self' blob:", // Monaco's five ?worker chunks; blob: covers a bundler that inlines one
  // Exactly one scheme, and it is ours: third-party plugin UI renders in an iframe on app-plugin://,
  // whose own responses carry `connect-src 'none'` (main/pluginScheme.ts). The browser-preview pane is
  // still a main-owned WebContentsView rather than a frame, so this widening buys nothing for http(s).
  `frame-src ${PLUGIN_SCHEME}:`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

// THE ONE RESPONSE THAT GETS A DIFFERENT POLICY, and the reason is a fact about workers rather than
// anything about acorn: a dedicated worker loaded from a same-origin URL takes its CSP from that
// script's own response headers. It does NOT inherit the document's. So the syntax highlighter can
// have `wasm-unsafe-eval` — which buys shiki's Oniguruma engine, measured at 4.6x the JavaScript one —
// while the document above keeps the policy it has always had.
//
// Read the rest of this list before concluding it is a relaxation. The worker ends up with strictly
// FEWER capabilities than the renderer it moved out of: no network, no DOM, no bridge to main, and
// nothing fetchable at all. It takes strings and returns colours. `shiki/wasm` is the inlined build,
// so even the WebAssembly arrives as part of the script rather than as a fetch — which is what lets
// `connect-src 'none'` stand.
//
// Verified in Electron rather than assumed, three ways: the document still cannot instantiate WASM,
// this worker can, and the identical bytes served with the document's header cannot.
const WORKER_CSP = ["default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'", "connect-src 'none'"].join('; ')

// The build gives worker ENTRIES a `worker-` prefix (electron.vite.config.ts explains why), so this
// matches the script that becomes a worker context and not the ~270-byte main-thread wrapper Vite also
// emits from the same source module — which would otherwise share the name and pick up a policy it has
// no business holding. Monaco's five workers are `worker-editor.worker-…` and friends: same prefix,
// different name, no relaxation.
//
// Only a worker's TOP-LEVEL script response sets its policy. The grammar chunks this worker then
// imports are governed by the worker's own `script-src 'self'`, so they need nothing here.
//
// If a bundler change ever renames the entry, this stops matching, the worker gets the document's
// policy, Oniguruma fails inside it, and highlight/worker.ts logs and falls back to the main thread.
// Degraded and loud, which is the failure mode this whole area was rebuilt to have.
export const HIGHLIGHT_WORKER = /^\/assets\/worker-highlighter\.worker-[\w-]+\.js$/

export function registerAppScheme(): void {
  protocol.handle('app', async (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname)
    const resolved = join(ROOT, pathname)
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
    headers.set('content-security-policy', HIGHLIGHT_WORKER.test(pathname) ? WORKER_CSP : CSP)
    return new Response(file.body, { status: file.status, statusText: file.statusText, headers })
  })
}
