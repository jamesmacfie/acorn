import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { forEachDiagnostic, type Diagnostic } from '@codemirror/lint'
import type { DocumentServiceRoutes } from '../../host/registries/panes/documentServices'

// The provider is a route, so it is mocked at the one call that reaches the Node. Each answer is
// built from the request, the way a real provider echoes the revision it was sent.
let answer: (route: string, body: Record<string, unknown>) => Promise<unknown> = async () => ({})
const sent: { route: string; body: Record<string, unknown> }[] = []
vi.mock('../../infra/node/apiClient', () => ({
  writeJson: async (route: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>
    sent.push({ route, body })
    return answer(route, body)
  },
}))

const { hoverSource, languageServices, refreshLanguageServices } = await import('./languageServices')

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  sent.length = 0
  answer = async () => ({})
})

const lint: DocumentServiceRoutes = { diagnostics: { pluginId: 'lint', label: 'Lint', route: '/v1/p/lint/check' } }
const hover: DocumentServiceRoutes = { hover: { pluginId: 'lint', label: 'Lint', route: '/v1/p/lint/hover' } }

const editor = (doc: string, routes: () => DocumentServiceRoutes, onUnavailable?: (reason: string | null) => void) => {
  let revision = 1
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        languageServices({ nodeId: 'node-a', routes, revision: () => revision, onUnavailable }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) revision++
        }),
      ],
    }),
    parent: document.body,
  })
  views.push(view)
  return { view, revision: () => revision }
}

const marks = (view: EditorView): Diagnostic[] => {
  const found: Diagnostic[] = []
  forEachDiagnostic(view.state, (diagnostic, from, to) => found.push({ ...diagnostic, from, to }))
  return found
}

describe('hover', () => {
  it('sends the live text, a one-based position, and the revision, and draws the answer with its credit', async () => {
    answer = async (_route, body) => ({
      revision: body.revision,
      contents: { kind: 'plaintext', value: 'a number' },
      range: { start: { line: 2, column: 3 }, end: { line: 2, column: 4 } },
    })
    const { view } = editor('{\n😀1}', () => hover)
    const tooltip = await hoverSource({ nodeId: 'node-a', routes: () => hover, revision: () => 1 })(view, 4)
    expect(sent[0]).toEqual({
      route: '/v1/p/lint/hover',
      body: { text: '{\n😀1}', position: { line: 2, column: 3 }, revision: 1 },
    })
    expect(tooltip).toMatchObject({ pos: 4, end: 5 })
    const dom = tooltip!.create(view).dom
    expect(dom.textContent).toBe('a numberFrom Lint')
  })

  it('draws nothing for a stale or out-of-bounds answer, or after the buffer changed', async () => {
    let revision = 3
    const source = { nodeId: 'node-a', routes: () => hover, revision: () => revision }
    const { view } = editor('select 1', () => hover)
    answer = async () => ({ revision: 2, contents: { kind: 'plaintext', value: 'old' } })
    expect(await hoverSource(source)(view, 1)).toBeNull()
    answer = async () => ({
      revision: 3,
      contents: { kind: 'plaintext', value: 'x' },
      range: { start: { line: 1, column: 1 }, end: { line: 1, column: 99 } },
    })
    expect(await hoverSource(source)(view, 1)).toBeNull()
    answer = async () => {
      revision = 4
      return { revision: 3, contents: { kind: 'plaintext', value: 'late' } }
    }
    expect(await hoverSource(source)(view, 1)).toBeNull()
  })

  it("draws a provider's Markdown inert", async () => {
    answer = async (_route, body) => ({
      revision: body.revision,
      contents: {
        kind: 'markdown',
        value:
          '**bold** <img src=x onerror=alert(1)> ![t](https://evil.example/p.png) [x](javascript:alert(1)) <script>alert(1)</script>',
      },
    })
    const { view } = editor('x', () => hover)
    const tooltip = await hoverSource({ nodeId: 'node-a', routes: () => hover, revision: () => 1 })(view, 0)
    const dom = tooltip!.create(view).dom
    expect(dom.querySelector('strong')?.textContent).toBe('bold')
    expect(dom.querySelector('img, script, [onerror]')).toBeNull()
    expect(dom.querySelector('a[href^="javascript"]')).toBeNull()
  })

  it('says why instead of sending a buffer over 1 MiB', async () => {
    const { view } = editor('a'.repeat(1024 * 1024 + 1), () => hover)
    const tooltip = await hoverSource({ nodeId: 'node-a', routes: () => hover, revision: () => 1 })(view, 0)
    expect(sent).toEqual([])
    expect(tooltip!.create(view).dom.textContent).toContain('larger than 1 MiB')
  })
})

