import { beforeEach, describe, expect, it } from 'vitest'
import { createMemo, createRoot, getOwner, onCleanup, runWithOwner, type Owner } from 'solid-js'
import type { CliRenderer, Renderable } from '@opentui/core'
import {
  _resetRegions, activationEntersMain, focusRenderable, focusedInScope, focusedRenderable,
  installRegions, markCollection, markItem, markParent, moveBack, moveColumn, movePane, moveRegion,
  moveStop, onScreen, panelsChanged, parentOf, pushScope, regionsInScope, registerRegion,
  scheduleSettle, setTopology, stopsIn, walkSteps,
} from './regions'

// Fakes rather than a rendered shell, because what is under test is bookkeeping: which node holds the
// keys after a mount, an unmount, a dialog or a walk. The real thing is exercised end to end in
// ../browse.test.tsx and swept as a property in ../reachability.test.tsx.
//
// The fakes model what is left of the renderer, which is two things: the caret it draws when the
// store tells it to, and the root a mouse event bubbles up to. Focus itself is the store's, so a fake
// does not decide anything about it — what it has to get right is that a `focus` call moves the caret
// off whatever had it, because one caret is invariant 3 (./regions.ts § The one owner).

/** The mutable side of a fake, since `Renderable` declares `focused` read-only. */
type Fake = {
  parent: Renderable | null
  visible: boolean
  focusable: boolean
  focused: boolean
  isDestroyed: boolean
  getChildren: () => Renderable[]
  focus: () => void
  blur: () => void
}

const asFake = (box: Renderable): Fake => box as unknown as Fake

/** The renderer, as far as focus is concerned: the caret it is told to draw, and the root a click
 *  bubbles up to. `CliRenderer.focusRenderable` records the new node and blurs the one it displaces,
 *  which is why one call is one caret; `blurRenderable` clears it.
 *
 *  `currentFocusedRenderable` is a getter that counts, because the store must never ask it anything:
 *  asking the renderer where the keys are is what a second owner does, and the count is how a case
 *  says so. `held` is the same value without counting, for the fakes' own bookkeeping. */
const fakeRenderer = () => {
  let held: Renderable | null = null
  let reads = 0
  let blurs = 0
  return {
    // A slot rather than a renderable, because `installRegions` writes one handler to it and the
    // store reads nothing else off the root (./regions.ts § installRegions).
    root: { onMouseDown: undefined as ((event: FakeClick) => void) | undefined },
    // The `frame` event the reveal waits for. Taken and never fired: a reveal is about geometry and
    // there is none here, so `../kit/scrolling.test.tsx` owns that case (./regions.ts § The reveal).
    on: (): void => {},
    off: (): void => {},
    get currentFocusedRenderable(): Renderable | null { reads += 1; return held },
    held: () => held,
    draw: (node: Renderable | null): void => { held = node },
    /** How many times anything has asked the renderer what has the keys. */
    reads: () => reads,
    /** How many times the store has told the renderer to let a caret go. */
    blurs: () => blurs,
    blurred: (): void => { blurs += 1 },
  }
}

/** A left mouse-down as the store sees it: the renderable the renderer resolved, and the button.
 *  `dispatchMouseEvent` bubbles the real thing up to the root carrying exactly this much
 *  (@opentui/core § CliRenderer.dispatchMouseEvent). */
type FakeClick = { type: 'down'; button: number; target: Renderable | null }

let renderer = fakeRenderer()

const node = (children: Renderable[] = []): Renderable => {
  const box: Fake = {
    parent: null,
    visible: true,
    focusable: false,
    focused: false,
    isDestroyed: false,
    getChildren: () => children,
    // `Renderable.focus` refuses a destroyed, already focused or unfocusable node and does not look
    // at `visible` at all, and `blur` refuses a node that is not focusable. Both are the caret mirror
    // now and neither decides anything (./regions.ts § paintCaret).
    focus: () => {
      if (box.isDestroyed || box.focused || !box.focusable) return
      const previous = renderer.held()
      box.focused = true
      renderer.draw(box as unknown as Renderable)
      if (previous) asFake(previous).focused = false
    },
    blur: () => {
      renderer.blurred()
      if (!box.focused || !box.focusable) return
      box.focused = false
      renderer.draw(null)
    },
  }
  for (const child of children) asFake(child).parent = box as unknown as Renderable
  return box as unknown as Renderable
}

/** A stop: what `pressable` makes of a renderable, minus the key layer. */
const control = (): Renderable => {
  const box = node()
  box.focusable = true
  return box
}

/** A row of a collection, which is focusable because `Row`'s own ref makes it one
 *  (../kit/showing.tsx § Row). `markItem` marks a row; it does not make one focusable. */
const item = (): Renderable => control()

/** What `Renderable.destroy` does that focus can see: the flag, and the blur it ends with, so the
 *  keys are nowhere rather than on a corpse and the pass has the region's claim to go on. */
const destroy = (box: Renderable): void => {
  asFake(box).isDestroyed = true
  box.blur()
}

