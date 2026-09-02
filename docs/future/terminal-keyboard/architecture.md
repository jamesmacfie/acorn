# Terminal keyboard: how it works at the baseline

Analysis, 2026-09-02, of the tree at this folder's baseline commit. This is the as-is read. The
target is in [design.md](./design.md). Where this file and `docs/tui.md § Keys and focus` disagree,
the owning doc wins, and this file is the evidence for changing it.

The whole mechanism is 1,345 lines of production code under `apps/tui/src/keys/` (755 of them in
`regions.ts`), plus the kit's use of it. It was written in three days, across at least ten
focus-related commits and two retired programmes, and every piece of it is a correct fix for a bug
somebody saw. Read it that way. What follows is not a list of mistakes. It is a list of places where
two correct fixes meet and produce a third bug.

## What OpenTUI provides, and what it does not

All three packages are 0.5.9 (`@opentui/core`, `@opentui/solid`, `@opentui/keymap`). 0.5.10 is the
newest release and its notes touch nothing here.

| Capability | OpenTUI | Notes |
| --- | --- | --- |
| One focused renderable, previous one blurred on refocus | Yes | `renderer.focusRenderable(x)`, `renderer.currentFocusedRenderable` |
| `focusable` opt-in | Yes | Defaults to `false` on the base `Renderable`. `true` on `ScrollBox`, `Select`, `TabSelect`, `Input`, `Textarea`. `Box` takes it as an option. |
| Focus and blur events | Yes | `on:focused` and `on:blurred` per node. `focused_renderable` on the renderer, with the previous node. The Solid `onFocus`/`onBlur` hooks are the *terminal window's* focus, not a node's. |
| Mouse click focuses | Yes | Left mouse-down walks up to the nearest `focusable` ancestor and focuses it. `autoFocus` defaults on and `main.tsx` never turns it off. |
| Key delivery to the focused renderable | Yes | Every global `keyInput` listener first, in registration order. Then the one focused node's handler, only if nothing called `preventDefault` or `stopPropagation`. |
| Key bubbling up the tree | No | Only mouse events bubble. A parent receives no key its child did not answer. |
| "I handled it" from a renderable | No | `handleKeyPress`'s boolean return is discarded. Only `preventDefault()` or `stopPropagation()` from a *global* listener gates anything. |
| Tab order, traversal, a focus manager, a focus trap, default Tab | No | Zero references in the package. |
| Focus-scoped key layers walking the parent chain | Yes, in `@opentui/keymap` only | Layers with `target` and `targetMode: 'focus' \| 'focus-within'`. Sorted by `priority` descending, then newest registration first. |
| ScrollBox keys | Yes | Arrows, `hjkl`, PageUp/PageDown, Home/End on the focused scrollbox itself. |
| Scroll a child into view | Partly | `scrollChildIntoView(childId: string)` by id, reading laid-out geometry. No `scrollIntoView`. |
| `focus()` and `blur()` on a non-focusable or destroyed node | Silent no-op | Neither throws nor returns anything. |
| `visible = false` | Blurs only that node | A focused descendant keeps renderer focus. |

Two conclusions. First, there is no upstream focus architecture to lean on beyond the keymap's
layer model, and the app already runs on that. Traversal, containment, and landing are ours to own.
Second, three of the "no" rows above are load-bearing for the bugs in
[symptoms.md](./symptoms.md): the silent `focus()`, the discarded return value, and the lack of a
trap.

## The path of a key

1. `main.tsx:128` creates the renderer with `useKittyKeyboard: { disambiguate: true }`. Bytes from
   `stdin` are parsed into a `KeyEvent` with a name (`return`, `escape`, `up`, `pageup`, and so on)
   and modifier flags.
2. `keys/install.ts:66` builds the keymap engine with `createDefaultOpenTuiKeymap(renderer)`. The
   engine prepends itself to `renderer.keyInput`, so it sees every key before any renderable does.
   `setKeymap(engine, { primary: 'ctrl', typing })` stores it in a process singleton and installs the
   one predicate a binding may ask about the focused thing: is somebody typing. That predicate reads
   `renderer.currentFocusedRenderable`.
3. Inside the engine, `key` intercepts run first in priority order. An intercept that calls
   `consume()` ends dispatch. There is one: the PTY rectangle at priority 200
   (`kit/rectangle.tsx:146`).
4. Then layers, sorted by `priority` descending and, at a tie, newest registration first. A layer is
   active when it has no target, or its target is the focused node (`mode: 'focus'`), or its target
   is an ancestor of the focused node (`focus-within`). The focused node comes from the renderer.
