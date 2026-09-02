# Terminal keyboard: the five reports, traced

Analysis, 2026-09-02. Each report below is traced to the code that produces it, in the tree at the
baseline commit this folder was written against (see [README.md](./README.md)). Line numbers are
hints. Re-read the file before you build on one.

The short version: five reports, four structural causes, and one scrolling cause.
[architecture.md](./architecture.md) describes the structure. This file only connects each thing
the reader saw to the line that did it, says how sure we are, and names the test that would have
caught it.

## Two words you need

- *Renderer focus* is `renderer.currentFocusedRenderable`, OpenTUI's one focused node. It is what
  routes keys: the keymap engine asks the renderer what is focused before it picks a layer.
- *Store focus* is the Solid signal `focusedNode` in `apps/tui/src/keys/regions.ts:81`. It is what
  draws every highlight: the caret, the lit `Panel` border, a control's `focused()`.

When the two disagree, the reader sees one thing lit and a different thing answering the keys. Most
of what follows is a way for them to disagree.

## A. The trust prompt at start cannot be answered

**What the reader saw.** The app opens, the "Run this plugin?" dialog is on screen, and neither
choice can be selected. Escape works. Nothing else does.

**Cause 1, high confidence: the trap swallows the shared key table, and Tab is not in it.**

`apps/tui/src/keys/trap.ts:62` builds the swallow layer from `keysFor()`, the table shared with the
desktop, where `nextRegion` is `['f6']`. The region layer in `apps/tui/src/keys/install.ts:42-45`
binds `hostKeysFor()`, which adds `tab` and `shift+tab` to the same intents:

```ts
// install.ts
const HOST_KEYS = { nextRegion: ['tab'], prevRegion: ['shift+tab'] }

// trap.ts
const keys = keysFor()   // the shared table: nextRegion is ['f6'] only
bindings: SWALLOWED.flatMap((intent) => keys[intent].map((key) => ({ key, cmd: () => true })))
```

So with a `Modal` open, F6 is swallowed at tier 35 and Tab is not bound there at all. Tab falls to
the region layer at tier 5, `moveRegion(1)` runs, and `enter()` (`regions.ts:431`) puts focus on a
rail row behind the dialog. `enter()` does not schedule a settle, so the overlay hold in
`holdInOverlay` (`regions.ts:540`) never runs to pull it back. From then on every intent except
`dismiss` is swallowed. The dialog is on screen, a rail row has the caret, and nothing answers.

The footer makes it worse: `apps/tui/src/chrome/bindings.ts` reads `hostKeysFor()` too, so while
the modal is up it says `tab region`. The one key it advertises is the one that breaks the dialog.

**Cause 2, fixed at the baseline commit:** before that commit, `settleFocus` ran
`openScreen(); claimProvisional()` on every settle and only landed in the overlay once. Query
results arriving during boot each schedule a settle (`apps/tui/src/kit/showing.tsx:329`), so the
second one pulled focus back out onto the rail. The baseline's `holdInOverlay` early return closes
this. It does not close the Tab hole.

**Why at start specifically.** `apps/tui/src/chrome/Shell.tsx:80-83` opens the trust overlay from an
effect on `pendingTrust()`, unasked. It is the one dialog a reader meets before they have learned
any key, and it is the one dialog they cannot answer.

**Reproduce.** Render the shell with `pendingTrust` returning one request, press `TAB`, and assert
that the caret is still inside the modal. Today the caret leaves.

**The test that would have caught it.** `apps/tui/src/keys/keys.test.tsx:104` is the right test and
presses the wrong key: `frame.press('F6')`. Pressing `'TAB'` fails today. No test anywhere renders
the trust prompt on this host, and `reachability.test.tsx`'s `SURFACES` has no overlay in it.

## B. The rail looks selected after entering the terminal, but keys do nothing

**What the reader saw.** They moved into the terminal pane. Later the rail's menu shows a highlight
as if focused, but arrows and Enter do nothing there. Sometimes two things look focused at once.