// `markItem` and `markParent` register cleanups, which is what a kit node drawing inside a component
// gets for free. A root gives the fakes the same owner.
let owner: Owner | null = null
let dispose = () => {}
/** Register something the way a component would. */
const drawn = <T>(build: () => T): T => runWithOwner(owner, build) as T

/** Open an overlay over whatever has the keys, and hand back the thing that closes it. Its own root,
 *  because closing an overlay is disposing the reactive scope that drew it — and the focus scope
 *  goes with it, exactly as a `Modal`'s does (../kit/grouping.tsx). */
const opened = (box: Renderable): (() => void) => {
  let close = () => {}
  runWithOwner(owner, () => createRoot((stop) => { close = stop; onCleanup(pushScope(box)) }))
  return close
}

/**
 * Draw a row into a box and hand back what unmounts it.
 *
 * Unmounting is two things a turn apart, and the fake keeps them apart on purpose: Solid disposes the
 * reactive scope now, and the reconciler destroys the renderable on `process.nextTick`. So the
 * cleanups run while the row still reports itself live, which is the state the pass has to survive
 * without depending on (../kit/reconciler.ts, ./regions.ts § scheduleSettle).
 */
const row = (parent: Renderable, children: Renderable[], identity?: string): (() => void) => {
  const box = item()
  asFake(box).parent = parent
  children.push(box)
  let disposeRow = () => {}
  runWithOwner(owner, () => createRoot((stop) => {
    disposeRow = stop
    markItem(box, undefined, identity)
  }))
  return () => {
    disposeRow()
    const at = children.indexOf(box)
    if (at >= 0) children.splice(at, 1)
    destroy(box)
  }
}

/** Run the pass. More than one turn, because `enter` looks again after a move that landed on a
 *  region's frame, which is how a list that arrives late gets the keys (./regions.ts § enter). */
const settle = async (): Promise<void> => {
  scheduleSettle()
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
}

const fresh = (): void => {
  dispose()
  _resetRegions()
  renderer = fakeRenderer()
  installRegions(renderer as unknown as CliRenderer)
  createRoot((stop) => { dispose = stop; owner = getOwner() })
}

