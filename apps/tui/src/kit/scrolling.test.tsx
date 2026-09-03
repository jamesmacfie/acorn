/** @jsxImportSource @opentui/solid */
import { createSignal, Show } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { canDraw } from '../ffi'
import { Button } from './asking'
import { Sections } from './grouping'
import { Row, Rows, Text } from './showing'
import { renderCells } from './render'
import { HeaderBodyFooter } from '../layouts/HeaderBodyFooter'
import { ListDetail } from '../layouts/ListDetail'

const items = (count: number) => Array.from({ length: count }, (_, index) => ({
  key: `row-${index + 1}`,
  label: `Row ${index + 1}`,
}))

/** Which line the caret is on. The caret is where the keys are, so a caret nobody can find is the
 *  whole of what this file is about. */
const caret = (screen: { lines: string[] }): string => screen.lines.find((line) => line.includes('›')) ?? ''

/** What has the keys, read off the frame: `litControl` draws a focused control `strong` in the accent
 *  slot, and accent is the one slot whose red channel sits below its green (../appearance.ts). */
const lit = (screen: { runs: () => { text: string; fg: { r: number; g: number; b: number }; attributes: number }[] }): string[] =>
  screen.runs().filter((run) => run.text.trim() && run.fg.r < run.fg.g && (run.attributes & 1) === 1).map((run) => run.text)

describe.skipIf(!canDraw)('scrolling detail viewports', () => {
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

  // ── A list longer than the region it is drawn in ─────────────────────────────────────────────
  //
  // The three cases below are one reported fault with two causes in it, and both are fixed: the List
  // region of every `list-detail` was a yoga clip rather than a viewport, and the page keys moved
  // modulo the list length (docs/tui.md § Scrolling viewports).

  it('follows the caret down a list longer than its list-detail region', async () => {
    // A non-virtual `Rows` of 30 in a region eight rows tall. This is the shape eight of the nine
    // plugin lists are, and until the List region became a viewport the caret simply walked off the
    // bottom of the panel: the clip round it hid the rows below the fold and owned no offset for the
    // reveal to move (./scrolling.tsx, docs/tui.md § Scrolling viewports).
    const screen = await renderCells(() => (
      <ListDetail
        stateKey="long-list"
        label="Long"
        regions={{
          list: () => (
            <Rows id="long-list-rows" items={items(30)}>
              {(row, item) => <Row item={item}>{row.label}</Row>}
            </Rows>
          ),
          detail: () => <Text>a detail</Text>,
        }}
      />
    ), { width: 40, height: 12 })

    try {
      expect(caret(screen)).toContain('Row 1')
      let moved = screen
      for (let step = 0; step < 20; step += 1) moved = await moved.press('j')
      // On screen, and on the row twenty presses from the first one. Both halves matter: a caret that
      // stopped early is a wall nobody asked for, and a caret on the right row that is not drawn is
      // the bug itself.
      expect(caret(moved)).toContain('Row 21')
      expect(moved.lines.some((line) => /Row 1\b/.test(line))).toBe(false)
    } finally {
      screen.done()
    }
  }, 30_000)

  it('lands a page key on the last row of a short list and hands the next one to the viewport', async () => {
    // `PAGE` is ten rows, and it used to move modulo the list length: PageDown in a three-row list
    // moved one row and in a ten-row list moved nowhere, which a reader cannot tell from a dead key.
    // It clamps now, and once the caret is on the last row the collection hands the key back, so the
    // document viewport around the list scrolls it. That is the sentence the footer promises: arrows
    // move, page keys scroll (client-core kit/keys/collectionIntents.ts).
    for (const count of [3, 10]) {
      const screen = await renderCells(() => (
        <HeaderBodyFooter
          stateKey={`paged-${count}`}
          label="Paged"
          regions={{
            body: () => (
              <>
                <Rows id={`paged-rows-${count}`} items={items(count)}>
                  {(row, item) => <Row item={item}>{row.label}</Row>}
                </Rows>
                {items(24).map((row) => <Text>Tail {row.label}</Text>)}
              </>
            ),
          }}
        />
      ), { width: 44, height: 10 })

      try {
        expect(caret(screen), `a list of ${count} rows`).toContain('Row 1')

        const paged = await screen.press('PAGEDOWN')
        expect(caret(paged), `a list of ${count} rows`).toContain(`Row ${count}`)

        // And the second one is not the list's. It bubbles from the collection to the viewport, which
        // scrolls the document under the caret, so the tail below the list comes into view while the
        // caret stays where it was. The clamp's own return value is asserted without a host in
        // client-core's kit/keys/collectionIntents.test.ts.
        const again = await paged.press('PAGEDOWN')
        expect(again.text, `a list of ${count} rows`).toContain('Tail Row')
      } finally {
        screen.done()
      }
    }
  }, 60_000)

  it('reveals the caret in a list that has only just mounted', async () => {
    // The reveal reads a child's laid-out `y`, and a row built in this tick still carries last
    // tick's geometry or none at all. So entering a region whose rows have only just arrived
    // scrolled by the wrong delta and nothing corrected it: with the reveal's second half taken out
    // this case leaves the caret on row 30 and the viewport showing rows 1 to 10, which is a lit
    // border, no caret and dead-looking arrows. The store asks again on the renderer's next frame,
    // which is the first moment the numbers are real (../keys/regions.ts § The second reveal).
    //
    // Built the way a reader meets it. They read to the end of a list, look at the detail beside it,
    // the list is replaced under them by a refresh, and they Tab back: the region remembers the row
    // by its logical identity, so the landing is row 30 and the viewport has to follow it there.
    // `ready` unmounts the rows and not the frame around them, because the region's memory lives on
    // the region and a region that unregisters takes it with it.
    const [ready, setReady] = createSignal(true)
    const screen = await renderCells(() => (
      <ListDetail
        stateKey="fresh-list"
        label="Fresh"
        regions={{
          list: () => (
            <Show when={ready()}>
              <Rows id="fresh-list-rows" items={items(30)}>
                {(row, item) => <Row item={item}>{row.label}</Row>}
              </Rows>
            </Show>
          ),
          detail: () => <Text>a detail</Text>,
        }}
      />
    ), { width: 100, height: 12 })

    try {
      const end = await screen.press('END')
      expect(caret(end)).toContain('Row 30')

      const detail = await end.press('TAB')
      expect(caret(detail)).toBe('')

      setReady(false)
      const gone = await detail.frame()
      expect(gone.lines.some((line) => /Row \d/.test(line))).toBe(false)

      // The rows and the key in one tick, with no frame in between, which is the whole point: at the
      // moment the landing asks where row 30 is, row 30 has never been laid out.
      setReady(true)
      const back = await detail.press('TAB')
      expect(caret(back)).toContain('Row 30')
    } finally {
      screen.done()
    }
  }, 60_000)
})
