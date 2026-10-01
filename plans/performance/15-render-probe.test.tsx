import { afterEach, expect, it } from 'vitest'
import { createSignal, onCleanup } from 'solid-js'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderCells } from '../../apps/tui/src/kit/render'
import { Log, Row, Rows } from '../../apps/tui/src/kit/showing'
import { wrapLines } from '../../apps/tui/src/layout/measure'
import { createBuffer, wholeOf, writeRun } from '../../apps/tui/src/paint/buffer'
import { openRenderer } from '../../apps/tui/src/renderer'
import { render } from '../../apps/tui/src/tree/renderer'
import { startSpinner } from '../../apps/tui/src/kit/tick'
import { Spinner } from '../../apps/tui/src/kit/showing'

const tag = process.env.ACORN_PERF_TAG ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Unsafe output tag')
const record = (name: string, value: unknown) => {
  const path = join(dirname(fileURLToPath(import.meta.url)), `15-${name}-${tag}.json`)
  if (tag.startsWith('before') && existsSync(path)) throw new Error('Before evidence exists')
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}
const stops: (() => void)[] = []
afterEach(() => stops.splice(0).reverse().forEach(fn => fn()))
const cpuMs = (start: NodeJS.CpuUsage) => {
  const used = process.cpuUsage(start)
  return (used.user + used.system) / 1000
}
const treeCounts = (root: any): { nodes: number; yoga: number } => {
  let nodes = 0, yoga = 0
  const visit = (node: any) => { nodes++; if (node.yoga) yoga++; node.children.forEach(visit) }
  visit(root)
  return { nodes, yoga }
}

it('counts initial and settled row owners for actual virtual Rows', async () => {
  const cases: unknown[] = []
  for (const count of [200, 2000, 10000]) {
    const source = Array.from({ length: count }, (_, at) => ({ key: `row-${at}`, label: `Synthetic row ${at}` }))
    let created = 0, disposed = 0
    const before = process.cpuUsage(), started = performance.now()
    const cells = await renderCells(() => <Rows id={`probe-${count}`} virtual items={source}>
      {(row, item) => { created++; onCleanup(() => disposed++); return <Row item={item}>{row.label}</Row> }}
    </Rows>, { width: 80, height: 24 })
    const initial = { created, disposed, retainedRows: created - disposed, ...treeCounts(cells.renderer.root),
      wallMs: performance.now() - started, cpuMs: cpuMs(before) }
    // Mouse movement shifts only the viewport, preserving overlap identities through real For.
    const beforeScroll = { created, disposed }, scrollCpu = process.cpuUsage()
    await cells.scroll(10, 8, 'down')
    const scroll = { created: created - beforeScroll.created, disposed: disposed - beforeScroll.disposed, cpuMs: cpuMs(scrollCpu) }
    cells.done()
    cases.push({ count, initial, scroll, afterDispose: { created, disposed, retainedRows: created - disposed } })
  }
  record('rows', { fixture: 'Actual universal Rows/Row at 80x24; synthetic stable objects; first layout unknown height', cases })
})

it('counts virtual row admission when a retained pane is hidden behind an overlay', async () => {
  const source = Array.from({ length: 2000 }, (_, at) => ({ key: `row-${at}`, label: `Synthetic row ${at}` }))
  const [hidden, setHidden] = createSignal(false)
  let created = 0, disposed = 0
  const cells = await renderCells(() => <box visible={!hidden()} flexDirection="column" flexGrow={1}>
    <Rows id="visibility-probe" virtual items={source}>
      {(row, item) => { created++; onCleanup(() => disposed++); return <Row item={item}>{row.label}</Row> }}
    </Rows>
  </box>, { width: 80, height: 24 })
  try {
    const initial = { created, disposed, retainedRows: created - disposed }
    const cpu = process.cpuUsage(), started = performance.now()
    setHidden(true); await cells.frame()
    const hiddenState = { created, disposed, retainedRows: created - disposed, ...treeCounts(cells.renderer.root), cpuMs: cpuMs(cpu), wallMs: performance.now() - started }
    setHidden(false); await cells.frame()
    const visibleAgain = { created, disposed, retainedRows: created - disposed }
    record('rows-visibility', { fixture: 'Actual Rows2000 at80x24, retained parent visible=false then true as Shell overlays do', initial, hiddenState, visibleAgain })
  } finally { cells.done() }
})

it('measures long word wrapping through the actual measure owner', () => {
  const cases: unknown[] = []
  for (const length of [10000, 100000, 1000000]) {
    const text = 'a'.repeat(length), before = process.cpuUsage(), started = performance.now()
    const lines = wrapLines(text, 80, true)
    expect(lines.join('')).toBe(text)
    cases.push({ length, lines: lines.length, wallMs: performance.now() - started, cpuMs: cpuMs(before) })
  }
  record('wrap', { fixture: 'Actual wrapLines with a single ASCII word at 80 cells; complete contents retained', cases })
})

