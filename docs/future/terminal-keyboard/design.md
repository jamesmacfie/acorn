# Terminal keyboard: the target

Design, 2026-09-02. Nothing here has shipped. When a piece does, it moves to `docs/tui.md § Keys and
focus` and the matching section here shrinks to a pointer.

[architecture.md](./architecture.md) found four structural faults and one scrolling fault. This file
is five rules, one per fault, and the data model that makes each rule cheap to keep. A developer
implementing a phase should be able to point at the rule it serves.

## What does not change

Before the rules, the things that stay exactly as they are, because they are right and because the
plugins depend on them:

- **One engine.** Every key goes through `@opentui/keymap`'s layers. No `useKeyboard`, no
  `onKeyDown`, no key handling in a component. `docs/tui.md § What must never happen` stands.
- **Keys are intents first.** `client-core/kit/keys/intents.ts` is the closed set. Nodes handle
  `next`, never `ArrowDown`.
- **The kit's public shape.** `Rows`, `Row`, `Tabs`, `TabPanel`, `Modal`, `Menu`, `Button`,
  `Input`, and the rest keep their props. A plugin does not learn any of this.
- **The five levels.** Screen, column, region, parent stop, stop. The vocabulary is good. The
  mechanism under it is what changes.
- **The footer reads the layers.** It keeps saying what the focused thing accepts, from the engine.
- **The reachability property.** `reachability.test.tsx` stays the property over the roster and
  gains assertions. It is not replaced.

## Rule 1: the renderer is the only truth

**The rule.** `renderer.currentFocusedRenderable` is where focus is. The store's `focusedNode`
signal is a derived view of it, written in exactly one place: a subscription to the renderer's
`focused_renderable` event. Every focus move in the app goes through one function that asks the
renderer and reports what the renderer did.

```ts
// keys/regions.ts, the only writer of the signal
renderer.on('focused_renderable', (node, previous) => {
  setFocusedNode(node)
  const group = regionOf(node)
  if (group) {
    group.last = node
    group.lastIdentity = itemIdentities.get(node)
    lastByColumn[group.x] = group
    focused = { paneId: group.paneId, regionId: group.regionId }
  }
})

// the only caller of `.focus()` in apps/tui/src
export function focusRenderable(node: Renderable | undefined): boolean {
  if (!node || node.isDestroyed || !node.visible || !node.focusable) return false
  node.focus()
  return node.focused
}
```

**Why.** Every divergence in [architecture.md](./architecture.md) § Focus is a second writer.
Remove the second writer and there is nothing to keep in step. A refused `focus()` returns `false`
and the caller walks on. A mouse click flows in through the same event with no bridge. The
rectangle's `leave()` moves focus and the store sees it. `focusable` is declared once, at mount, and
a disabled control stays `focusable` and refuses `activate` instead, so `blur()` always works.

**What it costs.** `noteFocus` goes. The two mouse bridges go. `regions.test.ts`'s fake renderables
must model `focusable` and emit the event, which is a small fake and a truer one.

**What it forbids.** `setFocusedNode` anywhere but the listener. `.focus()` anywhere but
`focusRenderable`. `focusable =` anywhere but a mount `ref`. `invariants.test.ts` greps for all
three.

## Rule 2: a trap is a scope, not a swallow

**The rule.** The store keeps a stack of *scopes*. The bottom is the screen. A `Modal` or an open
`MenuList` pushes its box on mount and pops it on cleanup. Every question the store answers is
answered inside the top scope only: which regions are on screen, which stops are in a region, where
Tab goes, where Left goes, what the entry stop of a region is. Nothing behind the top scope exists
as far as the keys are concerned.

```ts
type Scope = { box: Renderable | null; returnTo: RegionRef | null; returnIdentity?: string }
const scopes: Scope[] = [{ box: null, returnTo: null }]   // the screen
const top = () => scopes[scopes.length - 1]
const inScope = (node: Renderable) => !top().box || within(top().box, node)
const regionsInScope = () => groups.filter((g) => inScope(g.box)).sort(byOrder)
```

**Why.** A swallow layer has to name every key it swallows, and the moment one table differs from
another (the shared table versus the host table, symptom A) a key leaks. A scope names nothing. It
makes the things behind the dialog unreachable, and a key that has nothing to reach does nothing.
`trapKeys` shrinks to one layer, `dismiss` at the trap tier. `SWALLOWED` is deleted.

**What follows from it.** The command layer's bare keys (`w p n q ?`) are gated on
`scopes.length === 1`, so a modal does not open the workspace picker. Chords stay live. Collection
layers behind the dialog are `focus-within` and focus is inside the dialog, so they do not fire; no
gate is needed there. The shell's `OverlayName` stack in `chrome/state.ts` stays, because it answers a
different question: which overlay to draw. The `regions.ts` `overlays[]` stack is replaced by
`scopes`. Two registries become one for focus and one for drawing, and the drawing one never
touches the keys.

