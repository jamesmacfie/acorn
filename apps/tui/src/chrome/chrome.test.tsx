/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { toast } from '@acorn/client-core/features/notifications/toast.ts'
import { _resetNotices, pushNotice } from '@acorn/client-core/features/notifications/notifications.ts'
import { tasksKey, type Task } from '@acorn/protocol/api.ts'
import { createRoot, createSignal } from 'solid-js'
import type { Renderable } from '../tree/compat'
import type { OwnKeyEvent as KeyEvent } from '../ownKeys'
import { keymap } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { keyedRows } from '../kit/showing'
import { recordedRequests } from '../fixture'
import { renderFixture } from '../harness'

// The chrome, drawn against the fixture node: rail, topbar, pane strip, footer, palette, overlays.
//
// Whole-screen assertions rather than cell-level ones, for the reason the smoke test gives: what a
// reader would look for on the screen. The one thing asserted cell by cell is where the caret is,
// because on this host the caret is not decoration — it is where the keys are, and a screen with no
// caret is a screen nobody can drive (docs/testing.md § Test layers).

const caretRow = (frame: string): number => frame.split('\n').findIndex((line) => line.includes('›'))

describe('the shell', () => {
  it('draws the topbar, the rail, the pane strip and the footer at 80 by 24', async () => {
    const screen = await renderFixture({ pane: 'notes' })
    const frame = await screen.until('Scratchpad')
    screen.done()

    const lines = frame.split('\n')
    // The topbar: the workspace, how many tasks are in it, and the branch of the one that is open.
    expect(lines[0]).toContain('acorn')
    expect(lines[0]).toContain('1 task')
    expect(lines[0]).toContain('fix-login')
    // The pane strip, with the pane it is showing marked.
    expect(frame).toContain('[Notes]')
    // The pane itself, which is the notes pane and knows nothing about any of this.
    expect(frame).toContain('Scratchpad')
    // The footer, drawn from the keymap's active layers.
    expect(lines[lines.length - 2]).toContain('j/k move')
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(80)
  }, 30_000)

  it('holds together at 120 by 40, where the rail keeps its names', async () => {
    const screen = await renderFixture({ width: 120, height: 40, pane: 'notes' })
    const frame = await screen.frame()
    screen.done()

    // Wide enough for the rail to be a rail rather than a strip of marks.
    expect(frame).toContain('fix-login')
    expect(frame).toContain('[Notes]')
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(120)
  }, 30_000)

  it('opens on the first Menu source, with the keys on that row', async () => {
    const screen = await renderFixture({ width: 120, height: 40 })
    const frame = await screen.until('Reviews')
    screen.done()

    // There is no click to put the keys anywhere. Startup waits for provider/workspace gates, picks
    // the first source the Menu actually draws, and lands the caret on the same row.
    const row = frame.split('\n')[caretRow(frame)] ?? ''
    expect(row).toContain('GitHub')
    expect(frame).toContain('Reviews')
  }, 30_000)

  it('cycles rail, pane strip and pane on tab, and wraps', async () => {
    const screen = await renderFixture({ width: 120, height: 40, pane: 'notes' })
    const rail = await screen.frame()
    const strip = await screen.press('TAB').then(() => screen.frame())
    const pane = await screen.press('TAB').then(() => screen.frame())
    screen.done()

    expect(rail.split('\n')[caretRow(rail)]).toContain('fix-login')
    expect(strip.split('\n')[caretRow(strip)]).toContain('[Notes]')
    expect(pane.split('\n')[caretRow(pane)]).toContain('Scratchpad')
  }, 30_000)

  it('hides the left column on the chord and brings it back', async () => {
    const screen = await renderFixture({ width: 100, height: 28 })
    expect(await screen.frame()).toContain('Browse')

    // One way to lose the column, and it is a chord: the two-cell strip of marks that used to replace
    // it below 100 cells went with the icons, because the strip only said anything when every row had
    // a glyph and most of those glyphs drew nothing (../kit/glyphs.ts).
    await screen.press('b', { ctrl: true })
    const hidden = await screen.frame()
    expect(hidden).not.toContain('Browse')
    expect(hidden).not.toContain('Tasks')

    await screen.press('b', { ctrl: true })
    const back = await screen.frame()
    screen.done()
    expect(back).toContain('Browse')
  }, 30_000)

  it('names the workspace and the project in the topbar, and p picks a project', async () => {
    const screen = await renderFixture({ width: 100, height: 28 })
    // `Workspace > Project`. The project is not visible anywhere else on this host — the desktop
    // carries it in the address bar — so a reader with an empty browse list can tell a missing
    // integration from the wrong project (./Topbar.tsx).
    expect((await screen.frame()).split('\n')[0]).toContain('>')

    await screen.press('p')
    const open = await screen.frame()
    screen.done()
    expect(open).toContain('Project')
  }, 30_000)

  it('opens the palette on the chord, filters, and gives the keys back on escape', async () => {
    const screen = await renderFixture({ width: 100, height: 28 })
    const before = caretRow(await screen.frame())

    await screen.press('k', { ctrl: true })
    const open = await screen.frame()
    expect(open).toContain('Commands')
    expect(open).toContain('Switch workspace')

    // The field owns the typing, and the list narrows to what matches.
    await screen.press('q')
    const filtered = await screen.frame()
    expect(filtered).toContain('Quit')
    expect(filtered).not.toContain('Switch workspace')

    await screen.press('ESCAPE')
    const closed = await screen.frame()
    screen.done()

    expect(closed).not.toContain('Switch workspace')
    expect(closed).toContain('Reviews')
    // Back where they were, which is what the DOM palette's `prevFocus` does with an element.
    expect(caretRow(closed)).toBe(before)
  }, 30_000)

  it('walks into a command group on return and back out of it on escape', async () => {
    const screen = await renderFixture({ width: 100, height: 28 })
    await screen.press('k', { ctrl: true })
    for (const letter of 'groups') await screen.press(letter)
    expect(await screen.frame()).toContain('Command groups')

    await screen.press('RETURN')
    const inside = await screen.frame()
    expect(inside).toContain('Stay open and say so')
    expect(inside).toContain('Close the palette')

    // Escape pops to exactly where it was — the query that was typed is still there — and only the
    // second one closes, which is the same sequence the desktop runs
    // (client-core/host/palette/paletteView.test.tsx).
    await screen.press('ESCAPE')
    const back = await screen.frame()
    expect(back).toContain('Command groups')
    expect(back).not.toContain('Close the palette')

    await screen.press('ESCAPE')
    const closed = await screen.frame()
    expect(closed).not.toContain('Command groups')
    expect(closed).toContain('Reviews')

    // A typed root reaches a descendant by its breadcrumb, so nesting hides nothing
    // (client-core/host/registries/commands/graph.ts).
    await screen.press('k', { ctrl: true })
    for (const letter of 'stay') await screen.press(letter)
    const found = await screen.frame()
    screen.done()
    expect(found).toContain('Stay open and say so')
  }, 30_000)

  it('draws a search and an input in the same rectangle as the list', async () => {
    // The interactive kinds, over the same session the desktop's palette runs on; the transitions
    // themselves are client-core/host/registries/commands/session.test.tsx. What is asked here is only
    // what a terminal can answer: the frame's own placeholder is in the field, the rows are the
    // provider's, and Enter reaches the outcome.
    const screen = await renderFixture({ width: 100, height: 28 })
    await screen.press('k', { ctrl: true })
    for (const letter of 'groups') await screen.press(letter)
    await screen.press('RETURN')

    // The group's four children, in the order they declared: stay, close, search, input.
    await screen.press('ARROW_DOWN')
    await screen.press('ARROW_DOWN')
    await screen.press('RETURN')
    const searching = await screen.until('amber')
    expect(searching).toContain('narrow the colours')
    expect(searching).toContain('magenta')

    for (const letter of 'mag') await screen.press(letter)
    const narrowed = await screen.frame()
    expect(narrowed).toContain('magenta')
    expect(narrowed).not.toContain('amber')

    await screen.press('RETURN')
    expect(await screen.until('You picked magenta')).toContain('You picked magenta')

    // Escape pops back to the group with the cursor where it was, and the input is the row below.
    await screen.press('ESCAPE')
    await screen.press('ARROW_DOWN')
    await screen.press('RETURN')
    expect(await screen.until('Press Enter to submit')).toContain('Type a line')

    for (const letter of 'hello') await screen.press(letter)
    await screen.press('RETURN')
    const answered = await screen.until('You said')
    screen.done()
    expect(answered).toContain('hello')
  }, 30_000)

  it('draws the cheat sheet on ? with the keys that are live', async () => {
    const screen = await renderFixture({ width: 100, height: 28 })
    await screen.press('?')
    const frame = await screen.frame()
    screen.done()

    expect(frame).toContain('Keys')
    expect(frame).toContain('j/k')
    expect(frame).toContain('ctrl+k')
    // Read from the active layers, not from a written list: `tab` is this host's own key for a shared
    // intent and it is here because the region layer bound it (../keys/install.ts).
    expect(frame).toContain('tab')
  }, 30_000)

  it('draws a notification above the footer, and never takes the keys for it', async () => {
    const screen = await renderFixture({ width: 100, height: 28 })
    const opening = await screen.frame()
    const before = opening.split('\n')[caretRow(opening)]
    toast('Saved.')
    const frame = await screen.frame()

    const lines = frame.split('\n')
    const at = lines.findIndex((line) => line.includes('Saved.'))
    expect(at).toBeGreaterThan(0)
    // Above the footer, which is the last drawn line.
    expect(lines[at + 1]).toContain('j/k move')
    // The keys are where they were. Compared by what the caret is on rather than its row number, so
    // a notification taking one line tests focus rather than panel arithmetic.
    expect(lines[caretRow(frame)]).toBe(before)

    await screen.press('ESCAPE')
    const cleared = await screen.frame()
    screen.done()
    expect(cleared).not.toContain('Saved.')
  }, 30_000)

  // The count and what is behind it (docs/tui.md § What is drawn bespoke). The number is the desktop
  // bell's, written here through the platform seam's `setBadge`, and `n` opens the same two sections
  // the bell's popover holds.
  it('counts what is waiting in the topbar, and opens the inbox on n', async () => {
    _resetNotices()
    pushNotice({ taskId: 'task-1', kind: 'agent-needs-input', title: 'claude needs you', at: Date.now() })
    pushNotice({ taskId: 'task-1', kind: 'agent-completed', title: 'claude finished', at: Date.now() })
    const screen = await renderFixture({ width: 100, height: 28 })
    const counted = await screen.until('\u25d4 2')
    expect(counted.split('\n')[0]).toContain('\u25d4 2')

    await screen.press('n')
    const inbox = await screen.until('claude needs you')
    screen.done()
    _resetNotices()

    expect(inbox).toContain('Notifications')
    expect(inbox).toContain('claude finished')
  }, 30_000)

  it('draws no count when nothing is waiting', async () => {
    _resetNotices()
    const screen = await renderFixture({ width: 100, height: 28 })
    const frame = await screen.frame()
    screen.done()
    expect(frame.split('\n')[0]).not.toContain('\u25d4')
  }, 30_000)

  // Drawing in front of the node (docs/tui.md § Attach or start,
  // docs/performance.md § Every host draws first). `acorn` creates its renderer before
  // a node it spawned has printed its boot line, so the whole shell has to be drawable from the
  // persisted cache with nothing on the wire.
  it('draws the whole shell from the persisted cache while the node it started is booting', async () => {
    const cached: Task[] = [{
      id: 'task-cached', title: 'from-last-time', projectId: 'project-1', branch: 'from-last-time',
      origin: 'local', icon: null, status: 'active', links: [], parentId: null, sort: 0,
      github: null, worktreePath: null, pullNumber: null,
    }]
    const screen = await renderFixture({
      width: 100,
      height: 28,
      starting: true,
      // Seeded into the same per-node client the shell renders under, which is the whole of this
      // phase: `App` used to mint one of its own, so a restored snapshot was invisible to it and every
      // start was cold (client-core/infra/node/fleet.ts § clientFor).
      cache: (client) => client.setQueryData(tasksKey, cached),
    })
    const frame = await screen.frame()
    screen.done()

    const lines = frame.split('\n')
    // The rail's task, drawn from the cache. Not the fixture's `fix-login`: nothing asked the node
    // for tasks at all, because a seeded query with a fresh timestamp is inside `clientFor`'s
    // thirty-second staleTime.
    expect(frame).toContain('from-last-time')
    expect(frame).not.toContain('fix-login')
    expect(recordedRequests().some((request) => request.path === '/v2/core/tasks')).toBe(false)
    // …and the chrome around it is whole: topbar, rail, pane strip and the keys on the footer.
    expect(lines[0]).toContain('acorn')
    expect(lines[lines.length - 2]).toContain('j/k move')
    // The one thing that says the node is not there yet, and it is not drawn as a fault: a node
    // this run spawned reads as `offline` to the broker, which would otherwise say "unreachable —
    // retrying" about a node that is booting fine (./nodeState.ts).
    expect(frame).toContain('starting the node')
    expect(frame).not.toContain('unreachable')
  }, 30_000)

  it('drops the starting sentence once the handshake lands, and fills the rail from the node', async () => {
    const screen = await renderFixture({ width: 100, height: 28 })
    const frame = await screen.until('fix-login')
    screen.done()

    expect(frame).not.toContain('starting the node')
    expect(frame).toContain('fix-login')
  }, 30_000)

  it('asks before quitting a node it started, and does not when it only attached', async () => {
    const attached = await renderFixture({ width: 100, height: 28 })
    await attached.press('q')
    const straight = await attached.frame()
    expect(straight).not.toContain('Quit and stop the node')
    expect(attached.quits()).toBe(1)
    attached.done()

    const started = await renderFixture({ width: 100, height: 28, supervised: true })
    await started.press('q')
    const asked = await started.frame()
    expect(asked).toContain('Quit and stop the node')
    expect(started.quits()).toBe(0)

    // Enter on the first row quits. The overlay is still drawn afterwards and that is right: the real
    // `onQuit` takes the terminal back and ends the process, so there is no frame after it to close
    // anything in. A list inside a `Modal` answering Enter at all is what the swallow layer used to
    // break, and a scope cannot: it names no keys (../keys/trap.ts).
    await started.press('RETURN')
    started.done()
    expect(started.quits()).toBe(1)
  }, 30_000)
})