5. A binding whose handler returns `false` is "rejected" and dispatch carries on to the next layer.
   Anything else is handled and stops. Nothing in the app calls `stopPropagation` except the
   rectangle's `consume()`. Arbitration is priority plus return value, and nothing else.
6. If nothing handled the key, the focused renderable's own handler runs. For an `Input` or
   `Textarea` that is where typing happens. For a `ScrollBox` that is where its own arrow handling
   happens.

## The tiers, as registered

| Priority | Registered by | Target | What |
| --- | --- | --- | --- |
| 200 (intercept) | `kit/rectangle.tsx:146` | none, pre-dispatch | An entered PTY consumes every key, Ctrl+C included. Outside, Enter enters and a second Escape within 400 ms re-enters. |
| 61 | `keys/trap.ts:47` `overlayKeys` | global | The palette's own Up, Down, Enter (`chrome/Palette.tsx:147`). |
| 60 | `keys/trap.ts:59` `trapKeys` | global | `dismiss`. |
| 45 | `kit/grouping.tsx:233` `Tabs` | focus | `h`/`l`/Left/Right change tab. `j`/Down enters the panel. No `k`/Up binding. |
| 41 | `keys/stops.ts:32` `pressable` | focus | `activate`, the caller's `on`, and `next`/`prev` to `moveStop`. Also `kit/asking.tsx:181` Textarea `commit`, `:515` MentionTextarea Down, `plugins/SourcePanel.tsx:115` field Down and Escape. |
| 40 | `keys/collection.ts:124` | focus-within | The collection's ten intents. |
| 36 | `kit/grouping.tsx:400` `MenuList` | focus-within | An open `Menu`'s `j`/`k` and Down/Up, registered as two layers with different typing gates. |
| 35 | `keys/trap.ts:32` swallow | global | Every intent but `dismiss`, from the shared key table. |
| 30 | `kit/scrolling.tsx:38` | focus for arrows, focus-within for page keys | Viewport scroll. Also `layouts/Tabs.tsx:40` Ctrl+1..9, `layouts/split.ts:49` Ctrl+Shift+arrows, `layouts/ListDetail.tsx:54` narrow group switch. |
| 5 | `keys/install.ts:113` | global | `nextRegion`, `prevRegion`, `nextPane`, `prevPane`, `dismiss`, and `expand`/`collapse` gated on not typing. |
| 5 | `chrome/Shell.tsx:195` | focus-within on the root, so always | Escape clears a notification. Returns `false` when there is none. |
| 0 | `keys/commandLayer.ts:93` | global | The command registry's chords, and the shell's bare keys `w p n q ?`, gated on not typing. |
| 0 | `main.tsx:174` | global | Ctrl+C quits. |

Three things about this table that a reader of the code will not see:

- Two layers at tier 5 bind Escape. The shell's registers later during render, so by
  newest-first it runs first, and it works only because `dismissNotifications()` returns `false`
  when there is no toast. The order is load-bearing and nothing at either site says so.
- `stops.ts:22-32` chose 41 rather than 40 because a `Button` inside a `Row` matches both its own
  focus layer and the row's focus-within layer, and which ref runs first is the reconciler's
  business. `trap.ts:20-31` moved the swallow from 60 to 35 because a list inside a `Modal` was
  dead at 60. Both are right, and both are arbitration by number.
- `expand` and `collapse` at tier 5 are gated on typing. `nextRegion`, `nextPane`, and `dismiss`
  at the same tier are not.

## Focus: two sources of truth

The renderer owns focus and routes keys by it. The app draws highlights from a signal. They are
kept in step by convention, at every write site, and the convention has holes.

**Where the truth is written.** `regions.ts:81` declares the signal. Every focus move writes both:

```ts
// regions.ts:221 focusRenderable
node.focus(); noteFocus(node); return true
// regions.ts:446-450 enter
target.focus(); setFocusedNode(target)
// regions.ts:546-550 holdInOverlay
target.focus(); setFocusedNode(target)
// keys/collection.ts:67 and :117
box.focus(); noteFocus(box)
```

Two more module variables travel beside the signal and are not signals: `focused: RegionRef | null`
at `regions.ts:70`, which region has the keys, and `provisional` at `:77`, whether the region is
holding them on its own frame for want of anything better.

**Where they diverge.**

