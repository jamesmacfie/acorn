/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { recordedRequests } from './fixture'
import { focusedRenderable } from './keys/regions'
import { renderFixture, type Screen } from './harness'

// Driving the agent pane, rather than reading it.
//
// `panes.test.tsx` already asks whether the four things an agents transcript is for are on the first
// screen. This file asks the other question: can a reader at a terminal actually run an agent — open
// a run, answer what it is blocked on, say something back, and start another one. Each case ends at a
// recorded POST, because what a pane draws and what it sends are different claims and only the second
// one is the feature (./controls.test.tsx § posts a comment typed into the composer).
//
// 120 by 40 throughout. Below 80 cells `list-detail` draws one column at a time, so the composer and
// the approval are behind the layout's group switch and a case about them would be a case about the
// switch (../layouts/ListDetail.tsx).

const posts = () => recordedRequests().filter((request) => request.method === 'POST').map((request) => request.path)

/** Open the first session the way a reader does: Tab to the list, then Enter on the row. The bound is
 *  the whole region cycle and then some — three panels stand left of the pane strip — and the row is
 *  named by its own title rather than its subtitle (./panes.test.tsx § agents). */
async function openFirstSession(screen: Screen): Promise<void> {
  // The rows before the walk. The list is a query, and on a loaded machine ten Tab presses run out
  // before it answers — which reads as "no region held the row" rather than as "the row was late".
  await screen.until('Write src/login.ts')
  let found = false
  for (let step = 0; step < 10 && !found; step += 1) {
    const caret = (await screen.frame()).split('\n').find((line) => line.includes('›')) ?? ''
    found = caret.includes('Write src/login.ts')
    if (!found) await screen.press('TAB')
  }
  expect(found).toBe(true)
  await screen.press('RETURN')
}

/** Cross into the detail column, once it has finished drawing.
 *
 *  The wait is the point. Every region of this pane is a `lazy()`, and entering a region that has no
 *  stops in it yet lands the keys on the region's own frame, where the arrows do nothing — so on a
 *  loaded machine the walk below stood on the header and reported that nothing else existed. The
 *  composer is the last thing in the column, so its placeholder on screen is the column being
 *  finished. */
async function enterDetail(screen: Screen): Promise<void> {
  await screen.until('Ask the agent')
  await screen.press('l')
}

/** Put the keys on the stop in this region that says `text`.
 *
 *  Down only, and it stops when it meets a renderable it has already stood on. Not the harness's
 *  `reach`, which is Tab major and walks the whole screen: from the agents pane it wandered into the
 *  pull request pane and reported the caret on `[Close]`. Not a fixed run of presses either — a
 *  transcript is ten-odd stops and a collection wraps, so a budget that is too small stops in the
 *  middle and one that is too large goes round for ever.
 *
 *  The failure lists what it stood on, because "no stop said Ask the agent" on its own sends the next
 *  person round the same loop by hand. */
async function stopSaying(screen: Screen, text: string): Promise<void> {
  const trail: string[] = []
  const start = await screen.caret()
  if (start.text.includes(text)) return
  const region = start.region?.regionId
  // Both ways, because the keys land in the middle of the column: entering this region gives them to
  // the message box, the header is above it and the action bar below
  // (../keys/regions.ts § markEntry). Plain arrows both ways — inside the field they move the caret a
  // row and at its first and last line they leave it, which is what a reader presses too
  // (../keys/install.ts § typeInto).
  for (const key of ['ARROW_DOWN', 'ARROW_UP']) {
    // Each pass stops when it meets a renderable it has already stood on, which is how a wall and a
    // collection that wrapped around are told apart, and when it leaves the region.
    const seen = new Set<unknown>()
    for (let step = 0; step < 40; step += 1) {
      const here = await screen.caret()
      if (here.text.includes(text)) return
      if (here.region?.regionId !== region) break
      const node = focusedRenderable()
      // A field keeps the keys for as many presses as it has rows, because the arrow moves the caret
      // a line before it leaves (../keys/install.ts § typeInto). So standing on one twice is a walk
      // in progress rather than a wall, and only a repeat somewhere else ends the pass.
      if (node && seen.has(node) && node.kind !== 'textarea') break
      if (node) seen.add(node)
      trail.push(here.text.trim())
      await screen.press(key)
    }
  }
  throw new Error(`no stop said ${text}. The walk stood on: ${trail.map((one) => `[${one}]`).join(' ')}`)
}