describe('focus regions', () => {
  beforeEach(fresh)

  // ── The landing rule, as properties ─────────────────────────────────────────────────────────
  //
  // One question and four steps, so the thing worth asserting is not a path through them but the
  // sentence they are there to keep true. The pass they replaced had seven ordered steps and the bug
  // it produced was always two of them running in an order nobody had pictured, which is exactly the
  // kind of bug a scenario per path cannot find (./regions.ts § The landing rule,
  // docs/tui.md § Focus regions).

  /** Invariants 6, 9 and 10 about whatever holds the keys, asked after a pass. */
  const holdsTheKeys = (where: string): Renderable => {
    const node = focusedRenderable()
    expect(node, `${where}: the keys are nowhere`).not.toBe(null)
    expect(renderer.currentFocusedRenderable, `${where}: the renderer and the store disagree`).toBe(node)
    expect(onScreen(node), `${where}: the keys are on a node that is gone`).toBe(true)
    expect(node!.focusable, `${where}: the keys are on a node that cannot be blurred`).toBe(true)
    expect(focusedInScope(), `${where}: the keys are outside the open scope`).toBe(true)
    return node as Renderable
  }

  it('keeps the keys somewhere they can answer, through any order of mounts, dialogs and walks', async () => {
    // Every sequence of four of the five things that move the keys or the tree under them. The
    // ordering is the point: each of these was a settle step of its own, and the steps' side effects
    // were each other's inputs.
    const world = () => {
      const rowsA: Renderable[] = []
      const rowsB: Renderable[] = []
      const regionA = node(rowsA)
      const regionB = node(rowsB)
      registerRegion(regionA, { paneId: 'chrome', regionId: 'menu' }, 0, { x: 0 })
      registerRegion(regionB, { paneId: 'pr', regionId: 'list' }, 1)
      const mounted: (() => void)[] = []
      let close: (() => void) | null = null
      return {
        mount: () => { mounted.push(row(regionA, rowsA, `a${mounted.length}`)) },
        unmount: () => { mounted.pop()?.() },
        open: () => { if (!close) close = opened(node([control()])) },
        close: () => { close?.(); close = null },
        tab: () => { moveRegion(1) },
      }
    }
    const names = ['mount', 'unmount', 'open', 'close', 'tab'] as const
    const sequences: (typeof names[number])[][] = [[]]
    for (let length = 0; length < 4; length += 1) {
      const grown: (typeof names[number])[][] = []
      for (const so_far of sequences.filter((entry) => entry.length === length)) {
        for (const name of names) grown.push([...so_far, name])
      }
      sequences.push(...grown)
    }

    for (const sequence of sequences) {
      fresh()
      const steps = world()
      await settle()
      holdsTheKeys('on opening')
      for (let at = 0; at < sequence.length; at += 1) {
        steps[sequence[at]]()
        await settle()
        holdsTheKeys(`after ${sequence.slice(0, at + 1).join(', ')}`)
      }
    }
  }, 60_000)

  it('never remembers a landing on a region frame, so a late list still gets the keys', async () => {
    const rows: Renderable[] = []
    const browse = node(rows)
    const menu = node()
    registerRegion(menu, { paneId: 'chrome', regionId: 'menu' }, 0)
    registerRegion(browse, { paneId: 'chrome', regionId: 'browse' }, 1)

    // Into Browse while it is still empty: the frame itself is the only stop there is, and it is
    // focusable from registration for exactly that.
    moveRegion(1)
    expect(focusedRenderable()).toBe(browse)

    // Out, the list arrives, back in. Before this was fixed the frame stayed remembered for the rest
    // of the run, so the border lit and `j` did nothing.
    moveRegion(1)
    const gone = row(browse, rows)
    moveRegion(1)
    expect(focusedRenderable()).toBe(rows[0])
    gone()
  })

  it('takes the keys off a placeholder as soon as the real stop exists', async () => {
    const rows: Renderable[] = []
    const browse = node(rows)
    registerRegion(browse, { paneId: 'chrome', regionId: 'browse' }, 0)
    await settle()
    // A region's contents are `lazy()` and its rows come from a query, so the frame is what the pass
    // has to settle for on the turn a pane opens.
    expect(focusedRenderable()).toBe(browse)

    row(browse, rows)
    await settle()
    expect(focusedRenderable()).toBe(rows[0])

    // And the other placeholder, which is a collection drawn with no live active row: a virtual list
    // whose caret is off its window, or one whose query has not answered
    // (../kit/showing.tsx § Rows, ./regions.ts § stopsIn).
    let active: Renderable | undefined
    const listRows: Renderable[] = []
    const list = node(listRows)
    const region = node([list])
    asFake(list).parent = region
    list.focusable = true
    drawn(() => markCollection(list, () => active))
    registerRegion(region, { paneId: 'pr', regionId: 'list' }, 1)
    expect(moveRegion(1)).toBe(true)
    expect(focusedRenderable()).toBe(list)

    const arrived = item()
    asFake(arrived).parent = list
    listRows.push(arrived)
    drawn(() => markItem(arrived))
    active = arrived
    await settle()
    expect(focusedRenderable()).toBe(arrived)
  })

  it('re-enters by identity when a query replaces the row that had the keys', async () => {
    const rows: Renderable[] = []
    const browse = node(rows)
    const menu = node()
    registerRegion(browse, { paneId: 'chrome', regionId: 'browse' }, 0)
    registerRegion(menu, { paneId: 'chrome', regionId: 'menu' }, 1)

    const first = row(browse, rows, 'browse one')
    await settle()
    const original = rows[0]
    expect(focusedRenderable()).toBe(original)

    // A refetch draws the same logical row as a new renderable and destroys the old one, which takes
    // the renderer's focus with it. On a host with no pointer nothing else would put it back.
    row(browse, rows, 'browse one')
    first()
    await settle()
    const replacement = rows[0]
    expect(replacement).not.toBe(original)
    expect(focusedRenderable()).toBe(replacement)

    // And the region remembers the logical row, not the renderable it was drawn as.
    expect(moveRegion(1)).toBe(true)
    expect(moveRegion(1)).toBe(true)
    expect(focusedRenderable()).toBe(replacement)
  })

  it('opens the screen where the topology says, once however many times it is asked', async () => {
    let asked = 0
    const menu = node()
    const tasks = node()
    registerRegion(menu, { paneId: 'chrome', regionId: 'menu' }, -130, { x: 0 })
    registerRegion(tasks, { paneId: 'chrome', regionId: 'tasks' }, -110, { x: 0 })
    setTopology({
      home: () => null,
      skips: () => false,
      opensOn: () => { asked += 1; return { paneId: 'chrome', regionId: 'tasks' } },
    })

    // Three callers in one turn — a region registering, a list arriving, a row going — are one pass.
    scheduleSettle()
    scheduleSettle()
    await settle()
    expect(asked).toBe(1)
    // Tasks rather than Menu, which registered first and would have taken the keys on its own.
    expect(focusedRenderable()).toBe(tasks)
  })

  it('selects a row when entering an opted-in region, including after a late mount', async () => {
    const menu = node()
    const rows: Renderable[] = []
    const browse = node(rows)
    const main = node()
    let picked = 0
    registerRegion(menu, { paneId: 'chrome', regionId: 'menu' }, -130, { x: 0 })
    registerRegion(
      browse,
      { paneId: 'chrome', regionId: 'browse' },
      -120,
      { x: 0, pickOnEnter: true },
    )
    registerRegion(main, { paneId: 'chrome', regionId: 'source' }, 0)

    // Browse opens before its query has produced a row, so its frame holds the keys for want of
    // anything better.
    moveRegion(1)
    expect(focusedRenderable()).toBe(browse)

    const chosen = item()
    asFake(chosen).parent = browse
    rows.push(chosen)
    drawn(() => markItem(chosen, () => { picked += 1 }))
    await settle()
    expect(focusedRenderable()).toBe(chosen)
    expect(picked).toBe(1)

    // Leaving and coming home restores and selects the remembered row through the same handler.
    expect(moveColumn(1)).toBe(true)
    expect(focusedRenderable()).toBe(main)
    expect(moveColumn(-1)).toBe(true)
    expect(focusedRenderable()).toBe(chosen)
    expect(picked).toBe(2)
  })

  // ── The pointer ─────────────────────────────────────────────────────────────────────────────
  //
  // A click is a hit test into the store and nothing else. It used to be the renderer's: `autoFocus`
  // walks up from the renderable a left click hit and focuses the first focusable ancestor itself,
  // which is a focus move nothing asked for and the second opinion this store exists to be the only
  // one of. The flag is off everywhere a renderer is built (./regions.ts § Clicks are hit tests).

  /** A left click on a renderable, as the renderer delivers one: bubbled to the root, carrying what
   *  it hit. */
  const click = (target: Renderable | null, button = 0): void => {
    renderer.root.onMouseDown?.({ type: 'down', button, target })
  }

  it('focuses the nearest stop above a click, and never asks the renderer what has the keys', () => {
    const rows: Renderable[] = []
    const region = node(rows)
    registerRegion(region, { paneId: 'pr', regionId: 'list' }, 0)
    row(region, rows, 'r0')
    row(region, rows, 'r1')
    // A cell inside the second row: what a reader actually clicks is a line of text, and a line is
    // not a stop, so the walk up is the whole mechanism.
    const label = node()
    asFake(label).parent = rows[1]
    focusRenderable(rows[0])

    const asked = renderer.reads()
    click(label)
    expect(focusedRenderable()).toBe(rows[1])
    // And the store answered without asking the renderer anything, which is the half a grep cannot
    // see (../invariants.test.ts § the store is the only owner of focus).
    expect(renderer.reads()).toBe(asked)

    // A click on nothing that can hold the keys moves nothing, rather than walking up to something
    // the reader did not point at.
    const loose = node()
    click(loose)
    expect(focusedRenderable()).toBe(rows[1])

    // Nor does a middle or right button, which this host has no meaning for at all.
    click(rows[0], 2)
    expect(focusedRenderable()).toBe(rows[1])
  })

  it('does not let a click reach behind an open dialog', () => {
    const rows: Renderable[] = []
    const region = node(rows)
    registerRegion(region, { paneId: 'pr', regionId: 'list' }, 0)
    row(region, rows, 'r0')
    const inside = control()
    opened(node([inside]))
    focusRenderable(inside)

    // The row is on screen, focusable and registered, and it is behind the scope — which is the one
    // reason the hit test refuses. A click that reached it would put the keys behind a dialog the
    // reader still has open, which is what Tab used to do (§ Scopes).
    click(rows[0])
    expect(focusedRenderable()).toBe(inside)
    expect(focusedInScope()).toBe(true)
  })

  it('lands the keys somewhere on screen when an ancestor of the focused node is hidden', async () => {
    const rows: Renderable[] = []
    const list = node(rows)
    const region = node([list])
    asFake(list).parent = region
    registerRegion(region, { paneId: 'pr', regionId: 'list' }, 0)
    const beside = control()
    asFake(beside).parent = region
    ;(region.getChildren() as Renderable[]).push(beside)
    row(list, rows, 'r0')
    focusRenderable(rows[0])

    // The shell's main row and a `TabPanel` hide a subtree rather than unmounting it, and `visible`
    // is per node in OpenTUI: the row inside goes on reporting itself visible, so the pass is what
    // notices (./regions.ts § onScreen, ../kit/grouping.tsx).
    const blurs = renderer.blurs()
    asFake(list).visible = false
    await settle()
    expect(focusedRenderable()).toBe(beside)
    expect(onScreen(focusedRenderable())).toBe(true)
    // And nothing was blurred on the way. A blur used to be how the keys left a node, and a blur on
    // a node that had lost its `focusable` flag was refused — which is how the keys got stuck on a
    // hidden subtree in the first place (./regions.ts § The one owner).
    expect(renderer.blurs()).toBe(blurs)
  })

  it('leaves a node that loses its focusable flag while it holds the keys', async () => {
    const region = node()
    const risky = control()
    const safe = control()
    const children = region.getChildren() as Renderable[]
    children.push(risky, safe)
    asFake(risky).parent = region
    asFake(safe).parent = region
    registerRegion(region, { paneId: 'pr', regionId: 'body' }, 0)
    focusRenderable(risky)

    // What a control going disabled does: the flag is the store's declaration of what can hold the
    // keys, so clearing it is a landing pass's business and `pressable` asks for one
    // (./stops.ts § pressable).
    risky.focusable = false
    await settle()
    expect(focusedRenderable()).toBe(safe)
  })

  // ── Scopes ──────────────────────────────────────────────────────────────────────────────────

  it('holds the keys inside an open overlay while the screen behind it changes', async () => {
    const rows: Renderable[] = []
    const browse = node(rows)
    registerRegion(browse, { paneId: 'chrome', regionId: 'browse' }, 0)
    await settle()
    // Nothing in the region yet, so it holds the keys on its own frame for want of anything better.
    expect(focusedRenderable()).toBe(browse)

    const yes = control()
    const modal = node([yes])
    const close = opened(modal)
    await settle()
    expect(focusedRenderable()).toBe(yes)

    // The region's list arrives. Before this was fixed the pass took the keys off the region holding
    // its frame and put them on the new row, behind a trap that swallowed every intent but
    // `dismiss`, so the modal was on screen and could not be answered.
    row(browse, rows)
    await settle()
    expect(focusedRenderable()).toBe(yes)

    // And they go back when it closes, on the list rather than on the border it left.
    close()
    await settle()
    expect(focusedRenderable()).toBe(rows[0])
  })

  it('re-lands inside an open overlay when the row that had the keys is destroyed', async () => {
    const region = node()
    registerRegion(region, { paneId: 'chrome', regionId: 'browse' }, 0)
    const first = control()
    const choices = [first]
    const modal = node(choices)
    opened(modal)
    drawn(() => markItem(first, undefined, 'choice one'))
    await settle()
    expect(focusedRenderable()).toBe(first)

    // A modal that redraws its own list — the trust prompt advancing to the next bundle in the queue
    // is one — destroys the row the keys were on, and there is no region behind it to re-enter. The
    // keys used to stay on the corpse, which is a dialog nothing answers.
    const replacement = control()
    asFake(replacement).parent = modal
    choices[0] = replacement
    destroy(first)
    await settle()
    expect(focusedRenderable()).toBe(replacement)
  })

  it('treats an overlay that closes into another one as a handover, not a restore', async () => {
    const region = node()
    registerRegion(region, { paneId: 'chrome', regionId: 'browse' }, 0)
    await settle()

    const first = control()
    const closeFirst = opened(node([first]))
    await settle()
    expect(focusedRenderable()).toBe(first)

    // The trust prompt's queue advancing, drawn as a fresh dialog: the second opens in the same turn
    // the first closes, and the keys must land in it rather than back on the region behind.
    const second = control()
    closeFirst()
    opened(node([second]))
    await settle()
    expect(focusedRenderable()).toBe(second)
  })

  it('gives the keys back to the stop that opened a list, not to the first stop of its region', async () => {
    // A `Menu` trigger, which is what this asks about: the list is drawn inside the region the
    // trigger sits in, so a region that remembered the list's rows would come back to a destroyed row
    // and fall through to its entry stop, which is the filter above the trigger and never the
    // trigger itself. The
    // region remembers its own stops only, and the list remembers the list's
    // (./regions.ts § The one owner).
    const filter = control()
    const trigger = control()
    const region = node([filter, trigger])
    registerRegion(region, { paneId: 'pr', regionId: 'body' }, 0)
    await settle()
    expect(focusedRenderable()).toBe(filter)

    expect(focusRenderable(trigger)).toBe(true)
    const optionOne = control()
    const list = node([optionOne, control()])
    asFake(list).parent = trigger
    const close = opened(list)
    await settle()
    expect(focusedRenderable()).toBe(optionOne)

    close()
    await settle()
    expect(focusedRenderable()).toBe(trigger)
  })

  it('comes back to the stop a nested list was opened from, not to the dialog around it', async () => {
    // A `Select` inside a `Modal`. The modal is a scope and not a region, so the only thing that can
    // remember its trigger is the modal's own scope, which is why a scope keeps a memory of its own
    // rather than the closing list recording a renderable to restore.
    const region = node()
    registerRegion(region, { paneId: 'pr', regionId: 'body' }, 0)
    const cancel = control()
    const select = control()
    const modal = node([cancel, select])
    opened(modal)
    await settle()
    expect(focusedRenderable()).toBe(cancel)

    expect(focusRenderable(select)).toBe(true)
    const optionOne = control()
    const list = node([optionOne])
    asFake(list).parent = select
    const close = opened(list)
    await settle()
    expect(focusedRenderable()).toBe(optionOne)

    close()
    await settle()
    expect(focusedRenderable()).toBe(select)
  })

  // ── The walks ───────────────────────────────────────────────────────────────────────────────

  it('moves between declared columns without wrapping', () => {
    const menu = node()
    const railRow = item()
    const rail = node([railRow])
    const mainRow = item()
    const main = node([mainRow])
    drawn(() => markItem(railRow))
    drawn(() => markItem(mainRow))
    registerRegion(menu, { paneId: 'chrome', regionId: 'menu' }, -130, { x: 0 })
    registerRegion(rail, { paneId: 'chrome', regionId: 'browse' }, -120, { x: 0 })
    registerRegion(main, { paneId: 'chrome', regionId: 'source' }, 0)

    moveRegion(1)
    expect(focusedRenderable()).toBe(railRow)
    expect(moveColumn(-1)).toBe(false)
    expect(moveColumn(1)).toBe(true)
    expect(focusedRenderable()).toBe(mainRow)
    expect(moveColumn(1)).toBe(false)
    expect(moveColumn(-1)).toBe(true)
    expect(focusedRenderable()).toBe(railRow)
  })

  it('crosses to the nearest column in the direction asked, and remembers each one', () => {
    // Three columns, because two frames drawn side by side inside one pane are two of them: the rail
    // at 0 and a `list-detail`'s list and detail at 1 and 2. One rule crosses the rail-to-pane edge
    // and the list-to-detail edge alike, which is what the integer buys over the `'rail' | 'main'`
    // pair it replaced — under that pair every region a layout registered was `'main'`, so Right in a
    // `list-detail` had nothing to cross to and did nothing at all
    // (docs/tui.md § Focus regions).
    const railRow = item()
    const rail = node([railRow])
    const listRow = item()
    const list = node([listRow])
    const detailStop = control()
    const detail = node([detailStop])
    drawn(() => markItem(railRow))
    drawn(() => markItem(listRow))
    registerRegion(rail, { paneId: 'chrome', regionId: 'menu' }, -130, { x: 0 })
    registerRegion(list, { paneId: 'pr', regionId: 'list' }, 0, { x: 1 })
    registerRegion(detail, { paneId: 'pr', regionId: 'detail' }, 1, { x: 2 })

    expect(focusRenderable(railRow)).toBe(true)
    // The nearest column right of the rail is the list, not the detail two along.
    expect(moveColumn(1)).toBe(true)
    expect(focusedRenderable()).toBe(listRow)
    expect(moveColumn(1)).toBe(true)
    expect(focusedRenderable()).toBe(detailStop)
    // And no wrap at either end (docs/tui.md § Focus regions).
    expect(moveColumn(1)).toBe(false)
    // Back, one column at a time, each landing where it left off rather than resetting.
    expect(moveColumn(-1)).toBe(true)
    expect(focusedRenderable()).toBe(listRow)
    expect(moveColumn(-1)).toBe(true)
    expect(focusedRenderable()).toBe(railRow)
    expect(moveColumn(-1)).toBe(false)
  })

  it('answers how many regions are in scope reactively, without focus having to move', () => {
    // The footer offers `tab region` only where Tab goes somewhere, and it asks this. `groups` is a
    // plain array, so a region registering or unregistering while the keys stay put left the answer
    // at whatever the last render happened to see. Hiding the rail moves focus as well, which is why
    // nobody caught it (../chrome/bindings.ts § activeHints).
    const first = node()
    registerRegion(first, { paneId: 'chrome', regionId: 'menu' }, 0)
    createRoot((stop) => {
      // A memo rather than an effect, because a memo recomputes as the signal is written and an
      // effect waits for the end of the turn, which is a turn this test does not have.
      const count = createMemo(() => regionsInScope())
      expect(count()).toBe(1)
      const second = node()
      const unregister = registerRegion(second, { paneId: 'chrome', regionId: 'tasks' }, 1)
      expect(count()).toBe(2)
      unregister()
      expect(count()).toBe(1)
      stop()
    })
  })

  it('passes over the chrome the topology names when it first crosses into a column', () => {
    const menuRow = item()
    const menu = node([menuRow])
    const strip = control()
    const paneRow = item()
    const pane = node([paneRow])
    drawn(() => markItem(menuRow))
    drawn(() => markItem(paneRow))
    registerRegion(menu, { paneId: 'chrome', regionId: 'menu' }, -130, { x: 0 })
    registerRegion(strip, { paneId: 'chrome', regionId: 'panes' }, -50)
    registerRegion(pane, { paneId: 'notes', regionId: 'body' }, 0)
    setTopology({
      home: () => null,
      opensOn: () => null,
      skips: (region) => region.regionId === 'panes',
    })

    expect(focusRenderable(menuRow)).toBe(true)
    expect(moveColumn(1)).toBe(true)
    expect(focusedRenderable()).toBe(paneRow)
  })

  it('treats the main content as the pane to the right of every rail region', () => {
    const menuRow = item()
    const menu = node([menuRow])
    const mainRow = item()
    const main = node([mainRow])
    drawn(() => markItem(menuRow))
    drawn(() => markItem(mainRow))
    registerRegion(
      menu,
      { paneId: 'chrome', regionId: 'menu' },
      -130,
      { x: 0, enterMainOnActivate: true },
    )
    registerRegion(main, { paneId: 'chrome', regionId: 'source' }, 0)

    expect(focusRenderable(menuRow)).toBe(true)
    expect(activationEntersMain()).toBe(true)
    expect(movePane(1)).toBe(true)
    expect(focusedRenderable()).toBe(mainRow)
    expect(activationEntersMain()).toBe(false)
    expect(movePane(-1)).toBe(true)
    expect(focusedRenderable()).toBe(menuRow)
  })

  it('climbs a stop to the strip that owns its panel, then to the region the topology calls home', () => {
    const railRow = item()
    const rail = node([railRow])
    const inPanel = control()
    const panel = node([inPanel])
    const strip = control()
    const main = node([strip, panel])
    drawn(() => markItem(railRow))
    drawn(() => markParent(strip, () => [panel]))
    registerRegion(rail, { paneId: 'chrome', regionId: 'browse' }, -120, { x: 0 })
    registerRegion(main, { paneId: 'chrome', regionId: 'source' }, 0)
    setTopology({
      opensOn: () => null,
      skips: () => false,
      home: (region) => (region.regionId === 'source' ? { paneId: 'chrome', regionId: 'browse' } : null),
    })

    // The strip is a sibling of its panel rather than an ancestor, so walking up alone never reaches
    // it. The panel is the edge the walk finds.
    expect(parentOf(inPanel)).toBe(strip)
    expect(parentOf(strip)).toBe(undefined)

    expect(focusRenderable(railRow)).toBe(true)
    expect(moveColumn(1)).toBe(true)
    expect(focusedRenderable()).toBe(strip)
    expect(focusRenderable(inPanel)).toBe(true)

    expect(moveBack()).toBe(true)
    expect(focusedRenderable()).toBe(strip)
    expect(moveBack()).toBe(true)
    expect(focusedRenderable()).toBe(railRow)
    // Nowhere further left, and no home named: the shell's own Escape layer gets the key.
    expect(moveBack()).toBe(false)
  })

  it('enters a list on its rows while a filter strip owns no panels', () => {
    const strip = control()
    const listRow = item()
    const region = node([strip, listRow])
    drawn(() => markParent(strip, () => []))
    drawn(() => markItem(listRow))
    registerRegion(node(), { paneId: 'chrome', regionId: 'menu' }, 0)
    registerRegion(region, { paneId: 'chrome', regionId: 'browse' }, 1)

    // An in-content filter such as GitHub's Open/Closed owns no panels, so it does not displace the
    // row collection below it.
    moveRegion(1)
    expect(focusedRenderable()).toBe(listRow)
  })

  it('enters a region on the strip that owns its panels', () => {
    const strip = control()
    const panel = node()
    const listRow = item()
    const region = node([strip, panel, listRow])
    drawn(() => markParent(strip, () => [panel]))
    drawn(() => markItem(listRow))
    registerRegion(node(), { paneId: 'chrome', regionId: 'menu' }, 0)
    registerRegion(region, { paneId: 'chrome', regionId: 'source' }, 1)

    // A `Sections` strip is the region's entry, ahead of anything in the panel it is showing.
    moveRegion(1)
    expect(focusedRenderable()).toBe(strip)
  })

  it('walks a box in reading order, taking a parent, a list, a viewport and a nested region once', () => {
    const strip = control()
    const inPanel = control()
    const panel = node([inPanel])
    const rowOne = item()
    const rowTwo = item()
    const list = node([rowOne, rowTwo])
    const button = control()
    const inner = control()
    const nested = node([inner])
    const region = node([strip, panel, list, button, nested])
    drawn(() => markParent(strip, () => [panel]))
    drawn(() => markItem(rowOne))
    drawn(() => markItem(rowTwo))
    drawn(() => markCollection(list, () => rowTwo))
    registerRegion(region, { paneId: 'pr', regionId: 'body' }, 0)
    registerRegion(nested, { paneId: 'pr', regionId: 'inner' }, 1)

    // The strip once, its panel not at all — the panel is the level below this walk, reached with
    // Down and left with Escape. The list once, as the row its caret is on. Then the button. The
    // nested region's frame is focusable from registration and is still not a stop here: a region is
    // a level of its own and Tab is how a reader reaches it, so the walk goes through it to the stop
    // inside (./regions.ts § stopsIn).
    expect(stopsIn(region)).toEqual([strip, rowTwo, button, inner])
    // And inside the panel the walk starts again, which is what scopes `moveStop` to a panel.
    expect(stopsIn(panel)).toEqual([inPanel])
  })

  it('moves between the stops of one panel and walls at its edges', () => {
    const strip = control()
    const first = control()
    const second = control()
    const panel = node([first, second])
    const outside = control()
    const region = node([strip, panel, outside])
    drawn(() => markParent(strip, () => [panel]))
    registerRegion(region, { paneId: 'pr', regionId: 'body' }, 0)

    focusRenderable(first)
    expect(moveStop(1)).toBe(true)
    expect(focusedRenderable()).toBe(second)

    // The end of the panel is a wall rather than a trip to the stop beside the strip: the intent is
    // taken and nothing moves, so an arrow never crosses a level.
    expect(moveStop(1)).toBe(true)
    expect(focusedRenderable()).toBe(second)
    expect(moveStop(-1)).toBe(true)
    expect(focusedRenderable()).toBe(first)
    expect(moveStop(-1)).toBe(true)
    expect(focusedRenderable()).toBe(first)
  })

  it('hands the arrows back for anything the walk does not own', () => {
    const only = item()
    const list = node([only])
    const region = node([list])
    drawn(() => markItem(only))
    drawn(() => markCollection(list, () => only))
    registerRegion(region, { paneId: 'chrome', regionId: 'browse' }, 0)

    // Focus is on the row, and the walk reports the list as one stop — which is the row itself, so a
    // naive index would move the caret out of the list. `moveStop` is not what answers here: the
    // collection's own layer is, and false is how it gets the chance.
    focusRenderable(only)
    expect(stopsIn(region)).toEqual([only])
    expect(moveStop(1)).toBe(false)
    expect(focusedRenderable()).toBe(only)

    // Nor for a region's own frame, which is focusable from registration and is not in its own walk.
    // Down there belongs to the region tier, not to a walk with nothing to walk.
    expect(focusRenderable(region)).toBe(true)
    expect(moveStop(1)).toBe(false)
  })
})