1. `focus()` refuses silently when the target is not `focusable` or is destroyed. The signal is
   written regardless. `focusRenderable` returns `true` regardless.
2. The renderer moves focus on its own on a mouse click. Nothing subscribes to
   `focused_renderable`. Two places bridge a click by hand: `stops.ts:85` `box.onMouseDown` and
   `scrolling.tsx:59`, whose comment names the gap ("the region store cannot observe browser-like
   `focusin`"). `showing.tsx:355-364` does the same for the virtual wheel.
3. `rectangle.tsx:106` `leave()` calls `box?.focus()` with no `noteFocus`. The renderer moves, the
   signal does not.
4. `stops.ts:63` flips `focusable` off when a control is disabled. If it was focused, `blur()` then
   refuses, and the node and all its ancestors report focus forever.
5. `holdInOverlay` writes the signal but not `focused` (the region) or `group.last`.
6. `Shell.tsx:205` hides the main row behind an overlay with `visible=false`. OpenTUI blurs only the
   row, so the node focused behind the overlay keeps renderer focus and keeps answering its
   focus-within layers.

**Two idioms for one question.** "Is focus inside this box" is `focusWithin(box)` at
`regions.ts:96`, a walk up from the signal, and is also `box.focused || box.hasFocusedDescendant`
at `rectangle.tsx:154`, the renderer's own flags. The two can answer differently.

## The five levels, and what a trap is

`regions.ts:20` describes five levels: screen, column, region, parent stop, stop.

- A *region* is a `Group` (`regions.ts:55`): a box, a `{ paneId, regionId }`, a `column` of
  `'rail' | 'main'`, an explicit `order`, and memory (`last`, `lastIdentity`). Layouts register
  regions from `ref` callbacks with `regionFocus(ref, order, options)` (`regions.ts:191`), 17 call
  sites outside `keys/`.
- A *stop* is anything the walk lands on. `stops.ts:60` `pressable()` sets `focusable = true`,
  binds `activate`, and answers `focused()`.
- A *collection* is a `Rows`: one container (`markCollection`, `regions.ts:276`) whose rows are
  items (`markItem`, `:249`). From outside it is one stop, drawn as its roving row.
- A *parent stop* is a `Tabs` strip that owns `TabPanel`s (`markParent`, `regions.ts:133`). Down
  enters, Escape climbs. The strip and its panels are siblings, paired by `idPrefix` through a
  process-global map (`grouping.tsx:173`).
- A *trap* is not a focus concept at all. It is two global key layers (`trap.ts`). The focus half
  is a separate call, `takeFocus` (`regions.ts:615`), which at the baseline `Modal` makes itself.

The walk over stops, `stopsIn` (`regions.ts:343`), is depth first over the retained tree with four
rules: a parent stop counts once and its panels are skipped, a collection counts once as its active
row, a scrollbox is transparent while it holds a stop and is the stop otherwise, anything else
focusable counts once. It is a good walk. It is also duplicated: `moveStop` (`:401`, walls at an
edge), `moveFocusFrom` (`:422`, does not wall), and `stops.ts:121` `moveStopIn` (scoped to a box)
differ only in wall, wrap, and scope.

## Overlays: three registries

One open dialog is described in three places that nothing keeps in step:

1. `chrome/state.ts:24`, a stack of `OverlayName`s. The shell draws exactly one of them
   (`Shell.tsx:250-264`) and hides the main row behind it (`:205`).
2. `regions.ts:465`, a stack of overlay renderables, pushed by `takeFocus`, read by the settle pass.
3. `trap.ts`, two anonymous keymap layers per `Modal` or `MenuList`.

`Shell.tsx:80-83` keeps the first in step with `pendingTrust()`. The palette, deliberately, uses
none of the kit's collection: it binds its own arrows at tier 61 above both trap layers and keeps a
plain cursor signal (`Palette.tsx:33-45`), because bare keys never fire while an `Input` is focused.

## The settle pass, as a state machine

Every focus decision that needs a renderable the current render has not produced yet waits in
`settleFocus` (`regions.ts:592`), queued at most once per turn by a single `queueMicrotask`
(`:492`). The pass, at the baseline:

```ts
function settleFocus(): void {
  const overlay = openOverlay()
  if (overlay) { holdInOverlay(overlay); revealFocus(); return }   // 0
  reviveFocus()          // 1  focus is on a corpse: re-enter its region by row identity
  openScreen()           // 2  nothing has the keys and regions exist: enter the topology's home
  claimProvisional()     // 3  a region holding its own frame has grown a stop: enter it
  restoreFromOverlay()   // 4  an overlay closed: give back what it took, or open the screen
  revealFocus()          // 5  scrollChildIntoView in every scrollbox above
}
```

Its inputs are the signal, `focused`, `provisional`, `overlays`, `overlayClosing`, and every
`Group`'s memory. Thirteen sites schedule it. What is not in the code:

- **It depends on a timing accident.** `kit/reconciler.ts:79-89` defers a node's real destruction to
  `process.nextTick`, which always runs *after* the settle microtask. So at settle time a row that is
  being removed still reports itself live. `reviveFocus` relies on this to return early, and
  `restoreFromOverlay`'s special case for "an overlay that was open before anything had the keys"
  exists to rescue the boot-time trust prompt from exactly this.
- **Not every move schedules it.** `enter()` does not. A walk that lands outside an open overlay is
  never corrected, which is symptom A.
- **Focusing changes the graph.** `regions.ts:447` and `:547` set `focusable = true` on a frame as
  a side effect of landing on it. `showing.tsx:320` and `:361` flip a container's `focusable` on and
  off around wheel events. The set of things that can be focused depends on what has been focused.

`docs/tui.md § Focus regions` says it plainly: "there were six of these and each was a correct fix
for a real bug. Together they were a state machine nobody had written down." The baseline commit
added a seventh (`holdInOverlay`), for a real bug.

## Scrolling: two mechanisms and a clip

`kit/scrolling.tsx` wraps OpenTUI's `scrollbox`. Wheel and trackpad are the renderable's. Keys are
two layers at tier 30: arrows in `focus` mode (only when the viewport itself is the stop) and page
intents in `focus-within` mode (from any control inside). `revealInViewports` (`regions.ts:315`)
calls `scrollChildIntoView` on every scrollbox ancestor of the focused node, from `noteFocus`,
`enter`, and the settle's last step.

`Rows virtual` (`showing.tsx:234-330`) is a hand-rolled window with its own `top` signal, because
OpenTUI has no virtualiser. It follows the caret by the least amount. `revealInViewports` does
nothing for it.

`overflow="scroll"` is a yoga clip, and five sites use it as a scroll (see
[symptoms.md](./symptoms.md) § E1).

## The rectangle

`kit/rectangle.tsx` is a key intercept at priority 200, not a layer, because "a layer answers keys it
can name and a rectangle answers all of them". The outer box is the stop; the embedded terminal
renderable is explicitly not `focusable` (`:117`) so region entry cannot land past the door. While
entered, every key is consumed and sent through `encodeKey`. `entered` is a module-level count
(`:63`), read only by the footer. `inside()` is cleared by Escape or unmount, not by losing focus or
being hidden.

## The spread

Numbers for the tree at the baseline, so a later reader can tell whether the surface has shrunk:

| What | Count |
| --- | --- |
| Production lines under `keys/` | 1,345 (`regions.ts` 755, `install.ts` 158, `collection.ts` 137, `stops.ts` 129, `commandLayer.ts` 95, `trap.ts` 71) |
| Files outside `keys/` importing `keys/regions` | 19 production files |
| `regionFocus(...)` call sites outside `keys/` | 17 (Rail 3, Shell 2, layouts 12) |
| Region ids spelled inline in `layouts/` | 12, plus five constants in `chrome/topology.ts` |
| Direct `renderable.focus()` calls | 6 (`regions.ts` 3, `collection.ts` 2, `rectangle.tsx` 1) |
| Direct `focusable =` writes | 9 (five outside `keys/`) |
| Reads of `focusRenderable`, `focusWithin`, `focusedRenderable`, `focusedRegion`, `focusedItem`, `focusedOpens` outside `keys/` | 44 |
| Sites that call `scheduleSettle` | 13 |
| Registries a test suite has to reset | 4 (`_resetRegions`, `_resetCollections`, `_resetChrome`, `panelsByPrefix`) |

## Verify before building

- Package versions: `apps/tui/package.json` pins `^0.5.9` for the three OpenTUI packages.
- The tier table: `grep -rn "priority" apps/tui/src --include=*.ts --include=*.tsx`.
- The settle pass: `sed -n 489,605p apps/tui/src/keys/regions.ts`.
- The reconciler's `nextTick`: `apps/tui/src/kit/reconciler.ts:79-89`.
- The three overlay registries: `chrome/state.ts`, `regions.ts` `overlays`, `trap.ts`.
