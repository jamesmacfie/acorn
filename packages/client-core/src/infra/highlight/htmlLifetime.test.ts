import { afterEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ grammar: Promise.resolve(), html: vi.fn((code: string) => `<pre>${code}</pre>`) }))
vi.mock('shiki/core', () => ({ createHighlighterCore: async () => ({ codeToHtml: fixture.html }) }))
vi.mock('./langs', () => ({ loadGrammar: async () => fixture.grammar, LANGS: {}, langFor: () => 'text' }))
import { highlightToHtml, resetHighlightHtmlCache } from './shiki'
const deferred = () => { let resolve!: () => void; let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
afterEach(() => { resetHighlightHtmlCache(); fixture.html.mockClear(); fixture.grammar = Promise.resolve() })
it('shares the whole grammar flight, preserves a surviving consumer, and removes rejected flights for retry', async () => {
  const grammar = deferred(); fixture.grammar = grammar.promise
  let firstLive = true
  const first = highlightToHtml('duplicate', 'typescript', () => firstLive)
  const second = highlightToHtml('duplicate', 'typescript', () => true)
  expect(first).toBe(second); firstLive = false; grammar.resolve()
  expect(await first).toBe('<pre>duplicate</pre>'); expect(await second).toBe('<pre>duplicate</pre>')
  expect(fixture.html).toHaveBeenCalledTimes(1)
  const rejected = deferred(); fixture.grammar = rejected.promise
  const failure = highlightToHtml('retry', 'typescript'), joining = highlightToHtml('retry', 'typescript')
  expect(failure).toBe(joining); rejected.reject(new Error('grammar unavailable'))
  await expect(failure).rejects.toThrow('grammar unavailable'); await expect(joining).rejects.toThrow('grammar unavailable')
  fixture.grammar = Promise.resolve(); expect(await highlightToHtml('retry', 'typescript')).toBe('<pre>retry</pre>')
  expect(fixture.html).toHaveBeenCalledTimes(2)
})
it('skips rendering when every consumer leaves during grammar loading and permits a later live retry', async () => {
  const grammar = deferred(); fixture.grammar = grammar.promise; let live = true
  const first = highlightToHtml('departed', 'python', () => live)
  const second = highlightToHtml('departed', 'python', () => live)
  live = false; grammar.resolve(); expect(await first).toBe(''); expect(await second).toBe('')
  expect(fixture.html).not.toHaveBeenCalled()
  expect(await highlightToHtml('departed', 'python')).toBe('<pre>departed</pre>')
})
it('does not retain oversized completed fences, while joining their live highlight', async () => {
  const code = 'x'.repeat(16_385), grammar = deferred(); fixture.grammar = grammar.promise
  const first = highlightToHtml(code, 'text'), second = highlightToHtml(code, 'text')
  expect(first).toBe(second); grammar.resolve(); await Promise.all([first, second])
  await highlightToHtml(code, 'text'); expect(fixture.html).toHaveBeenCalledTimes(2)
})