it('measures fully clipped tails in the actual cell writer', () => {
  const cases: unknown[] = []
  for (const length of [80, 10000, 1000000]) {
    const text = 'a'.repeat(length), buffer = createBuffer(80, 1)
    const before = process.cpuUsage(), started = performance.now()
    let returnedWidth = 0
    for (let repeat = 0; repeat < 20; repeat++) returnedWidth = writeRun(buffer, wholeOf(buffer), 0, 0, text, { fg: 'default', attrs: 0 })
    expect(buffer.cells.map(cell => cell.char).join('')).toBe('a'.repeat(80))
    cases.push({ length, repeats: 20, returnedWidth, wallMs: performance.now() - started, cpuMs: cpuMs(before) })
  }
  record('clipped-paint', { fixture: 'Actual writeRun to an 80x1 buffer; clipping leaves the same 80 cells, return width contract preserved', cases })
})

it('counts unchanged frames driven by a mounted hidden spinner', async () => {
  const [hidden, setHidden] = createSignal(false)
  let writes = 0, frames = 0
  const renderer = openRenderer({ cols: 80, rows: 24, write: () => writes++ })
  const dispose = render(() => <box visible={!hidden()}><Spinner /></box>, renderer.root)
  stops.push(() => { dispose(); renderer.destroy() })
  const stopTick = startSpinner(); stops.push(stopTick)
  renderer.on('frame', () => frames++)
  await new Promise(resolve => setTimeout(resolve, 100))
  setHidden(true)
  await new Promise(resolve => setTimeout(resolve, 40))
  const before = { writes, frames }, cpu = process.cpuUsage()
  await new Promise(resolve => setTimeout(resolve, 800))
  record('hidden-spinner', { fixture: 'Actual Spinner/tick/tree/screen with visible=false parent; 800ms settled hidden interval',
    frames: frames - before.frames, writes: writes - before.writes, cpuMs: cpuMs(cpu) })
})

it('measures hidden spinner frames with a retained hidden log behind an overlay', async () => {
  const [hidden, setHidden] = createSignal(false)
  const lines = Array.from({ length: 10000 }, (_, at) => `Hidden synthetic log line ${at}`)
  let writes = 0, frames = 0
  const renderer = openRenderer({ cols: 80, rows: 24, write: () => writes++ })
  const dispose = render(() => <box flexDirection="column" width={80} height={24}>
    <box visible={!hidden()} flexDirection="column" flexGrow={1}><Spinner /><Log lines={lines} ariaLabel="Hidden log" /></box>
    <box visible={hidden()}><text>Visible synthetic overlay</text></box>
  </box>, renderer.root)
  stops.push(() => { dispose(); renderer.destroy() })
  const stopTick = startSpinner(); stops.push(stopTick)
  renderer.on('frame', () => frames++)
  await new Promise(resolve => setTimeout(resolve, 100))
  setHidden(true)
  await new Promise(resolve => setTimeout(resolve, 40))
  const before = { writes, frames }, cpu = process.cpuUsage()
  await new Promise(resolve => setTimeout(resolve, 800))
  record('hidden-log-spinner', { fixture: 'Actual Spinner/tick/tree/screen plus actual Log10k retained under visible=false parent, visible small sibling overlay;800ms settled hidden interval',
    frames: frames - before.frames, writes: writes - before.writes, cpuMs: cpuMs(cpu), ...treeCounts(renderer.root) })
})

it('measures retained Log rows and repeated warm full frame traversal', async () => {
  const cases: unknown[] = []
  for (const count of [1000, 10000]) {
    const lines = Array.from({ length: count }, (_, at) => `Synthetic line ${at}`)
    const cpu = process.cpuUsage(), started = performance.now()
    const cells = await renderCells(() => <Log lines={lines} ariaLabel="Synthetic log" />, { width: 80, height: 24 })
    const initial = { wallMs: performance.now() - started, cpuMs: cpuMs(cpu), ...treeCounts(cells.renderer.root) }
    const frameCpu = process.cpuUsage(), frameStart = performance.now()
    for (let repeat = 0; repeat < 30; repeat++) cells.renderer.screen.frame()
    const warmFrames = { repeats: 30, wallMs: performance.now() - frameStart, cpuMs: cpuMs(frameCpu) }
    cells.done()
    cases.push({ count, initial, warmFrames })
  }
  record('log', { fixture: 'Actual Log/ScrollViewport at 80x24 with 1k/10k unique synthetic lines; warm 30-frame traversal, no terminal sink latency', cases })
})
