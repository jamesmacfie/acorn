import { expect } from 'vitest'
import { focusedRenderable } from './keys/regions'
import type { Screen } from './harness'

// How a reader gets to a managed session and moves around inside it, as three walks.
//
// Shared rather than written per file: ./agents.test.tsx, ./agentsFollow.test.tsx and
// ./agentsWeb.test.tsx all make the same trip, and the first two had two copies of it that drifted.
// Every one of these is keys a person presses, in the order they press them — no test-only route into
// the pane — which is what makes a case that uses them evidence about the terminal rather than about
// the store behind it.

/** Open the first session the way a reader does: Tab to the list, then Enter on the row. The bound is
 *  the whole region cycle and then some — three panels stand left of the pane strip — and the row is
 *  named by its own title rather than its subtitle (./panes.test.tsx § agents). */
export async function openFirstSession(screen: Screen): Promise<void> {
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
export async function enterDetail(screen: Screen): Promise<void> {
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
export async function stopSaying(screen: Screen, text: string): Promise<void> {
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
