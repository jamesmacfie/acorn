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