describe('running an agent from a terminal', () => {
  it('opens a run and sends a turn to it', async () => {
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      await stopSaying(screen, 'Ask the agent')
      for (const key of ['h', 'i']) await screen.press(key)
      const typed = await screen.frame()
      expect(typed).toContain('hi')
      // The footer names the key that sends, at the field that takes it.
      expect(typed).toContain('ctrl+return send')
      expect(posts()).toEqual([])

      await screen.press('RETURN', { ctrl: true })
      expect(posts()).toEqual(['/v2/p/agents/sessions/session-1/turns'])
    } finally {
      screen.done()
    }
  }, 180_000)

  // Where the keys go when a reader opens a run. A chat surface is one you arrive at to write, so the
  // message box is what the column hands them to, and everything else is a step away from it
  // (../keys/regions.ts § markEntry).
  it('puts the keys in the message box when the run opens', async () => {
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      // By node kind, not by the placeholder: the draft is a module signal keyed by session and
      // outlives a render, so a case that runs after one which typed something finds that text in the
      // box. What is being claimed is that the keys are in the message box, and the kind says it.
      expect(focusedRenderable()?.kind).toBe('textarea')
      // And the header above it is still a walk away, because an arrow at the field's first line
      // leaves the field rather than being swallowed (../keys/install.ts § typeInto).
      await stopSaying(screen, 'New')
      expect((await screen.caret()).text).toContain('New')
    } finally {
      screen.done()
    }
  }, 180_000)

  // `onSubmit` on the shared props is documented as "Enter without a modifier. Absent leaves Enter as
  // a newline", and the DOM half reads exactly that. This host had it on the `commit` chord alone, so
  // the composer's own hint — "Shift+Enter for newline" — described a keyboard nobody had.
  it('sends on Enter and keeps Shift+Enter for a newline', async () => {
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      for (const key of ['h', 'i']) await screen.press(key)

      await screen.press('RETURN', { shift: true })
      expect(posts()).toEqual([])

      await screen.press('RETURN')
      expect(posts()).toEqual(['/v2/p/agents/sessions/session-1/turns'])
    } finally {
      screen.done()
    }
  }, 180_000)

  it('answers what the run is blocked on', async () => {
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      await stopSaying(screen, 'Allow')
      await screen.press('RETURN')
      expect(posts()).toEqual(['/v2/p/agents/sessions/session-1/requests/request-1/resolve'])
    } finally {
      screen.done()
    }
  }, 180_000)

  // The create-a-run control, and the reason this file exists. `New` is a `Picker`, which on this host
  // is a `Menu` with a filter field over provider rows — and inside the header's `Toolbar` its panel
  // used to be laid out in the few cells the trigger was given, so `Claude Code` and `Available`
  // collided into `ClaAv` and a reader could not tell what they were choosing
  // (../kit/grouping.tsx § ToolbarPanel).
  it('starts a new run from the header, and the provider row is readable', async () => {
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      await stopSaying(screen, 'New')
      await screen.press('RETURN')

      const open = await screen.frame()
      expect(open).toContain('Filter providers…')
      expect(open).toContain('Claude Code')

      await stopSaying(screen, 'Claude Code')
      await screen.press('RETURN')
      expect(posts()).toEqual(['/v2/p/agents/sessions'])
    } finally {
      screen.done()
    }
  }, 180_000)

  // The whole session-actions menu, which is the same clipping bug and the same fix: six rows that
  // read as words rather than as the first six cells of one.
  it('offers the session actions as whole words', async () => {
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      await stopSaying(screen, 'Session actions')
      await screen.press('RETURN')
      // `until`, not `frame`: the rows are built from the provider list, which is a resource the pane
      // is still fetching when the menu opens.
      const open = await screen.until('Fork session')
      for (const row of ['Fork session', 'Rename session', 'Export Markdown', 'Archive session']) {
        expect(open).toContain(row)
      }
    } finally {
      screen.done()
    }
  }, 180_000)
})