**Cause 1, high confidence: the Tab hole from A, seen from the other side.** Once Tab has walked
focus out from under any trap (a `Modal`, or a `MenuList` at `apps/tui/src/kit/grouping.tsx:405`,
which also calls `trapKeys`), the rail row it lands on draws its caret
(`apps/tui/src/keys/collection.ts:92`) and its `Panel` lights (`apps/tui/src/panel.tsx:42`) while the
swallow layer at 35 eats `next`, `prev`, `activate`, `expand`, `collapse`, `first`, `last`, the
page intents, `nextPane` and `prevPane`. Tab and Shift+Tab keep working. The highlight moves and
nothing else responds.

**Cause 2, medium-high confidence: a rectangle stays entered when it is hidden.**
`apps/tui/src/kit/rectangle.tsx:146-166` registers a key intercept at priority 200 that, while
`inside()` is true, consumes every key and sends it to the PTY. `inside()` is cleared only by Escape
or by unmount. Two paths hide a rectangle without unmounting it: a `TabPanel` switching
(`grouping.tsx:275`, `visible={props.active === props.id}`) and the shell hiding the whole main row
behind an overlay (`Shell.tsx:205`, `visible={!topOverlay()}`). The trust prompt arriving, a
notification activating a task, or routing switching a pane while a PTY is entered leaves an
invisible rectangle consuming every keystroke in the app, while the store's caret sits visibly on
whatever is drawn. OpenTUI's `visible = false` blurs only the node itself, not a focused descendant,
so the renderer does not help here either.

**Cause 3, by design: `selected` is a second highlight.** The rail menu draws the current source
with `selected`, which is `role="match"` (`apps/tui/src/chrome/Rail.tsx:144`,
`kit/showing.tsx:166`), independently of focus. `reachability.test.tsx:66-71` knows it cannot tell
the two apart and excludes the lit-control half of the one-caret invariant on purpose.

**The structural fact under all three.** OpenTUI's `focus()` is a silent no-op when the node is not
`focusable` or is destroyed, and `blur()` is a silent no-op when the node is not `focusable`.
`regions.ts` writes the store signal beside the call, unconditionally:

```ts
// regions.ts:446-450, enter()
target.focus()          // may do nothing
setFocusedNode(target)  // always happens
```

`focusRenderable` (`regions.ts:221`) checks `isDestroyed` and `visible` but not `focusable`, then
returns `true`. And `apps/tui/src/keys/stops.ts:63` flips `box.focusable = !off()` when a control is
disabled, so a control disabled while focused can never be blurred: its `_focused` stays true and
every ancestor's `_hasFocusedDescendant` stays true for the rest of the run. That is two things
looking focused, literally.

**Reproduce.** Focus a PTY rectangle, press Enter to enter it, then switch the `TabPanel` it is in
from outside the keyboard (set the tab signal). Press `j`. Today the key goes to the hidden PTY.

**The test that would have caught it.** `keys.test.tsx:142` enters a PTY and presses keys, but never
hides it while entered. And no test asserts
`renderer.currentFocusedRenderable === focusedRenderable()` after a press. That one line would have
caught B and most of D.

## C. Left and Right mean different things in different places

**What the reader saw.** Sometimes Left goes to the rail. Sometimes it changes a tab. Sometimes it
does nothing at all, and Right does nothing from most of the main column.

**Cause, high confidence: one pair of keys, five owners at five tiers, two of which claim the key
and then do nothing.** `expand` is `['right', 'l']` and `collapse` is `['left', 'h']`
(`packages/client-core/src/kit/keys/keymap.ts:58-59`). Who answers depends on what the renderer has
focused:

