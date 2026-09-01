/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import { LAYOUT_REGIONS, PANE_LAYOUTS, type PaneLayoutName } from '@acorn/protocol/paneLayouts.ts'
import type { LayoutProps, Region } from '@acorn/client-core/host/layouts/regions.ts'
import { hasFfi } from '../ffi'
import { renderCells, type Frame } from '../kit/render'
import { Line } from '../kit/cells'
import { LAYOUTS } from './index'

// One case per layout, drawn from the terminal projection written beside its desktop one in
// docs/panes.md § Layout model, at the two sizes the kit's own suite uses.
//
// Written as "what would a reader look for on the screen" rather than as a snapshot, for the reason
// the kit's suite gives: a snapshot fails on every spacing decision anybody makes afterwards and
// names no promise. The promise here is the projection.

type Case = {
  layout: PaneLayoutName
  /** What the projection says, in the test's own words, so a failure names it. */
  projects: string
  props: Omit<LayoutProps, 'stateKey' | 'label'>
  /** What has to be on the screen at 80 by 24, and at 120 by 40. */
  check: (frame: Frame) => void
}

const region = (text: string): Region => () => <Line>{text}</Line>

const CASES: Case[] = [
  {
    layout: 'single',
    projects: 'the region fills the pane',
    props: { regions: { body: region('the body') } },
    check: (frame) => expect(frame.text).toContain('the body'),
  },
  {
    layout: 'list-detail',
    projects: 'two columns above 80 cells, one at a time below',
    props: { regions: { 'list-header': region('a filter'), list: region('a list'), detail: region('a detail') } },
    // 80 cells is the ceiling, not below it, so both halves are drawn at both sizes here. The
    // narrow projection has a width in it and gets a test of its own below.
    check: (frame) => {
      expect(frame.text).toContain('a list')
      expect(frame.text).toContain('a filter')
      expect(frame.text).toContain('a detail')
    },
  },
  {
    layout: 'header-body-footer',
    projects: 'one line, the rest, one line',
    props: { regions: { header: region('a header'), body: region('a body'), footer: region('a footer') } },
    check: (frame) => {
      expect(frame.lines.findIndex((line) => line.includes('a header')))
        .toBeLessThan(frame.lines.findIndex((line) => line.includes('a body')))
      expect(frame.lines.findIndex((line) => line.includes('a body')))
        .toBeLessThan(frame.lines.findIndex((line) => line.includes('a footer')))
    },
  },
  {
    layout: 'tabs',
    projects: 'the bar is one line; hidden panels never mount',
    props: {
      tabs: [{ id: 'one', label: 'Overview' }, { id: 'two', label: 'Checks' }],
      regions: { 'panel:one': region('the overview'), 'panel:two': region('the checks') },
    },
    check: (frame) => {
      // The bar brackets the open tab, which is the `Tabs` node's own sentence.
      expect(frame.lines[0]).toContain('[Overview]')
      expect(frame.lines[0]).toContain('Checks')
      expect(frame.text).toContain('the overview')
      // The thunk rule: an unselected tab's region is never called, so a pane with eight tabs opens
      // one.
      expect(frame.text).not.toContain('the checks')
    },
  },
  {
    layout: 'document-over-frame',
    projects: 'the document above, the frame below, a rule between',
    props: { regions: { document: region('the document'), frame: region('the frame') } },
    check: (frame) => {
      expect(frame.lines.findIndex((line) => line.includes('the document')))
        .toBeLessThan(frame.lines.findIndex((line) => line.includes('the frame')))
    },
  },
  {
    layout: 'frame-beside-document',
    projects: 'the same two regions with the axis flipped by the name',
    props: { regions: { document: region('the document'), frame: region('the frame') } },
    check: (frame) => {
      // Side by side, so both are on one line. That is the whole difference between the two names,
      // and it is why the axis is in the name and never in a prop.
      expect(frame.lines.find((line) => line.includes('the document'))).toContain('the frame')
    },
  },
  {
    layout: 'stack-split',
    projects: 'two blocks with a rule between, the split moved by a key',
    props: { regions: { top: region('the top'), bottom: region('the bottom') } },
    check: (frame) => {
      expect(frame.lines.findIndex((line) => line.includes('the top')))
        .toBeLessThan(frame.lines.findIndex((line) => line.includes('the bottom')))
    },
  },
  {
    layout: 'wizard',
    projects: 'one step at a time, the count on the header line, the actions on the footer',
    props: {
      steps: [{ id: 'a', label: 'Repos' }, { id: 'b', label: 'Agents' }, { id: 'c', label: 'Done' }],
      current: 'b',
      regions: { step: region('the step') },
    },
    check: (frame) => {
      expect(frame.text).toContain('STEP 2 OF 3')
      expect(frame.text).toContain('AGENTS')
      expect(frame.text).toContain('the step')
      // Back because there is a step behind, Next because there is one ahead.
      expect(frame.text).toContain('Back')
      expect(frame.text).toContain('Next')
    },
  },
]

