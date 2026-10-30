import { render } from 'solid-js/web'
import type { JSX } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiffLine, NonCodeRow, SplitCell, StackedDiff } from './DiffRows'
import { DiffNote } from './diffNotes'
import type { CodeRow } from './diffModel'

const insert: CodeRow = {
  kind: 'insert',
  path: 'src/example.ts',
  oldNo: null,
  newNo: 48,
  raw: 'changed',
  toks: [],
}
const deleted: CodeRow = {
  kind: 'delete',
  path: 'src/example.ts',
  oldNo: 48,
  newNo: null,
  raw: 'old',
  toks: [],
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

describe('a StackedDiff with notes', () => {
  const patch = '@@ -3,3 +3,3 @@\n keep\n-old\n+new\n tail'
  /** The code rows and notes in drawing order, a note as `note:<title>`. */
  const drawn = (host: HTMLElement) =>
    [...host.querySelectorAll('.diff-row:not(.diff-file-row):not(.diff-hunk), .diff-note')].map((element) =>
      element.classList.contains('diff-note')
        ? `note:${element.querySelector('.diff-note-title')?.textContent}`
        : element.querySelector('.diff-code')?.textContent,
    )

  it('draws each note under its row, and a note on a missing line after the last', () => {
    const host = mount(() => (
      <StackedDiff path="a.ts" patch={patch}>
        <DiffNote side="new" line={99} title="Nowhere" />
        <DiffNote side="new" line={4} tone="danger" label="Risk" author="Claude Code" title="Added">
          <span>added body</span>
        </DiffNote>
        <DiffNote side="old" line={4} title="Deleted" />
      </StackedDiff>
    ))
    expect(drawn(host)).toEqual(['keep', 'old', 'note:Deleted', 'new', 'note:Added', 'tail', 'note:Nowhere'])
    const risk = host.querySelectorAll('.diff-note')[1]!
    expect(risk.querySelector('.diff-note-head')!.textContent).toBe('✦Claude CodeRisk▾')
    expect(risk.textContent).toContain('added body')
    expect(host.querySelectorAll('.diff-noted')).toHaveLength(2)
    expect(host.querySelector('.diff-noted[data-tone="danger"] .diff-code')!.textContent).toBe('new')
    expect(host.querySelectorAll('.diff-note')[2]!.textContent).toContain('Line 99')
  })

  it('folds a note to its header, with the title beside it', () => {
    const host = mount(() => (
      <StackedDiff path="a.ts" patch={patch}>
        <DiffNote side="new" line={4} title="Added">
          <span>added body</span>
        </DiffNote>
      </StackedDiff>
    ))
    host.querySelector<HTMLButtonElement>('.diff-note-fold')!.click()
    const note = host.querySelector('.diff-note')!
    expect(note.textContent).not.toContain('added body')
    expect(note.querySelector('.diff-note-title')).toBeNull()
    expect(note.querySelector('.diff-note-peek')!.textContent).toBe('Added')
    host.querySelector<HTMLButtonElement>('.diff-note-fold')!.click()
    expect(note.textContent).toContain('added body')
  })

  it('sends the side and line of the ✦ pressed, and shows no ✦ without onActivate', () => {
    const activate = vi.fn()
    const host = mount(() => <StackedDiff path="a.ts" patch={patch} onActivate={activate} />)
    const asks = host.querySelectorAll<HTMLButtonElement>('.diff-ask-btn')
    expect(asks).toHaveLength(4)
    asks[0]!.click()
    asks[1]!.click()
    asks[2]!.click()
    expect(activate.mock.calls).toEqual([
      [{ side: 'new', line: 3 }],
      [{ side: 'old', line: 4 }],
      [{ side: 'new', line: 4 }],
    ])
    expect(mount(() => <StackedDiff path="a.ts" patch={patch} />).querySelector('.diff-ask-btn')).toBeNull()
  })
})

describe('diff line editor navigation', () => {
  it('opens an agent chat on either side without triggering a row action', () => {
    const askAgent = vi.fn()
    const rowClick = vi.fn()
    const host = mount(() => (
      <div class="diff-row" onClick={rowClick}>
        <DiffLine r={insert} canAdd={false} addComment={async () => {}} onMutated={() => {}} askAgent={askAgent} />
        <SplitCell
          r={deleted}
          gutter={48}
          canAdd={false}
          addComment={async () => {}}
          onMutated={() => {}}
          askAgent={askAgent}
        />
      </div>
    ))
    const buttons = host.querySelectorAll<HTMLButtonElement>('.diff-ask-btn')
    expect(buttons).toHaveLength(2)
    buttons[0]!.click()
    buttons[1]!.click()
    expect(askAgent.mock.calls).toEqual([[insert], [deleted]])
    expect(rowClick).not.toHaveBeenCalled()
  })

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
        <SplitCell
          r={deleted}
          gutter={48}
          canAdd={false}
          addComment={async () => {}}
          onMutated={() => {}}
          openLine={openLine}
        />
        <SplitCell
          r={insert}
          gutter={48}
          canAdd={false}
          addComment={async () => {}}
          onMutated={() => {}}
          openLine={openLine}
        />
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
        row={{
          kind: 'thread',
          thread: {
            threadId: 'thread-1',
            path: 'src/example.ts',
            line: 48,
            side: 'RIGHT',
            resolved: false,
            comments: [
              {
                id: 'comment-1',
                databaseId: 1,
                author: 'reviewer',
                createdAt: null,
                body: '<p><strong>Review</strong> <img src="https://attacker.test/pixel" onerror="run()"><a href="javascript:run()">unsafe</a> <a href="https://example.test/">safe</a></p>',
              },
            ],
          },
        }}
        onMutated={() => {}}
        resolveThread={async () => {}}
        reply={async () => {}}
      />
    ))
    const body = host.querySelector('.diff-thread-comment .ui-markdown')
    expect(body?.innerHTML).toBe(
      '<p><strong>Review</strong> unsafe <a href="https://example.test/" target="_blank" rel="noopener noreferrer">safe</a></p>',
    )
    expect(body?.querySelector('img, script, [onerror]')).toBeNull()
  })
})
