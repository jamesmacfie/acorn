import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import type { PluginCache } from './pluginCache'

// `app-plugin://<sha256>/…` — the origin a third-party plugin's UI runs on
// (docs/third-party/phase-3-sandboxed-ui.md § The `app-plugin://` scheme).
//
// The host part is the bundle hash, which is doing three jobs at once:
//
//   Isolation.   A different bundle is a different origin, so no plugin can reach another's frame, its
//                storage, or the shell's — the iframe is cross-origin to app://acorn by construction,
//                and Chromium may put it out of process as a bonus we do not rely on.
//   Immutability.There is nothing mutable at this origin. The bytes behind a hash cannot change, so
//                there is no cache to invalidate and no version skew to reason about.
//   Custody.     The handler serves from main's content-addressed cache and from nowhere else. It
//                cannot be pointed at a path, and a hash this device does not hold is a 404 rather than
//                a fetch — an unacknowledged bundle has no way to become a request.
//
// `index.html` is GENERATED here rather than shipped by the plugin. The plugin owns what runs; it does
// not own the document, the CSP or the bootstrap. That is what keeps the policy below un-overridable by
// markup.

export const PLUGIN_SCHEME = 'app-plugin'

// The whole security posture of a plugin frame, in one header on every response.
//
// `connect-src 'none'` is the line worth reading twice: a plugin frame has NO network. Not a restricted
// one — none. fetch, XHR, WebSocket, sendBeacon and EventSource all fail, so a malicious bundle cannot
// exfiltrate what it sees even to its own server. Its only I/O is the MessagePort the host hands it,
// where every call is checked against the manifest (client-core/plugins/frames/scopes.ts).
//
// `default-src 'none'` then makes every other directive opt-in, so a fetch type nobody thought about
// here is denied rather than inherited. `style-src 'unsafe-inline'` is present because the appearance
// tokens arrive over the port and are applied as inline custom properties on `:root`; `img-src data:`
// so a plugin can draw an inlined icon without an asset pipeline.
//
// `'self'` here means the bundle hash, and it works because the frame keeps that origin: the iframe is
// sandboxed `allow-scripts allow-same-origin` (client-core/plugins/frames/PluginFrame.tsx explains why
// both tokens). Dropping `allow-same-origin` makes the origin opaque, at which point `'self'` matches
// nothing, the frame's own module script is a cross-origin fetch on a scheme with no CORS, and the
// document renders blank — which is the failure this comment exists to stop someone rediscovering.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const HASH_RE = /^[0-9a-f]{64}$/

// The generated document. Deliberately tiny: a module script and nothing else. No inline script (the
// CSP has no `unsafe-inline` for scripts and must not need one), no favicon, no title a plugin could
// use to impersonate the shell in a devtools list.
//
// `color-scheme` and the two body rules are the only styling here. Everything else a plugin renders is
// its own CSS over the tokens the host pushes down the port.
const documentFor = (): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; height: 100%; background: var(--bg, transparent); color: var(--fg, inherit); font: inherit; }
</style>
</head>
<body><script type="module" src="/client.js"></script></body>
</html>
`

const respond = (body: string | ReadableStream<Uint8Array> | null, status: number, type: string): Response =>
  new Response(body, {
    status,
    headers: {
      'content-type': type,
      'content-security-policy': CSP,
      // The bundle is served as a module script; a sniffed type is a type an attacker chose.
      'x-content-type-options': 'nosniff',
      // Frames are hash-addressed, so the only correct cache lifetime is forever — but this is a local
      // scheme with a content-addressed store behind it, so there is nothing to gain and one more place
      // for stale bytes to live.
      'cache-control': 'no-store',
      // Deliberately no `x-frame-options` and no `frame-ancestors`: the shell frames these from
      // app://acorn, which is a different origin, so SAMEORIGIN would block the only embed that is meant
      // to work. What bounds who can frame a plugin is that nothing else in this process can — the
      // shell's own CSP is the only one naming this scheme in `frame-src`, and top-level navigation to it
      // is denied in electron.ts.
    },
  })

/**
 * Serve plugin frames out of the content-addressed cache. Registered once, after `app.whenReady()`;
 * the scheme itself is declared privileged at module scope in electron.ts, which must happen earlier.
 */
export function registerPluginScheme(cache: Pick<PluginCache, 'path'>): void {
  protocol.handle(PLUGIN_SCHEME, async (request) => {
    const url = new URL(request.url)
    // The host part IS the bundle hash. Anything that is not a hash is not a bundle this device holds,
    // so it never reaches the cache lookup.
    const hash = url.hostname
    if (!HASH_RE.test(hash)) return respond(null, 404, 'text/plain')

    const path = decodeURIComponent(url.pathname)
    if (path === '/' || path === '/index.html') return respond(documentFor(), 200, 'text/html; charset=utf-8')
    // One bundle per plugin, one file per bundle. There is no asset tree here: a plugin that wants an
    // image or a font inlines it, which is also what keeps the origin's contents exactly as auditable as
    // its hash claims.
    if (path !== '/client.js') return respond(null, 404, 'text/plain')

    const file = cache.path(hash)
    // A hash the cache does not hold. The normal case for this is a bundle the owner rejected or one
    // that was swept — either way the answer is nothing, not a fetch from the node that offered it.
    if (!file) return respond(null, 404, 'text/plain')

    // net.fetch over the file rather than readFile, for the same reason app:// does it: a streamed body
    // and a MIME type Chromium accepts for a module script.
    const bytes = await net.fetch(pathToFileURL(file).toString())
    if (!bytes.ok || !bytes.body) return respond(null, 404, 'text/plain')
    return respond(bytes.body, 200, 'text/javascript; charset=utf-8')
  })
}