// ── What a key press costs ────────────────────────────────────────────────────────────────────
//
// The model's answers are the same whether the store scans arrays or reads maps, which is what every
// case above is about. This is the other half: how much of the tree a move has to look at
// (docs/performance.md § 2026-09-03 — phase 9).

describe('a key press costs the depth of the tree', () => {
  beforeEach(fresh)

  /** A region with `rows` rows in a list, plus a control beside it, nested `depth` boxes deep. */
  const deepRegion = (rows: number, depth: number) => {
    const cells: Renderable[] = []
    const list = node(cells)
    for (let at = 0; at < rows; at += 1) {
      const cell = item()
      asFake(cell).parent = list
      cells.push(cell)
      drawn(() => markItem(cell))
    }
    const button = control()
    let body = node([list, button])
    for (let at = 0; at < depth; at += 1) body = node([body])
    drawn(() => markCollection(list, () => cells[0]))
    registerRegion(body, { paneId: 'chrome', regionId: 'browse' }, 0)
    return { button, list, cells }
  }

  it('visits a bounded number of nodes in a two-hundred-row region', () => {
    walkSteps.count(true)
    try {
      const { button } = deepRegion(200, 3)
      focusRenderable(button)
      walkSteps.reset()
      // Down from the control beside the list. The list is one stop — the row its caret is on — so
      // the walk sees the list once and never its two hundred rows (./regions.ts § stopsIn).
      moveStop(1)
      const steps = walkSteps.take()
      // The bound the phase asked for: depth times four, where depth is the nesting above the stop.
      // Generous on purpose — what it forbids is the number growing with the rows, which is what a
      // scan of the registries inside the walk did.
      expect(steps).toBeLessThan(64)

      // And the same move in a region with ten times the rows costs the same, which is the property
      // the number alone cannot state.
      _resetRegions()
      installRegions(renderer as unknown as CliRenderer)
      const wide = deepRegion(2000, 3)
      focusRenderable(wide.button)
      walkSteps.reset()
      moveStop(1)
      expect(walkSteps.take()).toBe(steps)
    } finally {
      walkSteps.count(false)
    }
  })

  it('counts nothing while the flag is off', () => {
    const { button } = deepRegion(20, 2)
    focusRenderable(button)
    walkSteps.reset()
    moveStop(1)
    expect(walkSteps.take()).toBe(0)
  })
})

