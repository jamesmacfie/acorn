import { batch, createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { expect, it } from 'vitest'
import { DiffCanvas } from './DiffCanvas'
import type { CodeRow } from '../../kit/diff/diffModel'

it('preserves an overlapping focused composer while updating geometry, row text, and comment targets', () => {
  const initialRows: CodeRow[] = Array.from({ length: 260 }, (_, n) => ({ kind: 'insert', path: 'synthetic.ts', oldNo: null,
    newNo: n + 1, raw: `const value${n} = ${n}`, toks: [{ content: `const value${n} = ${n}`, light: '', dark: '' }] }))
  const virtual = (start: number) => Array.from({ length: 200 }, (_, n) => ({ key: `row${n + start}`, index: n + start, start: (n + start) * 20, end: (n + start + 1) * 20, size: 20 }))
  const [rows, setRows] = createSignal(initialRows)
  const [opened, setOpened] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal('')
  const [commentOffset, setCommentOffset] = createSignal(0)
  const submissions: { key: string; line: number; body: string }[] = []
  const [items, setItems] = createSignal(virtual(0))
  const host = document.createElement('div'); document.body.append(host)
  const virt = { getVirtualItems: items, getTotalSize: () => 5200 } as any
  const clean = render(() => <DiffCanvas viewMode={() => 'unified'} rows={rows} bands={() => []}
    virt={virt} splitVirt={{ getVirtualItems: () => [], getTotalSize: () => 0 } as any}
    stickyHead={() => null} publishScrollEl={() => {}} onScroll={() => {}} maxCols={() => 25}
    scheduleElementMeasure={() => {}} shouldMeasureRow={() => false} shouldMeasureBand={() => false}
    hasLineExtra={() => false} onMutated={() => {}} resolveThread={async () => {}} replyReview={async () => {}}
    expandGap={async () => {}} retryDiff={() => {}} loadStatus={() => 'loading'} mentions={() => []}
    threadCollapse={() => ({ collapsed: () => false, setCollapsed: () => {} })} fileCollapsed={() => false}
    onToggleFileCollapse={() => {}} lineComment={(row) => ({ key: String(row.newNo! + commentOffset()), side: 'RIGHT', lineNo: row.newNo! + commentOffset(), canAdd: true })}
    addComment={async (body, row, _side, line) => { submissions.push({ key: row.raw, line, body }) }}
    composerFor={(key) => ({ isOpen: () => opened() === key, body: draft, setBody: setDraft, setOpen: (value) => setOpened(value ? key : null) })} splitComposer={() => undefined}
    canComment={() => false} invalidate={() => {}} findHighlight={() => undefined} />, host)
  const before = new Map([...host.querySelectorAll('.diff-row')].map((el) => [el.getAttribute('data-index'), el]))
  const target = before.get('100')!
  ;(target.querySelector('.diff-add-btn') as HTMLButtonElement).click()
  const textarea = target.querySelector('textarea')!
  textarea.value = 'kept draft'; textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.focus(); textarea.setSelectionRange(3, 5)
  setItems(virtual(1))
  expect(host.querySelector('[data-index="100"]')).toBe(target)
  expect(target.querySelector('textarea')).toBe(textarea)
  expect(document.activeElement).toBe(textarea); expect(textarea.selectionStart).toBe(3); expect(draft()).toBe('kept draft')
  const next = [...rows()]; next[100] = { ...next[100], raw: 'updated source', toks: [{ content: 'updated source', light: '', dark: '' }] }; setRows(next)
  expect(target.textContent).toContain('updated source'); expect(target.querySelector('textarea')).toBe(textarea)
  // A taller row above the focused composer moves its geometry without replacing its owner.
  setItems(items().map((vi) => ({ ...vi, start: vi.start + 7 })))
  expect((target as HTMLElement).style.transform).toBe('translateY(2007px)')
  batch(() => {
    setRows([{ kind: 'insert', path: 'synthetic.ts', oldNo: null, newNo: 0, raw: 'prepended', toks: [] }, ...rows()])
    setItems(items().map((vi) => ({ ...vi, index: vi.index + 1 })))
  })
  expect(target.getAttribute('data-index')).toBe('101')
  expect(target.textContent).toContain('updated source')
  expect(target.querySelector('textarea')).toBe(textarea)
  setCommentOffset(10)
  expect(target.querySelector('textarea')).toBeNull()
  ;(target.querySelector('.diff-add-btn') as HTMLButtonElement).click()
  const fresh = target.querySelector('textarea')!; fresh.value = 'new target'; fresh.dispatchEvent(new Event('input', { bubbles: true }))
  ;([...target.querySelectorAll('button')].find((button) => button.textContent === 'Comment') as HTMLButtonElement).click()
  expect(submissions).toEqual([{ key: 'updated source', line: 111, body: 'new target' }])
  clean(); host.remove()
})

it('preserves split composers and fresh cells across window and model updates', () => {
  const initialRows: CodeRow[] = Array.from({ length: 260 }, (_, n) => ({ kind: 'insert', path: 'synthetic.ts', oldNo: null,
    newNo: n + 1, raw: `const value${n} = ${n}`, toks: [{ content: `const value${n} = ${n}`, light: '', dark: '' }] }))
  const virtual = (start: number) => Array.from({ length: 200 }, (_, n) => ({ key: `row${n + start}`, index: n + start, start: (n + start) * 20, end: (n + start + 1) * 20, size: 20 }))
  const [rows, setRows] = createSignal(initialRows)
  const [opened, setOpened] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal('')
  const [commentOffset] = createSignal(0)
  const submissions: { key: string; line: number; body: string }[] = []
  const [items, setItems] = createSignal(virtual(0))
  const host = document.createElement('div'); document.body.append(host)
  const virt = { getVirtualItems: items, getTotalSize: () => 5200 } as any
  const clean = render(() => <DiffCanvas viewMode={() => 'split'} rows={rows} bands={() => rows().map((right) => ({ kind: 'pair' as const, left: null, right }))}
    virt={virt} splitVirt={virt}
    stickyHead={() => null} publishScrollEl={() => {}} onScroll={() => {}} maxCols={() => 25}
    scheduleElementMeasure={() => {}} shouldMeasureRow={() => false} shouldMeasureBand={() => false}
    hasLineExtra={() => false} onMutated={() => {}} resolveThread={async () => {}} replyReview={async () => {}}
    expandGap={async () => {}} retryDiff={() => {}} loadStatus={() => 'loading'} mentions={() => []}
    threadCollapse={() => ({ collapsed: () => false, setCollapsed: () => {} })} fileCollapsed={() => false}
    onToggleFileCollapse={() => {}} lineComment={(row) => ({ key: String(row.newNo! + commentOffset()), side: 'RIGHT', lineNo: row.newNo! + commentOffset(), canAdd: true })}
    addComment={async (body, row, _side, line) => { submissions.push({ key: row.raw, line, body }) }}
    composerFor={(key) => ({ isOpen: () => opened() === key, body: draft, setBody: setDraft, setOpen: (value) => setOpened(value ? key : null) })} splitComposer={(row) => row ? ({ isOpen: () => opened() === String(row.newNo), body: draft, setBody: setDraft, setOpen: (value) => setOpened(value ? String(row.newNo) : null) }) : undefined}
    canComment={() => true} invalidate={() => {}} findHighlight={() => undefined} />, host)
  const before = new Map([...host.querySelectorAll('.diff-split-band')].map((el) => [el.getAttribute('data-index'), el]))
  const target = before.get('100')!
  ;(target.querySelector('.diff-add-btn') as HTMLButtonElement).click()
  const textarea = target.querySelector('textarea')!
  textarea.value = 'kept draft'; textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.focus(); textarea.setSelectionRange(3, 5)
  const horizontal = target.querySelector('.diff-code') as HTMLElement
  horizontal.scrollLeft = 37; horizontal.dispatchEvent(new Event('scroll'))
  setItems(virtual(1))
  expect((target.querySelector('.diff-code') as HTMLElement).scrollLeft).toBe(37)
  expect((host.querySelector('[data-index="200"] .diff-code') as HTMLElement).scrollLeft).toBe(37)
  expect(host.querySelector('[data-index="100"]')).toBe(target)
  expect(target.querySelector('textarea')).toBe(textarea)
  expect(document.activeElement).toBe(textarea); expect(textarea.selectionStart).toBe(3); expect(draft()).toBe('kept draft')
  const next = [...rows()]; next[100] = { ...next[100], raw: 'updated source', toks: [{ content: 'updated source', light: '', dark: '' }] }; setRows(next)
  expect(target.textContent).toContain('updated source'); expect(target.querySelector('textarea')).toBe(textarea)
  // A taller row above the focused composer moves its geometry without replacing its owner.
  setItems(items().map((vi) => ({ ...vi, start: vi.start + 7 })))
  expect((target as HTMLElement).style.transform).toBe('translateY(2007px)')
  batch(() => {
    setRows([{ kind: 'insert', path: 'synthetic.ts', oldNo: null, newNo: 0, raw: 'prepended', toks: [] }, ...rows()])
    setItems(items().map((vi) => ({ ...vi, index: vi.index + 1 })))
  })
  expect(target.getAttribute('data-index')).toBe('101')
  expect(target.textContent).toContain('updated source')
  expect(target.querySelector('textarea')).toBe(textarea)
  const shifted = [...rows()]; shifted[101] = { ...shifted[101], newNo: 111 }; setRows(shifted)
  expect(target.querySelector('textarea')).toBeNull()
  ;(target.querySelector('.diff-add-btn') as HTMLButtonElement).click()
  const fresh = target.querySelector('textarea')!; fresh.value = 'new target'; fresh.dispatchEvent(new Event('input', { bubbles: true }))
  ;([...target.querySelectorAll('button')].find((button) => button.textContent === 'Comment') as HTMLButtonElement).click()
  expect(submissions).toEqual([{ key: 'updated source', line: 111, body: 'new target' }])
  clean(); host.remove()
})