**The footer.** Inside a modal the region layer's `nextRegion` binding is still registered, so the
footer must ask the store whether Tab has anywhere to go. `activeHints()` already reads the store's
signals; it adds "regions in scope > 1" to the `region` hint's probe. The footer never offers
`tab region` when there is one region in scope.

## Rule 3: one landing rule

**The rule.** There is one function, `ensureFocus()`, and one question it asks: is the focused
renderable live, visible, focusable, and inside the top scope? If yes, reveal it and stop. If no,
land. Landing tries, in order:

1. The top scope's `returnTo` region, if one was recorded when the scope was pushed, resolved by
   row identity first (a refetch may have replaced the row) and by the region's remembered stop
   second.
2. The scope's home region, as the topology names it (`chrome/topology.ts`), by its remembered stop.
3. That region's entry stop: first parent stop, else first collection row, else first stop.
4. The region's frame, which is `focusable` from registration. A landing on the frame is never
   remembered as `last`.

It runs after any commit, on the one microtask `scheduleSettle` already owns, and on every scope
push and pop. It also runs when a region that is holding its frame has grown a stop, which is the
old `claimProvisional` expressed as a condition on the current tree rather than a flag.

```ts
function ensureFocus(): void {
  const node = focusedNode()
  const valid = node && !node.isDestroyed && node.visible && node.focusable && inScope(node)
  const onFrame = valid && groups.some((g) => g.box === node) && entryStop(node)
  if (valid && !onFrame) { reveal(node); return }
  const scope = top()
  const home = (scope.returnTo && groupAt(scope.returnTo)) ?? homeRegion(scope)
  if (home) enter(home)          // enter = remembered by identity, else entry stop, else frame
  else if (scope.box) focusRenderable(entryStop(scope.box) ?? scope.box)
}
```

**Why.** The baseline's settle pass is five steps over four globals, ordered so that each step's
side effect is the next step's input, and correct only because the reconciler defers destruction to
`process.nextTick`. `ensureFocus` has no globals but the scope stack and the regions' own memory,
and it does not care whether a corpse still reports live: a corpse is not `inScope` of anything
after its scope popped, and a corpse in the current scope fails `isDestroyed` a tick later, when the
next commit schedules the pass again. Every path lands on the same four steps, so a bug in landing
is one bug.

**What goes.** `provisional`, `overlayClosing`, `overlays`, `reviveFocus`, `openScreen`,
`claimProvisional`, `restoreFromOverlay`, `holdInOverlay`, `landInOverlay`, and `takeFocus` as a
public function (a `Modal` pushes a scope; that is the whole API). `moveStop`, `moveFocusFrom`, and
`moveStopIn` become one `walkStops(from, delta, { within, wrap })`. The one `queueMicrotask` stays.
`regions.ts` should come in under 450 lines.

**The reconciler's `nextTick` deferral stays.** It exists for Suspense, not for focus
(`docs/tui.md § Destroy on disposal`). After this rule nothing in focus depends on it.

## Rule 4: tiers are named, few, and claims are honest

**The rule, part one: a table.** `keys/tiers.ts` exports every priority the app uses, with a
sentence each, and nothing else spells a number:

| Name | Value | Who | Why this high |
| --- | --- | --- | --- |
| `RECTANGLE` | 200 (intercept) | an entered PTY | Consumes everything, including chords. Pre-dispatch because it cannot name its keys. |
| `OVERLAY_OWN` | 61 | the palette's arrows | A text box steered by arrows; above the trap because bare keys are inert while typing. |
| `TRAP` | 60 | `dismiss` in a `Modal` or `MenuList` | Escape closes the top scope before anything inside it sees the key. |
| `PARENT` | 45 | a `Tabs` strip | Above the collection it may sit inside. |
| `STOP` | 41 | a `pressable` | Above its containing collection's focus-within layer (see `stops.ts`). |
| `COLLECTION` | 40 | a `Rows` | The kit default. |
| `LIST` | 36 | an open `Menu`'s list | Below the collection, above the viewport. |
| `PANE` | 30 | viewports, `tabs` Ctrl+1..9, split resize, narrow group switch | The pane's own keys. |
| `REGION` | 5 | Tab, Shift+Tab, pane chords, Escape, Left/Right as a last resort | The screen's keys. |
| `COMMAND` | 0 | the command registry and Ctrl+C | Everything a user can rebind. |

A test in `keys/tiers.test.ts` walks the engine's registered layers on a rendered surface and fails
when two layers at one tier bind the same key with the same target mode and target. The two tier-5
Escapes at the baseline fail it, and the fix is one binding: the shell's notification dismiss moves
into the region layer's `dismiss` handler as its first step.

