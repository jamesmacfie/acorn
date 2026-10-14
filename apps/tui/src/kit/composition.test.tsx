/** @jsxImportSource @acorn/tui/jsx */
import { For } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { renderCells, type Frame } from './render'
import { Line } from './cells'
import { LAYOUTS } from '../layouts'
import {
  Button,
  DetailColumn,
  EmptyState,
  FilterBar,
  Heading,
  Input,
  ListColumn,
  ListDetail,
  Row,
  SectionHeader,
  Stack,
  Toolbar,
  ToolbarSpacer,
} from './ui'

// Kit nodes drawn together, the way a plugin pane puts them down, rather than one at a time.
//
// ./kit.test.tsx draws each node alone, and each of these looked right alone. The Database pane built
// from them did not: the two columns split the frame in half with nothing between them, the list
// pushed the frame taller instead of scrolling, and the bar ran straight into the rows under it. A
// pane written against the kit should get its structure from the kit, so this is where that promise
// is held. The shape is the Database pane's, which is the common one: a bar, then a list beside a
// detail, in a frame under a host document.

const TABLES = Array.from({ length: 120 }, (_, i) => `table_${i}`)

const draw = (size: { width: number; height: number }) => {
  const Layout = LAYOUTS['document-over-frame']
  return renderCells(
    () => (
      <Layout
        stateKey={`composition-${size.width}`}
        label="Database"
        regions={{
          document: () => <Line>SELECT 1;</Line>,
          frame: () => (
            <Stack gap="none" grow>
              <Toolbar variant="bar" ariaLabel="Database">
                <Heading level={2}>Database</Heading>
                <ToolbarSpacer />
                <Button size="sm">Run</Button>
              </Toolbar>
              <ListDetail split listLabel="Tables">
                <ListColumn label="Tables">
                  <SectionHeader count={TABLES.length}>Tables</SectionHeader>
                  <FilterBar ariaLabel="Filter tables">
                    <Input
                      kind="filter"
                      label="Filter tables"
                      placeholder="Filter tables…"
                      value=""
                      onChange={() => {}}
                    />
                  </FilterBar>
                  <For each={TABLES}>{(name) => <Row density="compact">{name}</Row>}</For>
                </ListColumn>
                <DetailColumn>
                  <EmptyState title="Choose a table, or run a query" />
                </DetailColumn>
              </ListDetail>
            </Stack>
          ),
        }}
      />
    ),
    size,
  )
}

const lineIndex = (frame: Frame, text: string) => frame.lines.findIndex((line) => line.includes(text))
// The cells inside the frame's left border, so a rule reads as a run of `─` from where content starts.
const inside = (line: string) => line.slice(1)

describe('a list pane in a document split', () => {
  it('draws the bar, the split and the document at 120 by 40', async () => {
    const frame = await draw({ width: 120, height: 40 })
    try {
      // The stacked document keeps its rows. It drew as two borders with nothing between them.
      expect(frame.text).toContain('SELECT 1;')
      // The bar ends in a rule.
      expect(inside(frame.lines[lineIndex(frame, 'Database') + 1])).toMatch(/^─{20}/)
      // The column's label is its accessible name on the DOM, not a second heading over the first.
      expect(frame.text).not.toContain('TABLES')
      // The list is a column of its own beside the detail, with a divider down its whole height.
      const detail = frame.lines[lineIndex(frame, 'Choose a table')]
      expect(detail.indexOf('Choose a table')).toBeLessThan(40)
      expect(detail.slice(30, 36)).toContain('│')
      expect(frame.lines[lineIndex(frame, 'table_10')].slice(30, 36)).toContain('│')
      // The list scrolls its own rows. It pushed the frame taller, and the bar scrolled away with it.
      expect(frame.text).not.toContain('table_119')
      expect(lineIndex(frame, 'Database')).toBeLessThan(lineIndex(frame, 'table_0'))
    } finally {
      frame.done()
    }
  }, 20_000)

  it('stacks the columns and keeps every line in 80 cells at 80 by 24', async () => {
    const frame = await draw({ width: 80, height: 24 })
    try {
      expect(frame.text).toContain('SELECT 1;')
      expect(frame.text).toContain('Database')
      expect(frame.text).toContain('table_0')
      for (const line of frame.lines) expect(line.length).toBeLessThanOrEqual(80)
    } finally {
      frame.done()
    }
  }, 20_000)

  // The DOM's three column genres keep their order here: an identifier switcher, a browse list, and
  // a column that holds a document. The terminal used one width for all three.
  it.each([
    ['narrow', 20],
    ['default', 32],
    ['wide', 48],
  ] as const)(
    'puts the divider after a %s list',
    async (listWidth, cells) => {
      const frame = await renderCells(
        () => (
          <ListDetail split listWidth={listWidth}>
            <ListColumn>
              <Line>the list</Line>
            </ListColumn>
            <DetailColumn>
              <Line>the detail</Line>
            </DetailColumn>
          </ListDetail>
        ),
        { width: 120, height: 6 },
      )
      try {
        expect(frame.lines[lineIndex(frame, 'the list')].indexOf('│')).toBe(cells)
      } finally {
        frame.done()
      }
    },
    20_000,
  )
})
