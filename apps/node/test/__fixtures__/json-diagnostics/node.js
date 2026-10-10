// A loaded file-language provider for Editor: JSON syntax errors as diagnostics
// (docs/editor/document-surface.md § Language smarts). No imports, so it runs from any folder.
// Install this folder in a dev session to see Editor mark a broken JSON file.

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
})

// One-based line and column of a UTF-16 offset, the coordinates the host uses.
const positionAt = (text, offset) => {
  const lines = text.slice(0, offset).split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

// Where V8's `JSON.parse` error points. Most messages say `at position N`. "Unexpected token" messages
// quote the text around the token instead, starting 10 characters before it when they begin with
// `...`. Anything else marks the first character, so a parse failure is never silent.
const errorOffset = (text, message) => {
  const at = /position (\d+)/.exec(message)
  if (at) return Math.min(Number(at[1]), text.length)
  if (/end of JSON input/.test(message)) return text.length
  const token = /Unexpected token '(.)'/.exec(message)?.[1]
  const context = /, (\.\.\.)?"([\s\S]*)"(\.\.\.)? is not valid JSON$/.exec(message)
  const start = context ? text.indexOf(context[2]) : -1
  if (start === -1) return 0
  return context[1] ? start + 10 : start + Math.max(0, token ? context[2].indexOf(token) : 0)
}

export default {
  name: 'json-diagnostics',
  init(ctx) {
    ctx.routes.fetch(async (request) => {
      if (new URL(request.url).pathname !== '/check' || request.method !== 'POST') {
        return json({ error: { code: 'not_found', message: 'not found' } }, 404)
      }
      const body = await request.json().catch(() => null)
      if (!body || typeof body.text !== 'string' || !Number.isInteger(body.revision)) {
        return json({ error: { code: 'bad_request', message: 'expected { text, revision }' } }, 400)
      }
      const items = []
      if (body.text.trim()) {
        try {
          JSON.parse(body.text)
        } catch (error) {
          const from = errorOffset(body.text, String(error.message))
          const to = Math.min(from + 1, body.text.length)
          items.push({
            range: { start: positionAt(body.text, from), end: positionAt(body.text, to) },
            severity: 'error',
            message: String(error.message),
            source: 'JSON.parse',
          })
        }
      }
      return json({ revision: body.revision, items })
    })
  },
}