const draw = (entry: Case, size: { width: number; height: number }) => {
  const Layout = LAYOUTS[entry.layout]
  return renderCells(() => <Layout stateKey={`pane-${entry.layout}`} label="Test" {...entry.props} />, size)
}

describe.skipIf(!hasFfi)('the layouts in cells', () => {
  it('has a case for every layout name, and no case for one that is gone', () => {
    expect(CASES.map((entry) => entry.layout).sort()).toEqual([...PANE_LAYOUTS].sort())
    // Every case fills only regions the layout actually has, so a case cannot pass by drawing
    // something the protocol would refuse (@acorn/protocol/paneLayouts.ts).
    for (const entry of CASES) {
      const spec = LAYOUT_REGIONS[entry.layout]
      const known = new Set([...spec.required, ...spec.optional])
      for (const name of Object.keys(entry.props.regions)) {
        expect(known.has(name) || (spec.prefix !== undefined && name.startsWith(spec.prefix))).toBe(true)
      }
    }
  })

  it.each(CASES.map((entry) => [`${entry.layout}: ${entry.projects}`, entry] as const))(
    '%s at 80 by 24',
    async (_name, entry) => {
      const frame = await draw(entry, { width: 80, height: 24 })
      try {
        entry.check(frame)
        // 80 cells is the contract, not an accident: a wider line is a layout that read a width it
        // does not have (docs/ui-design.md § What the kit and layouts must never do).
        for (const line of frame.lines) expect(line.length).toBeLessThanOrEqual(80)
      } finally {
        frame.done()
      }
    },
    20_000,
  )

  it.each(CASES.map((entry) => [`${entry.layout}: ${entry.projects}`, entry] as const))(
    '%s at 120 by 40',
    async (_name, entry) => {
      const frame = await draw(entry, { width: 120, height: 40 })
      try {
        entry.check(frame)
        for (const line of frame.lines) expect(line.length).toBeLessThanOrEqual(120)
      } finally {
        frame.done()
      }
    },
    20_000,
  )

  it('list-detail draws both halves above 80 cells and one below, and a key switches them', async () => {
    // The one projection with a width in it, so it gets a test with a width in it.
    const wide = await draw(CASES.find((entry) => entry.layout === 'list-detail')!, { width: 100, height: 24 })
    try {
      expect(wide.text).toContain('a list')
      expect(wide.text).toContain('a detail')
    } finally {
      wide.done()
    }

    const narrow = await draw(CASES.find((entry) => entry.layout === 'list-detail')!, { width: 60, height: 24 })
    try {
      expect(narrow.text).toContain('a list')
      expect(narrow.text).not.toContain('a detail')
      // `expand` and `collapse` are `l` and `h`; both switch, because a narrow `list-detail` has two
      // halves and no third place to go.
      const after = await narrow.press('l')
      expect(after.text).toContain('a detail')
      expect(after.text).not.toContain('a list')
    } finally {
      narrow.done()
    }
  }, 30_000)

  it('the tabs layout switches on Ctrl+N, and the strip and the chord agree', async () => {
    // Ctrl rather than the desktop's Cmd: macOS terminal emulators keep Cmd and never deliver it, so
    // the chord as written on the desktop is one nobody can press here (../keys/commandLayer.ts §
    // asCtrl). Both the chord and the strip's own arrows write the same stored selection, so a reader
    // who switches one way and then the other does not find two answers (./Tabs.tsx).
    const frame = await draw(CASES.find((entry) => entry.layout === 'tabs')!, { width: 80, height: 24 })
    try {
      const second = await frame.press('2', { ctrl: true })
      expect(second.lines[0]).toContain('[Checks]')
      expect(second.text).toContain('the checks')
      // Escape climbs out of the panel to the strip that owns it, which is the only way in: the strip
      // is not a region of its own, so a reader reaches it from below (../keys/regions.ts § parentOf).
      const strip = await second.press('ESCAPE')
      const back = await strip.press('ARROW_LEFT')
      expect(back.lines[0]).toContain('[Overview]')
    } finally {
      frame.done()
    }
  }, 30_000)

  it('a layout re-lays out when the terminal is resized', async () => {
    // `SIGWINCH` is the renderer's: it listens for the signal itself and re-lays out, and no layout
    // reads the terminal's size, so a resize is one thing rather than eight
    // (docs/tui.md § What the TUI never does).
    const frame = await draw(CASES.find((entry) => entry.layout === 'list-detail')!, { width: 60, height: 24 })
    try {
      expect(frame.text).not.toContain('a detail')
      const wider = await frame.resize(100, 24)
      expect(wider.text).toContain('a list')
      expect(wider.text).toContain('a detail')
    } finally {
      frame.done()
    }
  }, 30_000)
})
