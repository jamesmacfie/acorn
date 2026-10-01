import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { DiffCanvas } from '../../packages/client-core/src/features/diff/DiffCanvas'
import type { CodeRow } from '../../packages/client-core/src/kit/diff/diffModel'

it('tracks the actual DiffCanvas DOM across a virtual window update', () => {
  const rows: CodeRow[] = Array.from({ length: 260 }, (_, n) => ({ kind: 'insert', path: 'synthetic.ts', oldNo: null,
    newNo: n + 1, raw: `const value${n} = ${n}`, toks: [{ content: `const value${n} = ${n}`, light: '', dark: '' }] }))
  const virtual = (start: number) => Array.from({ length: 200 }, (_, n) => ({ key: `row${n + start}`, index: n + start, start: (n + start) * 20, end: (n + start + 1) * 20, size: 20 }))
  const [items, setItems] = createSignal(virtual(0))
  const host = document.createElement('div'); document.body.append(host)
  const virt = { getVirtualItems: items, getTotalSize: () => 5200 } as any
  const clean = render(() => <DiffCanvas viewMode={() => 'unified'} rows={() => rows} bands={() => []}
    virt={virt} splitVirt={{ getVirtualItems: () => [], getTotalSize: () => 0 } as any}
    stickyHead={() => null} publishScrollEl={() => {}} onScroll={() => {}} maxCols={() => 25}
    scheduleElementMeasure={() => {}} shouldMeasureRow={() => false} shouldMeasureBand={() => false}
    hasLineExtra={() => false} onMutated={() => {}} resolveThread={async () => {}} replyReview={async () => {}}
    expandGap={async () => {}} retryDiff={() => {}} loadStatus={() => 'loading'} mentions={() => []}
    threadCollapse={() => ({ collapsed: () => false, setCollapsed: () => {} })} fileCollapsed={() => false}
    onToggleFileCollapse={() => {}} lineComment={() => ({ key: '', side: 'RIGHT', lineNo: 1, canAdd: false })}
    addComment={async () => {}} composerFor={() => undefined as any} splitComposer={() => undefined}
    canComment={() => false} invalidate={() => {}} findHighlight={() => undefined} />, host)
  const before = new Map([...host.querySelectorAll('.diff-row')].map((el) => [el.getAttribute('data-index'), el]))
  const target = before.get('100')!
  const selection = window.getSelection()!
  const node = target.querySelector('.diff-code')?.firstChild ?? target
  const range = document.createRange(); range.selectNodeContents(node); selection.removeAllRanges(); selection.addRange(range)
  const cpu = process.cpuUsage(); const started = performance.now()
  setItems(virtual(1))
  const elapsedMs = performance.now() - started; const used = process.cpuUsage(cpu)
  const after = new Map([...host.querySelectorAll('.diff-row')].map((el) => [el.getAttribute('data-index'), el]))
  const common = [...after.keys()].filter((key) => before.has(key))
  const preserved = common.filter((key) => before.get(key) === after.get(key)).length
  const result = { case: 'one-row-window-shift', before: before.size, after: after.size, overlap: common.length, preserved,
    oldSelectedRowConnected: target.isConnected, selectionInsideOldRow: target.contains(selection.anchorNode), elapsedMs,
    cpuMs: (used.user + used.system) / 1000 }
  writeFileSync(`${process.cwd()}/plans/performance/10-canvas-${process.env.ACORN_PERF_TAG ?? 'sample'}.json`, JSON.stringify(result, null, 2) + '\n')
  expect(common.length).toBe(199); expect(preserved).toBe(0)
  clean(); host.remove()
})
