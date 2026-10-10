import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import Markdown from './Markdown'
import { getHighlighter, resetHighlightHtmlCache } from '../../../infra/highlight/shiki'

it('skips obsolete and disposed fences while retaining duplicate live copy controls', async () => {
  const highlighter = await getHighlighter('typescript')
  resetHighlightHtmlCache()
  const highlight = vi.spyOn(highlighter, 'codeToHtml')
  const [text, setText] = createSignal('```ts\nconst initial = 0\n```')
  const host = document.createElement('div'); document.body.append(host)
  const dispose = render(() => <Markdown text={text()} copy />, host)
  try {
    for (let at = 0; at < 8; at++) setText('```ts\nconst burst = ' + at + '\n```')
    await vi.waitFor(() => expect(host.querySelector('pre.shiki')).not.toBeNull(), { timeout: 10_000 })
    expect(highlight).toHaveBeenCalledTimes(1)
    expect(highlight.mock.calls[0][0]).toBe('const burst = 7')
    resetHighlightHtmlCache(); highlight.mockClear()
    const fence = '```ts\nconst duplicate = 1\n```'
    setText(fence + '\n\n' + fence)
    await vi.waitFor(() => expect(host.querySelectorAll('pre.shiki')).toHaveLength(2), { timeout: 10_000 })
    expect(highlight).toHaveBeenCalledTimes(1); expect(host.querySelectorAll('button')).toHaveLength(2)
    highlight.mockClear(); setText('```ts\nconst disposed = 1\n```'); dispose()
    await vi.dynamicImportSettled()
    expect(highlight).not.toHaveBeenCalled()
  } finally { dispose(); host.remove(); highlight.mockRestore(); resetHighlightHtmlCache() }
}, 20_000)

// What a selection action reads off a fence: the language survives the highlight that replaces its
// `<pre>`, and a selection in it survives the message streaming on below.
it('keeps a fence’s language and a selection in it while the message streams on', async () => {
  const [text, setText] = createSignal('```ts\nconst kept = 1\n```')
  const host = document.createElement('div'); document.body.append(host)
  const dispose = render(() => <Markdown text={text()} copy />, host)
  try {
    await vi.waitFor(() => expect(host.querySelector('pre.shiki')).not.toBeNull(), { timeout: 10_000 })
    const wrap = host.querySelector<HTMLElement>('.ui-code-wrap')!
    expect(wrap.dataset.language).toBe('ts')
    const range = document.createRange()
    range.selectNodeContents(wrap.querySelector('pre.shiki code')!)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    setText(text() + '\n\nAnd a paragraph that streamed in after.')
    expect(host.querySelector('.ui-code-wrap')).toBe(wrap)
    expect(document.getSelection()!.toString()).toBe('const kept = 1')
  } finally { document.getSelection()?.removeAllRanges(); dispose(); host.remove() }
}, 20_000)

// A fence's viewer lives as long as its block: the message streaming on below it must not restart it,
// and the highlight that replaces its `<pre>` must not take the viewer out with it.
it('keeps a fence’s viewer through the message streaming on and its highlight landing', async () => {
  const [text, setText] = createSignal('```ts\nconst viewed = 1\n```')
  const asked = vi.fn()
  const host = document.createElement('div'); document.body.append(host)
  const dispose = render(() => (
    <Markdown text={text()} copy fences={(fence) => { asked(fence); return { preview: () => false, view: <aside>viewer</aside> } }} />
  ), host)
  try {
    const view = host.querySelector('aside')!
    for (let at = 0; at < 5; at++) setText(text() + `\n\nParagraph ${at}`)
    await vi.waitFor(() => expect(host.querySelector('pre.shiki')).not.toBeNull(), { timeout: 10_000 })
    expect(asked).toHaveBeenCalledTimes(1)
    expect(host.querySelector('aside')).toBe(view)
  } finally { dispose(); host.remove() }
}, 20_000)
