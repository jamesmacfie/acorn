import { batch, createMemo, createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { expect, it } from 'vitest'
import { DiffCanvas, type DiffRowContext } from './DiffCanvas'
import type { DiffItem } from './documentView'
import type { DiffRangeItem } from './diffLayout'
import type { CodeRow, ViewMode } from '../../kit/diff/diffModel'

it.each(['unified', 'split'] as const)('preserves a focused %s composer across item windows, geometry, and live targets', (mode: ViewMode) => {
  const initial = Array.from({ length: 260 }, (_, n) => ({ key: `row${n}`, row: {
    kind: 'insert' as const, path: 'synthetic.ts', oldNo: null, newNo: n + 1,
    raw: `const value${n} = ${n}`, toks: [{ content: `const value${n} = ${n}`, light: '', dark: '' }],
  } }))
  const [entries, setEntries] = createSignal<{ key: string; row: CodeRow }[]>(initial)
  const [opened, setOpened] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal('')
  const [commentOffset, setCommentOffset] = createSignal(0)
  const submissions: { key: string; line: number; body: string }[] = []
  const virtual = (start: number): DiffRangeItem[] => Array.from({ length: 200 }, (_, n) => ({
    key: `row${n + start}`, index: n + start, start: (n + start) * 20, end: (n + start + 1) * 20,
  }))
  const [range, setRange] = createSignal(virtual(0))
  const file = { path: 'synthetic.ts', status: 'modified', additions: 260, deletions: 0, sha: 'working', viewed: false, patchKey: 'fixture', segments: [] }
  // The canvas consumes keyed resident items. A one-row revealed slice isolates that boundary.
  const items = createMemo<DiffItem[]>(() => entries().map(({ key, row }) => ({ kind: 'overlay', key, file, rows: [row] })))
  const composer = (key: string) => ({ isOpen: () => opened() === key, body: draft, setBody: setDraft, setOpen: (value: boolean) => setOpened(value ? key : null) })
  const context: DiffRowContext = {
    hasLineExtra: () => false, onMutated: () => {}, resolveThread: async () => {}, replyReview: async () => {},
    expandGap: async () => {}, mentions: () => [], threadCollapse: () => ({ collapsed: () => false, setCollapsed: () => {} }),
    lineComment: row => ({ key: String(row.newNo! + commentOffset()), side: 'RIGHT', lineNo: row.newNo! + commentOffset(), canAdd: true }),
    addComment: async (body, row, _side, line) => { submissions.push({ key: row.raw, line, body }) },
    composerFor: composer, splitComposer: row => row ? composer(String(row.newNo! + commentOffset())) : undefined,
    canComment: () => true, findHighlight: () => undefined, lineBlock: () => null, bandBlock: () => null, observeBlock: () => {},
  }
  const host = document.createElement('div'); document.body.append(host)
  const clean = render(() => <DiffCanvas viewMode={() => mode} items={items}
    layout={{ range, attachCanvas: () => {}, observeBlock: () => {}, input: () => {} }}
    stickyHead={() => null} publishScrollEl={() => {}} onScroll={() => {}} maxCols={() => 25}
    itemRows={item => item.kind === 'overlay' ? item.rows : []} segmentStatus={() => undefined} retrySegment={() => {}}
    fileCollapsed={() => false} onToggleFileCollapse={() => {}} fileMarks={() => undefined} rows={context} />, host)
  try {
    const before = new Map([...host.querySelectorAll('.diff-item')].map(el => [el.getAttribute('data-index'), el]))
    const target = before.get('100')!
    ;(target.querySelector('.diff-add-btn') as HTMLButtonElement).click()
    const textarea = target.querySelector('textarea')!
    textarea.value = 'kept draft'; textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.focus(); textarea.setSelectionRange(3, 5)
    if (mode === 'split') {
      const horizontal = target.querySelector('.diff-code') as HTMLElement
      horizontal.scrollLeft = 37; horizontal.dispatchEvent(new Event('scroll'))
    }
    setRange(virtual(1))
    expect(host.querySelector('[data-index="100"]')).toBe(target)
    expect(target.querySelector('textarea')).toBe(textarea)
    expect(document.activeElement).toBe(textarea); expect(textarea.selectionStart).toBe(3); expect(draft()).toBe('kept draft')
    if (mode === 'split') {
      expect((target.querySelector('.diff-code') as HTMLElement).scrollLeft).toBe(37)
      expect((host.querySelector('[data-index="200"] .diff-code') as HTMLElement).scrollLeft).toBe(37)
    }
    setEntries(entries().map(entry => entry.key === 'row100' ? { ...entry, row: { ...entry.row, raw: 'updated source', toks: [{ content: 'updated source', light: '', dark: '' }] } } : entry))
    expect(target.textContent).toContain('updated source'); expect(target.querySelector('textarea')).toBe(textarea)
    setRange(range().map(vi => ({ ...vi, start: vi.start + 7 })))
    expect((target as HTMLElement).style.transform).toBe('translateY(2007px)')
    batch(() => {
      setEntries([{ key: 'prepended', row: { kind: 'insert', path: 'synthetic.ts', oldNo: null, newNo: 0, raw: 'prepended', toks: [] } }, ...entries()])
      setRange(range().map(vi => ({ ...vi, index: vi.index + 1 })))
    })
    expect(target.getAttribute('data-index')).toBe('101')
    expect(target.textContent).toContain('updated source'); expect(target.querySelector('textarea')).toBe(textarea)
    if (mode === 'unified') setCommentOffset(10)
    else setEntries(entries().map(entry => entry.key === 'row100' ? { ...entry, row: { ...entry.row, newNo: 111 } } : entry))
    expect(target.querySelector('textarea')).toBeNull()
    ;(target.querySelector('.diff-add-btn') as HTMLButtonElement).click()
    const fresh = target.querySelector('textarea')!; fresh.value = 'new target'; fresh.dispatchEvent(new Event('input', { bubbles: true }))
    ;([...target.querySelectorAll('button')].find(button => button.textContent === 'Comment') as HTMLButtonElement).click()
    expect(submissions).toEqual([{ key: 'updated source', line: 111, body: 'new target' }])
  } finally { clean(); host.remove() }
})
