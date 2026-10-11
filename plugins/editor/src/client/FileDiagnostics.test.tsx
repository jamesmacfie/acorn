import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import FileDiagnostics from './FileDiagnostics'

// The terminal's way to Editor diagnostics: the file as saved, on request. Rendered with the DOM kit
// here, which is the same component tree the terminal draws in cells.
afterEach(() => vi.unstubAllGlobals())

it("lists the provider's marks with one-based positions on request, and says when there are none", async () => {
  let text = '{\n  "a": 1,\n}'
  const sent: { text: string; revision: number }[] = []
  // No Node transport in this file, so the provider's route is reached over `fetch`.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init: { body: Uint8Array }) => {
      const body = JSON.parse(new TextDecoder().decode(init.body)) as { text: string; revision: number }
      sent.push(body)
      const items = body.text.includes(',\n}')
        ? [
            {
              range: { start: { line: 2, column: 9 }, end: { line: 2, column: 10 } },
              severity: 'error',
              message: 'Trailing comma',
              code: 'E1',
            },
          ]
        : []
      return new Response(JSON.stringify({ revision: body.revision, items }), {
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(
    () => (
      <FileDiagnostics
        nodeId=""
        read={async () => text}
        route={() => ({ pluginId: 'json-check', label: 'JSON check', route: '/v1/p/json-check/check' })}
      />
    ),
    host,
  )
  try {
    const button = () => [...host.querySelectorAll('button')].find((element) => element.textContent === 'Diagnostics')!
    button().click()
    await vi.waitFor(() => expect(host.textContent).toContain('2:9 error Trailing comma (E1)'))
    expect(sent[0]!.text).toBe(text)
    text = '{\n  "a": 1\n}'
    button().click()
    await vi.waitFor(() => expect(host.textContent).toContain('No problems, from JSON check.'))
    expect(host.textContent).not.toContain('Trailing comma')
  } finally {
    dispose()
    host.remove()
  }
})
