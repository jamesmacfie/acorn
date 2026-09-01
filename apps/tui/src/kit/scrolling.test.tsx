/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import { hasFfi } from '../ffi'
import { Button } from './asking'
import { Sections } from './grouping'
import { Row, Rows, Text } from './showing'
import { renderCells } from './render'
import { HeaderBodyFooter } from '../layouts/HeaderBodyFooter'

const items = (count: number) => Array.from({ length: count }, (_, index) => ({
  key: `row-${index + 1}`,
  label: `Row ${index + 1}`,
}))

/** What has the keys, read off the frame: `litControl` draws a focused control `strong` in the accent
 *  slot, and accent is the one slot whose red channel sits below its green (../appearance.ts). */
const lit = (screen: { runs: () => { text: string; fg: { r: number; g: number; b: number }; attributes: number }[] }): string[] =>
  screen.runs().filter((run) => run.text.trim() && run.fg.r < run.fg.g && (run.attributes & 1) === 1).map((run) => run.text)

describe.skipIf(!hasFfi)('scrolling detail viewports', () => {
  it('enters a selected tab with Down, reveals keyboard rows, and returns with Escape', async () => {
    const rows = items(18)
    const screen = await renderCells(() => (
      <HeaderBodyFooter
        stateKey="detail"
        label="Detail"
        regions={{
          body: () => (
            <Sections
              id="test-sections"
              header={{ id: 'summary', label: 'Summary', render: () => <Text>Summary body</Text> }}
              sections={[{
                id: 'comments',
                label: 'Comments',
                count: rows.length,
                render: () => (
                  <Rows id="comments" items={rows}>
                    {(row, item) => <Row item={item}>{row.label}</Row>}
                  </Rows>
                ),
              }]}
            />
          ),
        }}
      />
    ), { width: 44, height: 10 })

    try {
      const comments = await screen.press('ARROW_RIGHT')
      expect(comments.text).toContain('[Comments] 18')

      const entered = await comments.press('ARROW_DOWN')
      expect(entered.lines.find((line) => line.includes('›'))).toContain('Row 1')

      let moved = entered
      for (let index = 0; index < 12; index += 1) moved = await moved.press('j')
      expect(moved.lines.find((line) => line.includes('›'))).toContain('Row 13')
      expect(moved.text).not.toContain('Row 1\n')

      const back = await moved.press('ESCAPE')
      expect(back.text).toContain('[Comments] 18')
      expect(back.lines.some((line) => line.includes('›'))).toBe(false)
    } finally {
      screen.done()
    }
  }, 30_000)

  it('moves between the stops of a document with the arrows and scrolls it with the page keys', async () => {
    // The rule the footer has to be able to say in two words: arrows move, page keys scroll. The
    // paragraph between the two buttons is skipped by `↓` and read with `pgup`/`pgdn`
    // (docs/tui.md § Scrolling viewports).
    const screen = await renderCells(() => (
      <HeaderBodyFooter
        stateKey="document"
        label="Document"
        regions={{
          body: () => (
            <>
              <Button onPress={() => {}}>Top</Button>
              {items(24).map((row) => <Text>{row.label}</Text>)}
              <Button onPress={() => {}}>Bottom</Button>
            </>
          ),
        }}
      />
    ), { width: 44, height: 10 })

    try {
      // The region opens on the first stop, and the second one is off the bottom of the viewport.
      expect(lit(screen)).toContain('[Top]')
      expect(screen.text).not.toContain('[Bottom]')

      // Down skips the paragraph, lands on the second button, and reveals it.
      const second = await screen.press('ARROW_DOWN')
      expect(lit(second)).toContain('[Bottom]')
      expect(second.text).toContain('[Bottom]')

      // The end of the document is a wall.
      const walled = await second.press('ARROW_DOWN')
      expect(lit(walled)).toContain('[Bottom]')

      // And the page group scrolls under the caret: Home takes the document back to its top while the
      // keys stay on the button that is now off screen. Bound focus-within on the viewport, which is
      // the half of the rule the arrows cannot show.
      const home = await walled.press('HOME')
      expect(home.text).toContain('[Top]')
      expect(home.text).not.toContain('[Bottom]')
      expect(lit(home)).not.toContain('[Top]')
    } finally {
      screen.done()
    }
  }, 30_000)

  it('uses OpenTUI wheel scrolling for a non-virtual document viewport', async () => {
    const screen = await renderCells(() => (
      <HeaderBodyFooter
        stateKey="document"
        label="Document"
        regions={{
          body: () => <>{items(24).map((row) => <Text>{row.label}</Text>)}</>,
        }}
      />
    ), { width: 36, height: 9 })

    try {
      expect(screen.text).toContain('Row 1')
      let moved = screen
      for (let step = 0; step < 4; step += 1) moved = await moved.scroll(10, 4, 'down')
      expect(moved.text).not.toContain('Row 1\n')
      expect(moved.text).toMatch(/Row (?:[8-9]|1\d)/)
    } finally {
      screen.done()
    }
  }, 30_000)

  it('moves a virtual list window with the wheel without changing its active item', async () => {
    const rows = items(30)
    const screen = await renderCells(() => (
      <HeaderBodyFooter
        stateKey="virtual"
        label="Virtual"
        regions={{
          body: () => (
            <Rows virtual id="virtual-rows" items={rows}>
              {(row, item) => <Row item={item}>{row.label}</Row>}
            </Rows>
          ),
        }}
      />
    ), { width: 36, height: 10 })

    try {
      let wheeled = screen
      for (let step = 0; step < 5; step += 1) wheeled = await wheeled.scroll(10, 4, 'down')
      expect(wheeled.text).not.toContain('Row 1\n')
      expect(wheeled.lines.some((line) => line.includes('›'))).toBe(false)

      // Keyboard movement is still selection-driven. It brings the next active row back into the
      // window and restores renderer focus/caret to its newly mounted row.
      const keyboard = await wheeled.press('ARROW_DOWN')
      expect(keyboard.lines.find((line) => line.includes('›'))).toContain('Row 2')
    } finally {
      screen.done()
    }
  }, 30_000)
})
