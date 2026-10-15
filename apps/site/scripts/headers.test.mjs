import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// `astro preview` ignores `_headers`, so the Playwright suite can't see these. Cloudflare applies them.
test('the published schemas are JSON and open to every origin', () => {
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
  const block = headers.split(/\n(?=\S)/).find((section) => section.startsWith('/schemas/*\n'))
  assert.ok(block, '_headers has no /schemas/* block')
  assert.match(block, /^\s+Content-Type: application\/json$/m)
  assert.match(block, /^\s+Access-Control-Allow-Origin: \*$/m)
})