describe('diagnostics', () => {
  const error = (body: Record<string, unknown>) => ({
    revision: body.revision,
    items: [
      {
        range: { start: { line: 1, column: 2 }, end: { line: 1, column: 3 } },
        severity: 'error',
        message: 'Unexpected',
        source: 'json',
        code: 'E1',
      },
    ],
  })

  it('asks at once, draws credited marks, then asks again 500 ms after an edit and clears on an empty answer', async () => {
    answer = async (_route, body) => error(body)
    const { view } = editor('{,}', () => lint)
    await vi.waitFor(() => expect(marks(view)).toHaveLength(1))
    expect(marks(view)[0]).toMatchObject({
      from: 1,
      to: 2,
      severity: 'error',
      message: 'Unexpected',
      source: 'Lint · json · E1',
    })
    expect(sent[0]!.body).toEqual({ text: '{,}', revision: 1 })

    vi.useFakeTimers()
    try {
      answer = async (_route, body) => ({ revision: body.revision, items: [] })
      view.dispatch({ changes: { from: 1, to: 2 } })
      await vi.advanceTimersByTimeAsync(499)
      expect(sent).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
    } finally {
      vi.useRealTimers()
    }
    await vi.waitFor(() => expect(marks(view)).toEqual([]))
    expect(sent[1]!.body).toEqual({ text: '{}', revision: 2 })
  })

  it('clears on a failure or a stale answer, and when the provider goes away', async () => {
    let routes = lint
    answer = async (_route, body) => error(body)
    const { view } = editor('{,}', () => routes)
    await vi.waitFor(() => expect(marks(view)).toHaveLength(1))
    answer = async () => {
      throw new Error('offline')
    }
    view.dispatch({ effects: refreshLanguageServices.of(null) })
    await vi.waitFor(() => expect(marks(view)).toEqual([]))

    answer = async (_route, body) => error(body)
    view.dispatch({ effects: refreshLanguageServices.of(null) })
    await vi.waitFor(() => expect(marks(view)).toHaveLength(1))
    answer = async () => ({ revision: 99, items: [] })
    view.dispatch({ effects: refreshLanguageServices.of(null) })
    await vi.waitFor(() => expect(marks(view)).toEqual([]))

    answer = async (_route, body) => error(body)
    view.dispatch({ effects: refreshLanguageServices.of(null) })
    await vi.waitFor(() => expect(marks(view)).toHaveLength(1))
    routes = {}
    const before = sent.length
    view.dispatch({ effects: refreshLanguageServices.of(null) })
    await vi.waitFor(() => expect(marks(view)).toEqual([]))
    expect(sent).toHaveLength(before)
  })

  it('drops an answer for text the person has since changed', async () => {
    let release!: () => void
    answer = (_route, body) =>
      new Promise((resolve) => {
        release = () => resolve(error(body))
      })
    const { view } = editor('{,}', () => lint)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    view.dispatch({ changes: { from: 0, insert: ' ' } })
    release()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(marks(view)).toEqual([])
  })

  it('reports an oversized buffer instead of sending it', async () => {
    const reasons: (string | null)[] = []
    editor(
      'a'.repeat(1024 * 1024 + 1),
      () => lint,
      (reason) => reasons.push(reason),
    )
    await vi.waitFor(() => expect(reasons.at(-1)).toContain('larger than 1 MiB'))
    expect(sent).toEqual([])
  })
})