// ── What the footer costs ─────────────────────────────────────────────────────────────────────
//
// The footer is drawn on every frame the shell draws, and its list comes from a walk of every active
// keymap layer. Asking per render was the cost; asking per change is the fix, and "per change" has to
// mean the four things that actually move the answer
// (./bindings.ts § When the answer moves).

describe('the footer asks the keymap once per change', () => {
  it('draws many frames without re-collecting, and re-collects when the keys move', async () => {
    const screen = await renderFixture({ width: 100, height: 28 })
    try {
      await screen.until('Reviews')
      const engine = keymap<Renderable, KeyEvent>()!
      let asks = 0
      const real = engine.getActiveKeys
      engine.getActiveKeys = ((options?: Parameters<typeof real>[0]) => {
        asks += 1
        return real.call(engine, options)
      }) as typeof real
      try {
        // Frames that have nothing to do with the keyboard. A toast draws a line above the footer and
        // a resize redraws the whole screen, and neither adds or removes a key.
        toast('Saved.')
        await screen.frame()
        await screen.frame()
        screen.resize(110, 30)
        await screen.frame()
        const idle = asks
        expect(idle, 'the footer re-collected on a frame that moved no keys').toBeLessThanOrEqual(1)

        // And a key that moves the keys is a change, so the answer is asked for again. A handful
        // rather than one, because Tab into another region mounts the controls in it and each of them
        // registering a layer is a real change to what the footer can offer — but a handful bounded
        // by the move rather than one per frame for the rest of the run, which is what it was.
        await screen.press('TAB')
        await screen.frame()
        expect(asks - idle).toBeGreaterThan(0)
        expect(asks - idle).toBeLessThanOrEqual(8)
      } finally {
        engine.getActiveKeys = real
      }
    } finally {
      screen.done()
    }
  }, 30_000)
})

