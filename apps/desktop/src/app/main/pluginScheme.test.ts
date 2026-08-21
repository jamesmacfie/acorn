import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Electron is mocked the way previewService.test.ts does it: capture what the module registers, then
// call the handler directly. The two things worth pinning here are the response policy (every
// response carries the frame CSP, whatever the outcome) and the custody rule (nothing but a hash the
// cache holds can produce bytes); neither needs a browser.
const handlers = new Map<string, (request: Request) => Promise<Response>>()
let fetched: string[] = []

vi.mock('electron', () => ({
  protocol: {
    handle: (scheme: string, handler: (request: Request) => Promise<Response>) => void handlers.set(scheme, handler),
  },
  net: {
    fetch: async (url: string) => {
      fetched.push(url)
      const { readFileSync } = await import('node:fs')
      const { fileURLToPath } = await import('node:url')
      try {
        return new Response(readFileSync(fileURLToPath(url)))
      } catch {
        return new Response(null, { status: 404 })
      }
    },
  },
}))

// Main-process Vitest intentionally replaces CSS imports with empty modules. Route behavior is the
// unit under test here; the desktop production build verifies the real ?raw stylesheet aggregation.
vi.mock('./pluginFrameStyles', () => ({
  pluginFrameStyles: ".ui-btn{} .ui-badge{} .ui-tabs{} :root[data-style='modern'] .ui-btn{}",
}))

const { PLUGIN_SCHEME, registerPluginScheme } = await import('./pluginScheme')

const HASH = 'a'.repeat(64)
let dir = ''
let held: Record<string, string> = {}

// Stands in for PluginCache: the only thing the handler is allowed to ask it is "where is this hash",
// which is also the whole of the custody boundary.
const cache = { path: (hash: string) => (hash in held ? held[hash] : null) }

const get = (url: string): Promise<Response> => handlers.get(PLUGIN_SCHEME)!(new Request(url))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acorn-plugin-scheme-'))
  const file = join(dir, `${HASH}.js`)
  writeFileSync(file, 'export default 1\n')
  held = { [HASH]: file }
  fetched = []
  handlers.clear()
  registerPluginScheme(cache)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the response policy', () => {
  it('carries the frame CSP and nosniff on every response, including the failures', async () => {
    const responses = [
      await get(`${PLUGIN_SCHEME}://${HASH}/index.html`),
      await get(`${PLUGIN_SCHEME}://${HASH}/client.js`),
      await get(`${PLUGIN_SCHEME}://${HASH}/nope.js`),
      await get(`${PLUGIN_SCHEME}://not-a-hash/index.html`),
    ]
    for (const response of responses) {
      const csp = response.headers.get('content-security-policy') ?? ''
      // The one that matters: a plugin frame has no network at all, so a hostile bundle cannot
      // exfiltrate even to its own server.
      expect(csp).toContain("connect-src 'none'")
      expect(csp).toContain("default-src 'none'")
      expect(csp).toContain("script-src 'self'")
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    }
  })

  it('does not send x-frame-options, which would block the only embed that is meant to work', async () => {
    // The shell frames these from app://acorn, a different origin. SAMEORIGIN here would be a
    // plausible-looking header that breaks every plugin pane.
    const response = await get(`${PLUGIN_SCHEME}://${HASH}/index.html`)
    expect(response.headers.get('x-frame-options')).toBeNull()
  })
})

describe('the generated document', () => {
  it('is built here, not supplied by the plugin', async () => {
    const response = await get(`${PLUGIN_SCHEME}://${HASH}/index.html`)
    const html = await response.text()
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(html).toContain('<link rel="stylesheet" href="/ui.css">')
    expect(html).toContain('<script type="module" src="/client.js">')
    // No inline script anywhere: the CSP has no `unsafe-inline` for scripts and must never need one.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/)
    // The cache is not touched to answer this: the document does not depend on the bundle existing.
    expect(fetched).toEqual([])
  })

  // Source order, asserted because it is the whole difference between a frame that looks like the app
  // and one that renders in Times New Roman. The inline block and `/ui.css` both style bare `html, body`,
  // so specificity ties and the later sheet wins every tie. `/ui.css` must be the later sheet.
  it('links the shared stylesheet after its own inline fallbacks', async () => {
    const html = await (await get(`${PLUGIN_SCHEME}://${HASH}/index.html`)).text()
    expect(html.indexOf('<style>')).toBeLessThan(html.indexOf('<link rel="stylesheet"'))
  })

  // Nothing inline may restate a property the shared stylesheet owns. `font` is the one that bit:
  // as a shorthand, `font: inherit` silently reset four properties base.css had just set.
  it('declares no font, colour or background of its own', async () => {
    const inline = /<style>([\s\S]*?)<\/style>/.exec(await (await get(`${PLUGIN_SCHEME}://${HASH}/index.html`)).text())?.[1] ?? ''
    expect(inline).not.toMatch(/(^|[;{\s])(font|font-family|color|background|background-color)\s*:/)
  })

  it('serves it for the origin root as well', async () => {
    expect((await get(`${PLUGIN_SCHEME}://${HASH}/`)).status).toBe(200)
  })
})

describe('custody', () => {
  it('serves the bundle for a hash the cache holds', async () => {
    const response = await get(`${PLUGIN_SCHEME}://${HASH}/client.js`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/javascript')
    expect(await response.text()).toBe('export default 1\n')
  })

  it('serves the host-owned UI kit without consulting the plugin cache', async () => {
    const response = await get(`${PLUGIN_SCHEME}://${HASH}/ui.css`)
    const css = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/css')
    expect(css).toContain('.ui-btn')
    expect(css).toContain('.ui-badge')
    expect(css).toContain('.ui-tabs')
    expect(css).toContain(":root[data-style='modern'] .ui-btn")
    expect(fetched).toEqual([])
  })

  it('404s a hash this device does not hold, rather than fetching anything', async () => {
    const response = await get(`${PLUGIN_SCHEME}://${'b'.repeat(64)}/client.js`)
    expect(response.status).toBe(404)
    // An unacknowledged or swept bundle has no way to become a request.
    expect(fetched).toEqual([])
  })

  it('404s a host that is not a hash at all', async () => {
    for (const host of ['not-a-hash', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      expect((await get(`${PLUGIN_SCHEME}://${host}/client.js`)).status).toBe(404)
    }
    expect(fetched).toEqual([])
  })

  it('serves nothing but index.html and client.js', async () => {
    // There is no asset tree at this origin, which is what keeps its contents exactly as auditable as
    // the hash claims.
    for (const path of ['/assets/x.png', '/../../etc/passwd', '/client.js.map', '/%2e%2e/secret', '/tokens.css']) {
      expect((await get(`${PLUGIN_SCHEME}://${HASH}${path}`)).status).toBe(404)
    }
    expect(fetched).toEqual([])
  })

  it('404s when the cache points at a file that has gone', async () => {
    held = { [HASH]: join(dir, 'vanished.js') }
    const response = await get(`${PLUGIN_SCHEME}://${HASH}/client.js`)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'")
  })
})