**The rule, part two: a handler returns `true` only if something changed.** A `Tabs` strip at its
edge returns `false`. A tree row's `expand` on a leaf returns `false`. A collection's `pageNext` at
the last row returns `false`. A `moveColumn` with nowhere to go returns `false`. `onExpand` in
`collectionIntents.ts` may return a boolean; `undefined` keeps the DOM's current behaviour, so no
desktop tree changes until it opts in.

**Why.** Symptom C is five owners of one key, two of which claim it and do nothing. With honest
claims, an unhandled Left bubbles to the region tier, and the region tier has one meaning for it.

**The rule, part three: columns are an integer.** `column: 'rail' | 'main'` becomes `x: number`.
The rail's regions are `x: 0`. A layout's regions default to `x: 1`. A layout with side-by-side
regions declares them: `ListDetail` gives its list `x: 1` and its detail `x: 2` when wide,
`DocumentSplit` and `StackSplit` do the same when their axis is horizontal. `moveColumn(delta)`
finds the nearest `x` in the current scope in that direction and enters that column's last-used
region, else its first. No wrap. The topology's "a first crossing into main skips the pane strip"
stays as it is.

**The contract, key by key.** This table is what the footer says, what the tests assert, and what a
developer checks a change against. "Bubbles" means the handler returns `false` and the next tier
answers.

| Focused thing | `↓` `j` / `↑` `k` | `→` `l` / `←` `h` | `⏎` `space` | `esc` | `pgdn` `pgup` `home` `end` | `tab` / `shift+tab` |
| --- | --- | --- | --- | --- | --- | --- |
| A row in a vertical list | next/previous row, wrapping | tree: expand/collapse, bubbles on a leaf. Plain list: bubbles | activate, then enter main if the region says so | the parent stop, else the region's home | page/first/last, clamped; bubbles at an edge | region tier |
| A row in a horizontal list (`Tabs` without panels, `DocumentTabs`, chips) | bubbles | next/previous, bubbles at an edge | activate | as above | first/last | region tier |
| A parent stop (`Tabs` with panels) | Down enters the shown panel. Up: previous stop, bubbles at an edge | next/previous tab, bubbles at an edge | press | the region's home | scroll the viewport around it | region tier |
| A plain stop (`Button`, `Toggle`, `Select` trigger, rectangle door) | next/previous stop in the panel, an edge bubbles | bubbles | press. A rectangle door enters | the parent stop, else the region's home | scroll the viewport around it | region tier |
| A field (`Input`, `Textarea`) | types. Multi-line `Textarea`: cursor | types | types, or submits an `Input` | leaves the field for its parent stop or home | types | region tier |
| A viewport holding no stop | scroll a fifth of a page | bubbles | nothing | the region's home | scroll | region tier |
| An entered rectangle | to the PTY | to the PTY | to the PTY | leave; a second within 400 ms re-enters and sends | to the PTY | to the PTY |
| Region tier (what bubbles reaches) | nothing | one column left/right in scope, no wrap | nothing | close the top scope if it is an overlay, else a notification, else the region's home per topology | nothing | next/previous region in scope, wrapping; nothing with one region |

The one behaviour this table changes on purpose: Left on the first tab of a strip used to be a wall
and is now a bubble to the column move. [refused.md](./refused.md) records the reversal.

## Rule 5: anything that can exceed its box is a viewport

**The rule.** `overflow="scroll"` appears in `kit/scrolling.tsx` and nowhere else under
`apps/tui/src`. A region body that can grow past its frame is a `ScrollViewport` or a `Rows
virtual`. The five sites in [symptoms.md](./symptoms.md) § E1 change, and the rail's Browse panel
takes `scroll`.

Page moves clamp. `collectionIntents.ts` `move(delta)` for `pageNext` and `pagePrev` goes to
`min(at + PAGE, last)` and `max(at - PAGE, 0)`, and returns `false` when it is already there. The
arrows keep wrapping. This is a shared change and the desktop gets it too.

Reveal happens twice: once synchronously on focus, as it does, and once more after layout.
`ScrollViewport` subscribes to the renderer's `focused_renderable` event and, when the focused node
is inside it, calls `scrollChildIntoView` again on the next frame. The settle pass does not do this;
it is the viewport's concern, and it keeps the settle to one microtask.

**Why.** A caret you cannot see is a caret you cannot trust. Eight of the nine plugin lists have no
viewport today, and a ten-row list's PageDown moves nowhere.

## The rectangle

