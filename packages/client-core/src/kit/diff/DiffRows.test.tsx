import { render } from 'solid-js/web'
import type { JSX } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiffLine, NonCodeRow, SplitCell } from './DiffRows'
import type { CodeRow } from './diffModel'

const insert: CodeRow = {
  kind: 'insert', path: 'src/example.ts', oldNo: null, newNo: 48, raw: 'changed', toks: [],
}
const deleted: CodeRow = {
  kind: 'delete', path: 'src/example.ts', oldNo: 48, newNo: null, raw: 'old', toks: [],
}

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((dispose) => dispose()))

function mount(component: () => JSX.Element) {
  const host = document.createElement('div')
  document.body.append(host)
  cleanups.push(render(component, host))
  cleanups.push(() => host.remove())
  return host
}

describe('diff line editor navigation', () => {
  it('opens the added line from the unified gutter without triggering the row action', () => {
    const openLine = vi.fn()
    const rowClick = vi.fn()
    const host = mount(() => (
      <div class="diff-row" onClick={rowClick}>
        <DiffLine r={insert} canAdd={false} addComment={async () => {}} onMutated={() => {}} openLine={openLine} />
      </div>
    ))

    const button = host.querySelector<HTMLButtonElement>('.diff-gutter .diff-open-btn')
    expect(button?.getAttribute('aria-label')).toBe('Open src/example.ts:48 in editor')
    button?.click()
    expect(openLine).toHaveBeenCalledWith(insert)
    expect(rowClick).not.toHaveBeenCalled()
  })

  it('shows the control on the new side of a split diff', () => {
    const openLine = vi.fn()
    const host = mount(() => (
      <div class="diff-split-pair">
        <SplitCell r={deleted} gutter={48} canAdd={false} addComment={async () => {}} onMutated={() => {}} openLine={openLine} />
        <SplitCell r={insert} gutter={48} canAdd={false} addComment={async () => {}} onMutated={() => {}} openLine={openLine} />
      </div>
    ))

    const buttons = host.querySelectorAll<HTMLButtonElement>('.diff-open-btn')
    expect(buttons).toHaveLength(1)
    buttons[0].click()
    expect(openLine).toHaveBeenCalledWith(insert)
  })

  it('hides the control when the source has no editor action', () => {
    const host = mount(() => (
      <div class="diff-row">
        <DiffLine r={insert} canAdd={false} addComment={async () => {}} onMutated={() => {}} />
      </div>
    ))
    expect(host.querySelector('.diff-open-btn')).toBeNull()
  })
})

describe('review comment HTML', () => {
  it('sanitizes a provider comment before it enters the diff view', () => {
    const host = mount(() => (
      <NonCodeRow
        row={{ kind: 'thread', thread: {
          threadId: 'thread-1', path: 'src/example.ts', line: 48, side: 'RIGHT', resolved: false,
          comments: [{
            id: 'comment-1', databaseId: 1, author: 'reviewer', createdAt: null,
            body: '<p><strong>Review</strong> <img src="https://attacker.test/pixel" onerror="run()"><a href="javascript:run()">unsafe</a> <a href="https://example.test/">safe</a></p>',
          }],
        } }}
        onMutated={() => {}}
        resolveThread={async () => {}}
        reply={async () => {}}
      />
    ))
    const body = host.querySelector('.diff-thread-comment .ui-markdown')
    expect(body?.innerHTML).toBe('<p><strong>Review</strong> unsafe <a href="https://example.test/" target="_blank" rel="noopener noreferrer">safe</a></p>')
    expect(body?.querySelector('img, script, [onerror]')).toBeNull()
  })
})