describe('the indexes agree with the lists they are built from', () => {
  beforeEach(fresh)

  it('answers the same after a region, a panel and a collection have come and gone', () => {
    const rowOne = item()
    const inPanel = control()
    const panel = node([inPanel])
    const list = node([rowOne])
    const strip = control()
    const region = node([strip, panel, list])

    drawn(() => markItem(rowOne))
    drawn(() => markCollection(list, () => rowOne))
    drawn(() => markParent(strip, () => [panel]))
    panelsChanged()
    const unregister = registerRegion(region, { paneId: 'chrome', regionId: 'browse' }, 0)

    // The strip is one stop and its panel is the level below, so the panel's own control is not a
    // neighbour of anything in the region.
    expect(stopsIn(region)).toEqual([strip, rowOne])
    expect(parentOf(inPanel)).toBe(strip)
    expect(regionsInScope()).toBe(1)

    // The region goes. Every index that named it has to go with it, and the ordering cache with them.
    unregister()
    expect(regionsInScope()).toBe(0)

    // And comes back under the same ref, which is what a `lazy()` region remounting is.
    registerRegion(region, { paneId: 'chrome', regionId: 'browse' }, 0)
    expect(regionsInScope()).toBe(1)
    expect(stopsIn(region)).toEqual([strip, rowOne])

    // A scope filters the same lists, so pushing one empties the region cycle and popping it fills it
    // again — the cached order is not allowed to outlive either edge (./regions.ts § ordered).
    const close = opened(panel)
    expect(regionsInScope()).toBe(0)
    close()
    expect(regionsInScope()).toBe(1)
  })
})
