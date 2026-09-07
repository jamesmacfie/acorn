/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { renderFixture } from './harness'

// The pane sweep: every first-party pane the roster registers, opened at exactly 80 by 24 with the
// chrome present (docs/tui.md).
//
// One case per pane, and each asks the three questions the sweep exists to ask rather than pinning
// every cell: can a reader find the thing this pane is for on the first screen, is nothing wider than
// the 80 cells the kit promises, and did the pane draw itself rather than an error. A whole-buffer
// snapshot would fail on every wording change and say nothing about whether the screen reads.
//
// The fixture node answers one route per pane (./fixture.ts), so a pane that starts asking for
// something new shows up here as a missing line rather than as a silent pass.

/** No line wider than the terminal, on any pane. A wider one is a node that read a width it does not
 *  have (docs/ui-design.md § What the kit and layouts must never do). */
const fitsIn = (frame: string, width: number): void => {
  for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(width)
}

/** The pane drew itself. Every pane's error boundary draws an `Alert` titled with the pane's id, so a
 *  pane that threw says `! <id>` and this is how the sweep notices (chrome/PaneRow.tsx). */
const drewCleanly = (frame: string, paneId: string): void => {
  expect(frame).not.toContain(`! ${paneId}`)
}

/**
 * Open a pane and take its screen once it has drawn.
 *
 * `until` is the first thing the case is going to look for, and the frame is taken again until it is
 * on screen. A pane's own data is a route and a store rather than a prop, and the first render in a
 * fresh worker also pays for compiling everything the pane pulls in — so the settle the harness does
 * comes back before the pane has filled, and every one of these asserted on an empty screen once
 * (docs/tui.md).
 *
 * Bounded, and the frame comes back either way: a pane that never fills is itself a finding, and this
 * reports it as a missing line on a screen somebody can read rather than as a timeout.
 */
const screenFor = async (
  pane: string,
  options: { until: string; width?: number; height?: number },
): Promise<string> => {
  const screen = await renderFixture({ pane, ...(options.width ? { width: options.width } : {}), ...(options.height ? { height: options.height } : {}) })
  let frame = await screen.frame()
  for (let tries = 0; tries < 20 && !frame.includes(options.until); tries += 1) {
    // A real wait, not just another flush: what is outstanding is a route and, on a cold worker, the
    // compile of everything the pane imports. Turning the render loop does not make either finish.
    await new Promise((done) => setTimeout(done, 250))
    frame = await screen.frame()
  }
  screen.done()
  drewCleanly(frame, pane)
  fitsIn(frame, options.width ?? 80)
  return frame
}