// ── Rows a change does not rebuild ────────────────────────────────────────────────────────────
//
// `<For>` keys by object identity, so a rail that maps its tasks into fresh wrappers on every change
// destroys and rebuilds every row renderable — including the rows that did not change
// (../kit/showing.tsx § keyedRows).

describe('the rail keeps the rows a change did not touch', () => {
  it('hands the same wrapper back for an unchanged task, and the same array when nothing moved', () => {
    createRoot((dispose) => {
      const alpha = { id: 'a', title: 'Alpha' }
      const bravo = { id: 'b', title: 'Bravo' }
      const charlie = { id: 'c', title: 'Charlie' }
      const [tasks, setTasks] = createSignal([alpha, bravo, charlie])
      const rows = keyedRows(tasks, (task) => ({ key: task.id, task }))

      const first = rows()
      expect(first.map((row) => row.key)).toEqual(['a', 'b', 'c'])
      // Read again with nothing moved: the same array, so `<For>` has nothing to diff.
      expect(rows()).toBe(first)

      // A reorder, which is what a `tasks:changed` that moved a task up the list is. Every row is the
      // object it was, so every row renderable survives.
      setTasks([charlie, alpha, bravo])
      const reordered = rows()
      expect(reordered.map((row) => row.key)).toEqual(['c', 'a', 'b'])
      expect(reordered[0]).toBe(first[2])
      expect(reordered[1]).toBe(first[0])
      expect(reordered[2]).toBe(first[1])

      // And a task whose data changed is a new wrapper, because the row has to redraw. The rows
      // beside it are untouched, which is the half that matters.
      setTasks([charlie, { id: 'a', title: 'Alpha renamed' }, bravo])
      const changed = rows()
      expect(changed[0]).toBe(first[2])
      expect(changed[1]).not.toBe(first[0])
      expect(changed[2]).toBe(first[1])
      dispose()
    })
  })
})
