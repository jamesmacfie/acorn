import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import type { PluginCache } from './pluginCache'
import { pluginFrameStyles } from './pluginFrameStyles'

// `app-plugin://<sha256>/...` is the origin a plugin's UI runs on. Why the hash is the host, what it
// buys (isolation, immutability, custody), and why index.html is generated here rather than shipped
// by the plugin: docs/electron.md § The plugin frame origin, docs/plugins.md.

export const PLUGIN_SCHEME = 'app-plugin'

// The plugin frame's CSP, one header on every response, and the reasoning behind each directive:
// docs/electron.md § The plugin frame origin.
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

// The generated document is deliberately tiny: the host's shared presentation stylesheet and the
// plugin's module script. No inline script (the CSP has no `unsafe-inline` for scripts and must not
// need one), no favicon, no title a plugin could use to impersonate the shell in a devtools list.
//
// The inline block sits before the stylesheet link, and that order matters. It used to sit after,
// where `html, body { ... font: inherit }` beat `base.css`'s `body { font-family: var(--font-ui) }`
// on nothing but source order (same selector, same specificity, later wins). `font` is a shorthand, so
// `inherit` reset family, size, line-height and weight to the parent, `html` declared none of them,
// and every frame in the app rendered in the browser's default serif at the browser's default size.
// It looked exactly like a plugin that had ignored the design system, the expensive kind of wrong.
// (`color: var(--fg, ...)` was fighting the same fight and losing worse: there is no `--fg` token, so
// that declaration was always the fallback.)
//
// Nothing here may restate a property `/ui.css` owns. Ground the document, let the shared sheet dress
// it. `color-scheme` is the exception and keeps its fallback inline, since it has to be right in the
// fraction of a second before the appearance tokens arrive over the port.
const documentFor = (): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html { color-scheme: var(--color-scheme, light dark); }
  html, body { margin: 0; height: 100%; }
</style>
<link rel="stylesheet" href="/ui.css">
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
      // Frames are hash-addressed, so the only correct cache lifetime is forever, but this is a local
      // scheme with a content-addressed store behind it, so there is nothing to gain and one more
      // place for stale bytes to live.
      'cache-control': 'no-store',
      // No `x-frame-options` or `frame-ancestors`, and why: docs/electron.md § The plugin frame
      // origin.
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
    // One host-owned stylesheet, identical at every plugin origin. The plugin cannot replace it, and
    // its contents are the same shared presentation modules the shell build uses.
    if (path === '/ui.css') return respond(pluginFrameStyles, 200, 'text/css; charset=utf-8')
    // One bundle per plugin, one file per bundle. There is no plugin-controlled asset tree: a plugin
    // that wants an image or font inlines it, keeping its hash claim exactly as auditable as one file.
    if (path !== '/client.js') return respond(null, 404, 'text/plain')

    const file = cache.path(hash)
    // A hash the cache does not hold. The normal case for this is a bundle the owner rejected or one
    // that was swept; either way the answer is nothing, not a fetch from the node that offered it.
    if (!file) return respond(null, 404, 'text/plain')

    // net.fetch over the file rather than readFile, for the same reason app:// does it: a streamed body
    // and a MIME type Chromium accepts for a module script.
    const bytes = await net.fetch(pathToFileURL(file).toString())
    if (!bytes.ok || !bytes.body) return respond(null, 404, 'text/plain')
    return respond(bytes.body, 200, 'text/javascript; charset=utf-8')
  })
}