| Tier | Owner | What it does | Where it goes wrong |
| --- | --- | --- | --- |
| 45 | `Tabs` strip, `mode: 'focus'` (`grouping.tsx:233-243`) | previous or next tab | `step()` returns `true` at an edge (`grouping.tsx:210`). Left on the first tab is a wall. |
| 41 | a `pressable` with `on: { expand, collapse }` (`SegmentedControl`, `DocumentTabs`, `Grid`) | moves its own value | fine |
| 40 | the collection (`collectionIntents.ts:111-120`) | horizontal list: move. Vertical list with `onExpand`: call it and return `true` | returns `true` on a leaf with nothing to expand. Key claimed, nothing happens. A list without `onExpand` bubbles. |
| 30 | `ListDetail` narrow mode (`layouts/ListDetail.tsx:54`) | switch group | wide mode bubbles |
| 5 | `moveColumn` (`install.ts:108-123`, `regions.ts:654`) | rail to main and back | refuses at both edges: Right anywhere in main and Left anywhere in the rail return `false` and nothing below claims them |

And one more that reads as a bug: every layout region is `column: 'main'`, because every
`regionFocus(ref, order)` call in `apps/tui/src/layouts/` passes no options and `regions.ts:175`
defaults the column. So in a `list-detail` pane, two frames literally side by side, Right does not
move from List to Detail. It returns `false` and does nothing. Left jumps past both to the rail.

**Reproduce.** Open the PR pane (a `list-detail`), focus the list, press `l`. Nothing. Press `h`.
The rail. Open the editor's file tree, focus a file, press `l`. Nothing, and the key is consumed.

**The test that would have caught it.** `reachability.test.tsx:81` checks the footer's *word* for
`h/l` but never presses them. `spatial.test.tsx` presses `l` on a `Sections` strip and
`Ctrl+Option+Right`, and nothing presses bare Left or Right on a tree row, a `list-detail` list, or
a tab-strip edge. A property of the form "for each focused kind, press `l` and assert what
`WORDS[kind].cross` promises" would fail today.

## D. Tab or Shift+Tab sometimes does nothing

Four paths, in descending likelihood:

1. **Inside an overlay.** Tab does move, to a region behind the modal, which from the reader's
   seat is "the dialog did not respond". This is A.
2. **Fewer than two regions on screen.** `moveRegion` returns `false` when `ordered().length < 2`
   (`regions.ts:641`). The rail hides on `ctrl+b`, the pane strip registers only while a task is
   active (`Shell.tsx:212-224`), and Browse registers no region without a list. A one-region screen
   has a dead Tab and nothing below tier 5 claims it. High confidence.
3. **The store moved and the renderer did not.** `enter()` lands the signal on a target whose
   `focus()` was refused, so the first Tab looks lost and a second one is needed. Medium confidence.
4. **Shift+Tab without the kitty protocol.** `main.tsx:128` asks for `useKittyKeyboard:
   { disambiguate: true }`. A terminal that does not negotiate it sends Shift+Tab as the legacy
   `ESC [ Z`, and nothing in `@opentui/core` 0.5.9 or `@opentui/keymap` normalises that to
   `shift+tab`. Both test harnesses force `kittyKeyboard: true` (`harness.tsx:136`,
   `kit/render.tsx:70`), so no test exercises the legacy encoding. Medium-low confidence: flagged for
   a manual check, not asserted.

**The test that would have caught it.** For 2, hide the rail with no task open and assert that Tab
still cycles or that the footer stops offering it. For 4, nothing in the repo can: it needs a hand
in a non-kitty terminal.

## E. Keyboard scrolling of long content is unreliable

Three separate causes, all readable from the code.

**E1, high confidence: `overflow="scroll"` is a clip, and five sites use it as a scroll.**
`apps/tui/src/kit/scrolling.tsx:11` states the rule: `overflow="scroll"` is a yoga clipping
instruction, and `scrollbox` is the renderable that owns an offset. Then five sites use the former
as if it were the latter, with no `ScrollBoxRenderable` ancestor:

