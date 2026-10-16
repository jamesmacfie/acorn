/** @jsxImportSource @acorn/tui/jsx */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { PaneLayoutName } from '@acorn/protocol/paneLayouts.ts'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import type { LayoutProps } from '@acorn/client-core/host/layouts'
import { setPalette, TERMINAL_PALETTE, type Palette } from '../appearance'
import type { Color } from '../colour'
import { LAYOUTS } from '../layouts'
import { ATTRS, type Run } from '../paint/buffer'
import { TreeHost } from '../plugins/TreeHost'
import { Line } from './cells'
import { renderCells, type Cells } from './render'

// The terminal half of the site's specimens (docs/site/specimens.md). The site records each
// specimen's tree into apps/site/src/generated/specimens/<id>.tree.json, and this draws those batches
// through the terminal TreeHost at the specimen's size and commits the cells beside them as
// <id>.cells.json. It fails when the committed cells differ; `UPDATE_SPECIMENS=1` rewrites them. A
// layout's picture records the layout in place of batches, and this draws the terminal's own layout
// component with every region holding its name.
//
// It reads and writes the site's files by path rather than importing anything from it, so the rule that
// apps never import each other holds. It lives here because the cell renderer does.

const DIR = fileURLToPath(new URL('../../../site/src/generated/specimens/', import.meta.url))
const update = process.env.UPDATE_SPECIMENS === '1'

// A run records its colour as the palette slot that chose it, so the site can paint it in any theme.
// Every slot gets a colour of its own here, which is what lets a colour be read back as its slot.
const PROBE: Palette = { ...TERMINAL_PALETTE, hover: 4, selected: 5 }
const SLOT_OF = new Map(Object.entries(PROBE).map(([slot, colour]) => [colour, slot]))

const slotOf = (colour: Color): string => {
  const slot = SLOT_OF.get(colour as Exclude<Color, readonly number[]>)
  if (!slot) throw new Error(`A run is drawn in ${JSON.stringify(colour)}, which is no palette slot.`)
  return slot
}

type CellRun = { text: string; fg?: string; bg?: string; attrs?: string[] }

const cellRun = (run: Run): CellRun => {
  const attrs = Object.entries(ATTRS)
    .filter(([, bit]) => run.attrs & bit)
    .map(([name]) => name)
  return {
    text: run.text,
    ...(run.fg === 'default' ? {} : { fg: slotOf(run.fg) }),
    ...(run.bg === 'default' ? {} : { bg: slotOf(run.bg) }),
    ...(attrs.length > 0 ? { attrs } : {}),
  }
}

/** One terminal row per line, so a change shows in review as the rows it moved. */
const serialize = (columns: number, rows: number, lines: CellRun[][]): string =>
  `{"columns":${columns},"rows":${rows},"lines":[\n${lines.map((line) => JSON.stringify(line)).join(',\n')}\n]}\n`

/** The frame's rows as runs, and the frame closed. */
function readFrame(cells: Cells): CellRun[][] {
  const lines = cells.renderer.screen.runs().map((line) => {
    const runs = line.map(cellRun)
    // Trailing blank cells are the frame's padding, which the site draws from the size.
    const last = runs.at(-1)
    if (last && Object.keys(last).length === 1) last.text = last.text.trimEnd()
    return runs.filter((run) => run.text !== '')
  })
  cells.done()
  return lines
}

type RecordedLayout = Omit<LayoutProps, 'stateKey' | 'regions'> & { name: PaneLayoutName; regions: string[] }

async function drawLayout(
  { name, regions, ...props }: RecordedLayout,
  id: string,
  size: { columns: number; rows: number },
): Promise<CellRun[][]> {
  const Layout = LAYOUTS[name]
  const named = Object.fromEntries(
    regions.map((region) => [region, () => <Line tone="muted">{`${region} region`}</Line>]),
  )
  const mounted = await renderCells(() => <Layout {...props} stateKey={id} regions={named} />, {
    width: size.columns,
    height: size.rows,
  })
  return readFrame(await mounted.frame())
}

async function drawTerminal(batches: TreeMutation[][], size: { columns: number; rows: number }): Promise<CellRun[][]> {
  const problems: string[] = []
  let deliver: (ops: readonly TreeMutation[]) => void = () => {}
  const transport = {
    onBatch: (listener: typeof deliver) => ((deliver = listener), () => {}),
    onFailed: () => () => {},
    send: () => {},
  }
  const mounted = await renderCells(
    () => (
      <TreeHost
        pluginId="specimen"
        transport={transport}
        onFailed={(reason) => problems.push(`failed: ${reason}`)}
        onRefused={(reason) => problems.push(`refused: ${reason}`)}
      />
    ),
    { width: size.columns, height: size.rows },
  )
  for (const ops of batches) deliver(ops)
  // The terminal TreeHost applies a batch on the next timer turn.
  await new Promise((done) => setTimeout(done, 0))
  const lines = readFrame(await mounted.frame())
  expect(problems).toEqual([])
  return lines
}

const specimens = readdirSync(DIR)
  .filter((name) => name.endsWith('.tree.json'))
  .map((name) => ({ id: name.replace(/\.tree\.json$/, ''), ...JSON.parse(readFileSync(join(DIR, name), 'utf8')) }))
  .map(({ id, meta, batches, layout }) => ({
    id,
    size: meta.terminal as { columns: number; rows: number },
    batches: batches as TreeMutation[][] | undefined,
    layout: layout as RecordedLayout | undefined,
  }))

let timeZone: string | undefined
beforeAll(() => {
  setPalette(PROBE)
  timeZone = process.env.TZ
  process.env.TZ = 'UTC'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-15T09:30:00Z'))
})
afterAll(() => {
  setPalette(TERMINAL_PALETTE)
  process.env.TZ = timeZone
  vi.useRealTimers()
})

it('finds the recorded specimens', () => {
  expect(specimens.length).toBeGreaterThan(0)
})

it.each(specimens)('$id draws the committed cells', async ({ id, size, batches, layout }) => {
  const lines = layout ? await drawLayout(layout, id, size) : await drawTerminal(batches ?? [], size)
  const generated = serialize(size.columns, size.rows, lines)
  const path = join(DIR, `${id}.cells.json`)
  if (update) writeFileSync(path, generated)
  expect(
    readFileSync(path, 'utf8'),
    `${id}.cells.json is stale. Run UPDATE_SPECIMENS=1 pnpm --filter @acorn/site specimens`,
  ).toBe(generated)
})