describe('every pane at 80 by 24', () => {
  it('agents: the session list, with its state and model under the title', async () => {
    const frame = await screenFor('agents', { until: 'MANAGED SESSIONS' })
    expect(frame).toContain('MANAGED SESSIONS')
    expect(frame).toContain('Find why the old password still works')
    // `Row variant="stacked"` puts the subtitle on its own line here, as it does on the DOM. Drawing
    // both on one line ran the title into the model name with nothing between them.
    //
    // The state is off the end of it at this size and that is the pane behaving. The left column takes
    // about a third of the shell, so at 80 the pane is 54 cells and a stacked row splits what is left
    // with its own trailing actions — which leaves the subtitle 30. Written down rather than fixed,
    // the same way the PR pane's folded navigator is: the row still says which session and which
    // model, which is what the reader came for (../chrome/Rail.tsx § railCells).
    expect(frame).toContain('claude · claude-opus-5')
  }, 60_000)

  it('github: the pull request, its state and its files', async () => {
    const frame = await screenFor('pr', { until: '#42' })
    expect(frame).toContain('#42')
    expect(frame).toContain('Invalidate the old password on reset')
    expect(frame).toContain('(fix-login) → (main)')
    // The overview, and not the file list: at 80 by 24 the pane is 77 cells and the navigator's folds
    // run past the bottom, so `Files 2` is a count on the first screen and the names are a scroll away.
    // That is the pane behaving — the thing it is for is what this pull request is — and it is written
    // down rather than fixed, because closing the folds by default would cost the reader a press on
    // every host (docs/tui.md).
    expect(frame).toContain('Description')
  }, 60_000)

  it('changes: the tracked group, its counts, and the commit line at the foot', async () => {
    const frame = await screenFor('changes', { until: 'Tracked' })
    // Groups by what a file is, not by which staging area it is in: staging is the checkbox on the
    // row now, and the fixture's three files are two tracked edits and one new file.
    expect(frame).toContain('Tracked')
    expect(frame).toContain('login.ts')
    // `+12` and not `+12 −3`: the row's counts are decoration, and at 80 the pane is 54 cells shared
    // between the badge, the name, the directory, the checkbox and the row's two verbs. The name and
    // the checkbox stay legible and the deletions fall off the end, which is what
    // docs/ui-design.md § Every node at 80 by 24 says a row's `meta` gives up first.
    expect(frame).toContain('+12')
    // The editor is always there, where the one-line field used to appear only once something was
    // staged, and the button says which commit it is about to make: the fixture has one file in the
    // index, so it is the index that gets committed.
    expect(frame).toContain('Commit message')
    expect(frame).toContain('[Commit]')
    expect(frame).toContain('Options')
  }, 60_000)

  it('notes: the three scopes and the notes in them', async () => {
    const frame = await screenFor('notes', { until: 'Repro steps' })
    expect(frame).toContain('TASK')
    expect(frame).toContain('Repro steps')
    expect(frame).toContain('Conventions')
  }, 60_000)

  it('context: the sections, what is in them, and the send at the foot', async () => {
    const frame = await screenFor('context', { until: 'Working tree' })
    expect(frame).toContain('2 sections')
    expect(frame).toContain('Working tree')
    expect(frame).toContain('Sync context')
  }, 60_000)

  it('editor: the file box, and the offer to hand the file to $EDITOR', async () => {
    const frame = await screenFor('editor', { until: '$EDITOR' })
    expect(frame).toContain('Editor')
    // The handoff, as a device preference rather than a suspend-and-resume: turning it on opens the
    // reader's own editor in a PTY on the node, and on this host that PTY draws in cells
    // (docs/editor.md § Editing in your own editor).
    expect(frame).toContain('$EDITOR')
  }, 60_000)

  // Wider than 80, because that is what a `reduced` node's loss is about: a pane that reads at 80 has
  // to keep reading when the window is bigger rather than leaving a column stranded. The PR pane is
  // the one with two columns of its own, so it is the one worth asking.
  it('holds together at 120 by 40, where the PR pane draws both its columns', async () => {
    const frame = await screenFor('pr', { until: 'Comments/Commits', width: 120, height: 40 })
    expect(frame).toContain('Invalidate the old password on reset')
    expect(frame).toContain('Diff')
  }, 60_000)

  // Driving one, rather than reading it: open a session and read what the agent said. At 120 the pane
  // draws both its columns, which is the size this asks about — the transcript, a tool card, the
  // approval and the composer are the four things the plugin table promises the terminal
  // (01-why.md). At 80 the same four are behind the layout's group switch, which the layout suite owns.
  it('agents: a session opens on a transcript, a tool card, an approval and a composer', async () => {
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    // Tab to the session list, wherever the cycle starts, then open the row the caret is on.
    //
    // Two things this loop learned. The bound is the whole cycle and then some, because the shell puts
    // three regions down the left before the pane strip and a fixed four presses stopped short — the
    // `RETURN` then landed on the Menu and opened a browse source, which drew a blank pane and failed
    // naming the wrong thing (../chrome/Rail.tsx).
    //
    // And what it waits for is the row's own title. `Find why…` is the *subtitle* of the first row, on
    // the line below the caret's, so a loop looking for it never matched and fell through to whichever
    // region it ended on. It passed anyway, on the region the fall-through happened to leave it in.
    let found = false
    for (let step = 0; step < 10 && !found; step += 1) {
      const caret = (await screen.frame()).split('\n').find((line) => line.includes('\u203a')) ?? ''
      found = caret.includes('Write src/login.ts')
      if (!found) await screen.press('TAB')
    }
    expect(found).toBe(true)
    await screen.press('RETURN')
    const frame = await screen.frame()
    screen.done()

    drewCleanly(frame, 'agents')
    fitsIn(frame, 120)
    // The transcript, as the reader's own words and the agent's answer. Asserted to where the turn
    // wraps: the left column takes about a third of the shell, so the detail column is 52 cells here
    // and a message longer than that runs onto a second line — which is the transcript working, not
    // failing (../chrome/Rail.tsx § railCells).
    expect(frame).toContain('Why does the old password still work')
    expect(frame).toContain('The reset writes a new hash but signIn still')
    // A tool card, folded.
    expect(frame).toContain('Read src/login.ts')
    // The approval, with both answers on it.
    expect(frame).toContain('Write src/login.ts')
    expect(frame).toContain('[Allow] [Deny]')
    // And the composer at the foot.
    expect(frame).toContain('Ask the agent')
  }, 60_000)
})