- `apps/tui/src/layouts/ListDetail.tsx:76`, the List region of every `list-detail` pane.
- `apps/tui/src/kit/showing.tsx:574`, `Log`.
- `apps/tui/src/kit/showing.tsx:899`, `DiffPane`.
- `apps/tui/src/kit/grouping.tsx:564` and `:577`, `ListColumn` and `DetailColumn` with `scroll`.

`revealInViewports` (`regions.ts:315`) walks up looking for a `ScrollBoxRenderable` and finds none,
so the caret walks below the fold and nothing follows it. Of the nine `Rows` in the plugin tree,
only `plugins/github/src/client/PullList.tsx:176` passes `virtual`. The other eight have neither a
window of their own nor a viewport around them. The rail's Browse panel is `<Panel title="Browse"
grow>` with no `scroll` (`Rail.tsx:152`), so it has the same problem.

**E2, high confidence: page moves are modulo the list length.** The collection at tier 40 claims
`pageNext` and `pagePrev` before a viewport at tier 30 sees them, and moves by `PAGE = 10`
(`collectionIntents.ts:24, 109`) through `goTo(list[(at + delta + length) % length])`
(`collectionIntents.ts:99`). In a three-row list, PageDown moves one row. In a ten-row list it moves
nowhere, which is indistinguishable from a dead key. And in a list of any length inside a document
viewport, PageDown never scrolls the document, which contradicts the sentence the footer promises
("arrows move, page keys scroll").

**E3, medium-high confidence: reveal runs before layout, and nothing re-reveals afterwards.**
`scrollChildIntoView` reads the child's laid-out `y` and `height`. `revealInViewports` is called
synchronously from `noteFocus` and `enter`, inside the key handler, and the settle pass's
`revealFocus` runs on a microtask. For any row that did not exist in the previous frame (a region
entered on a fresh mount, a refetch replacing a row by identity, a virtual window shift) the
geometry is stale or zero, the delta is wrong, and there is no post-layout pass to correct it. The
already-laid-out case works, which is why `kit/scrolling.test.tsx` passes.

**Reproduce.** Open the context pane (a non-virtual `Rows` in a `list-detail`) at 40 by 12 and press
`j` twenty times. The caret leaves the screen. In any list of exactly ten rows press PageDown.

**The test that would have caught it.** `kit/scrolling.test.tsx` covers the three shapes that work:
a `Sections` panel, a document of buttons in a `HeaderBodyFooter` body, and a `virtual` `Rows`.
Missing: a non-virtual `Rows` longer than its List region, PageDown on a list shorter than ten rows,
and a reveal assertion immediately after a region is entered on a freshly mounted list.
`browseLong.test.tsx` looks like the covering test and is not: it exercises the one `virtual` list
and asserts the thumb glyph only `virtual` draws.

## What no test checks

- That renderer focus and store focus agree after a press.
- Any surface with an overlay open, and the trust prompt at all.
- Tab while a trap is up (`keys.test.tsx:104` presses F6).
- A rectangle hidden while entered.
- Bare Left or Right on a tree leaf, a `list-detail` list region, or a tab-strip edge.
- A non-virtual `Rows` past the fold. PageDown in a short list.
- Legacy (non-kitty) key encodings.

One environmental note. Every rendering test is `describe.skipIf(!hasFfi)` (`apps/tui/src/ffi.ts`).
On a Node below 26.4 the entire terminal suite reports green with zero rendering tests run. Check
the test count before trusting a green run on any of these symptoms.
[testing.md](./testing.md) § The floor has the detail.

## Verify before building

- `trap.ts` still reads `keysFor()` and `install.ts` still adds `tab` in `HOST_KEYS`.
- `regions.ts` `enter()` still writes `setFocusedNode` after an unchecked `focus()`.
- `rectangle.tsx` `inside()` is still cleared only by Escape or unmount.
- The five `overflow="scroll"` sites are still there: `grep -rn 'overflow="scroll"' apps/tui/src`.
- `collectionIntents.ts` `move()` is still modulo.