`entered` becomes a derived fact: a rectangle is entered while its box has renderer focus and the
reader pressed Enter since it last lost focus. Losing focus for any reason, including being hidden
by an overlay or a tab switch (the `ensureFocus` pass moves focus off a non-visible node), leaves
it. `leave()` goes through `focusRenderable`. The intercept checks `box.focused && inside()` and
nothing else. The 400 ms Escape pair stays.

## The invariants, revised

The eight sentences in `docs/tui.md § The invariants` stay, with three additions and two changes.

| # | Invariant | Where it is checked |
| --- | --- | --- |
| 1 | Every stop a region declares is reachable from the keyboard. | `reachability.test.tsx` |
| 2 | Every stop acts: focusing it and pressing Enter calls the handler. | `kit/kit.test.tsx` |
| 3 | One caret, and it marks what has the keys. | `reachability.test.tsx` after every press |
| 4 | Escape is bounded and ends in the rail. | `reachability.test.tsx` |
| 5 | One deferred decision: `queueMicrotask` once in `keys/`, never in `kit/`. | `invariants.test.ts` |
| 6 | Focus never sits on a corpse. | `reachability.test.tsx` after every press |
| 7 | No chord this host cannot press. | `invariants.test.ts` |
| 8 | The footer tells the truth: the word beside a key is what the key does there. | `reachability.test.tsx`, now by pressing the key, not only reading the word |
| 9 | **The renderer and the store agree.** `renderer.currentFocusedRenderable === focusedRenderable()`, and it is live, visible, and focusable. | `reachability.test.tsx` after every press. Made structural by rule 1: `setFocusedNode` appears once, `.focus()` once, `focusable =` only in mount refs (`invariants.test.ts`). |
| 10 | **Focus is inside the top scope.** With a `Modal` open, no key moves focus out of it. | `reachability.test.tsx` with an overlay surface; `keys.test.tsx` presses Tab, not F6 |
| 11 | **A claimed key changed something.** For every focused kind and every key in the contract table, either the screen changed or the key bubbled. | `keys/contract.test.tsx`, a table-driven test over the contract |

Invariant 3 regains its lit-control half once `selected` and focus are distinguishable in the cell
buffer, which they are not today. That is a `kit/roles.ts` question and stays out of this programme.

## Observability

`ACORN_TUI_KEYS_TRACE=1` makes `keys/install.ts` register a `key-after` intercept and append one
line per key to `$XDG_STATE_HOME/acorn/keys.log` (or `~/.local/state/acorn/keys.log`):

```text
16:04:12.031 key=tab           reason=binding-handled  focused=box#412 region=rail/menu scope=screen agree=yes
16:04:12.940 key=l             reason=binding-rejected focused=row#77  region=pr/list  scope=screen agree=yes
16:04:13.552 key=return        reason=intercept-consumed focused=box#520 region=task/body scope=screen agree=no
```

The engine's `KeyAfterInputContext` carries `reason` and `focused`; the store adds the region, the
scope depth, and whether invariant 9 holds. `agree=no` is a bug every time. This is the first thing
a developer turns on when a reader says "the keys stopped working", and it lands in phase 0 so it is
there for the rest of the programme.

## The data model, in one place

```text
Scope        { box: Renderable | null, returnTo: RegionRef | null, returnIdentity?: string }
             A stack. Bottom is the screen (box null). Modal and MenuList push and pop.

Group        { box, paneId, regionId, x: number, order, last?, lastIdentity?, pickOnEnter }
             Registered by regionFocus from a layout ref. The frame is focusable from registration.

Stop         Any focusable renderable inside a Group's box: a pressable, a collection's active row,
             a parent strip, a viewport with no other stop, a rectangle's door.

Collection   markCollection(box, active) + markItem(row, pick, identity). One stop from outside.

Parent       markParent(strip, panels). One stop from outside; Down enters its shown panel.

The signal   focusedNode, written only by the renderer's focused_renderable listener.
The region   focused: RegionRef | null, written only in that listener, from regionOf(node).
The pass     ensureFocus(), one microtask, on commit and on scope change.
The walk     walkStops(from, delta, { within, wrap }) over stopsIn(within).
The tiers    keys/tiers.ts, ten names.
```

## Verify before building

- The renderer emits `focused_renderable` with `(renderable, previous)`:
  `grep -n "focused_renderable" node_modules/.pnpm/@opentui+core@0.5.9*/node_modules/@opentui/core/*.js`.
- The keymap's `key-after` intercept and `KeyAfterReason`:
  `node_modules/.pnpm/@opentui+keymap@0.5.9*/node_modules/@opentui/keymap/src/types.d.ts` around
  `KeyAfterInputContext`.
- `scrollChildIntoView` reads `child.y`; a post-layout re-reveal needs the renderer's frame event.
  Check the renderer's event names before wiring rule 5's second reveal.
- `collectionIntents.ts` is shared with the desktop. Run the desktop's kit tests after changing it.
