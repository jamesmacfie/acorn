# Focus and typing

This page covers the keymap engine both hosts share, the intents a key becomes, the typing rule,
focus regions, collections, and how scopes become layers. Read it before you bind a key or give a
component focus behavior. It's part of
[command palette and shortcuts](../command-palette-and-shortcuts.md). The terminal client's own
mechanism is in [the terminal client](../tui.md).

## Focus and typing

The keyboard is one engine, `@opentui/keymap`, installed on the shell root by
`packages/client-core/src/host/keys/install.ts`. Its HTML adapter turns DOM key presses into keymap
events and tracks targets with a `MutationObserver`. The terminal client writes its own
`KeymapHost`, all 13 members, over its node tree and region store, and drives the same engine. So it
gets the same layer model, the same `intentKeys` table, and the same bubbling. It needs more
priorities than the desktop, because it draws the whole workspace in one window and an entered
terminal has to sit above all of them. `apps/tui/src/keys/tiers.ts` lists all 11, with a sentence
each.

`packages/client-core/src/kit/keys/keymapHost.ts` names neither host's target type. Each host
supplies its own at `setKeymap`, with its answer to "is somebody typing right now", which is the only
question a binding asks about the focused thing.

There's one engine, one command catalog, and one adapter per host. No plugin and no first-party pane
installs its own key handler, except inside an input or a rectangle. A pane that wants a chord
registers a command and a binding, which puts it in Settings → Keyboard shortcuts, the palette, and
the cheat sheet at once. A handler beside the engine reaches none of them and can't be rebound or
shown in a conflict.

A replacement `pane.switcher` receives the resolved shortcut labels and calls host-owned layout
verbs. The host keeps F6 region navigation and the Cmd+1 through Cmd+9 pane selection, so changing the
switcher doesn't change the keyboard.

## Intents

Keys become intents before a component sees them. The fixed set is in
`packages/client-core/src/kit/keys/intents.ts`: `next`, `prev`, `first`, `last`, `pageNext`,
`pagePrev`, `expand`, `collapse`, `activate`, `dismiss`, `commit`, `maximize`, `search`, `menu`, `delete`, and
the four region and pane moves. `packages/client-core/src/kit/keys/keymap.ts` maps the desktop's keys
onto them, and it's the only file that knows a platform difference: `commit` is Cmd+Enter on macOS and
Ctrl+Enter elsewhere. `maximize` adds Shift to that chord. A textarea with `onToggleExpand` handles
it in a focused field layer, ahead of the shell's pane-maximize binding.

The host picks the modifier, not the platform. A terminal emulator keeps Cmd and never delivers it,
so the terminal client passes `ctrl` to `setKeymap`, and every chord in the table and in its shell is
spelled with Ctrl there. A kit node handles intents. A plugin receives `onSelect`, `onActivate`, and
the rest, never a key event, except in `Input`, `Textarea`, `Composer`, and inside a rectangle.

An unhandled intent bubbles. A binding whose handler returns `false` isn't handled, so the engine
moves to the next layer: the focused collection, an ancestor, the region layer, or nothing.

A handler that changed nothing says so. `onExpand` on a `Rows` can return `false` to say the row
didn't fold, for a leaf or a list with nothing to open, and hand the key back. In the terminal, the
tier below moves one column, which is how Right on a file in the editor's tree reaches the document
beside it ([terminal keys](../tui/keys.md) § The five key groups). Returning nothing
claims the key. The editor's file tree opts in (`plugins/editor/src/client/FileTree.tsx`).

## Modal surfaces

A modal surface holds the keyboard. The region and pane moves do nothing while focus is inside an
`aria-modal` element, because the regions are behind it. Settings is modal and covers the window, so
the shell also passes `taskActive: false` to the dispatcher while it's open. No task or pane chord
acts on a view you can't see, and no key typed in Settings reaches a terminal underneath
([frontend](../frontend/settings.md) § Settings).

## Typing targets

A bare key belongs to whoever is typing, and a chord doesn't. While a text field has focus, a binding
fires only if its chord has a command modifier: meta, ctrl, or alt. Nobody types Cmd+Enter into a
message, so the changes pane's commit chord works from its message field, and every bare key stays
with the field. `typing-exempt` is the scope a bare-key binding declares to fire while typing.

The sandboxed-frame SDK draws the same line: it forwards a modified chord out of a frame's own input
and keeps a bare key (`packages/client-core/src/host/frames/sdk/bridgePort.ts`). The terminal's
command layer hides bare keys while a field has them and lets chords through at every depth
(`apps/tui/src/keys/commandLayer.ts`). Escape isn't a chord. An open overlay answers its own Escape,
before any of this.

## Focus regions

Focus follows the tree. Each kit node has a fixed focus role
(`packages/client-core/src/kit/tokens/focusRoles.ts`), and a plugin sets none of it: stops,
collections with roving focus, items inside a collection, and the two traps. Every layout region is a
focus group. F6 and Shift+F6 move between the regions of a pane. Ctrl+Option+Right and
Ctrl+Option+Left move between panes. Each group remembers the item focus was last on, so coming back
lands where you left. `packages/client-core/src/host/keys/focusRegions.ts` holds this, writes
`focusedPane`, and emits `runtime:focus-changed` with the task, pane, and region.

The terminal keeps the contract and replaces the mechanism.
[Terminal focus](../tui/focus.md) owns how: five levels, five key groups, a topology the
shell installs, a dialog as a scope, one landing rule, and 11 invariants with the test that checks
each. Tab is `nextRegion` there, beside F6, because a terminal doesn't reserve Tab and a reader
presses it first.

## Collections

Collection state belongs to the host. A run of `Row`s inside a `Rows`, a tab strip, a menu, a chip
row, a segmented control, a timeline, and a grid are each one collection with roving focus inside.
The arrows, Home, End, `g` and `G`, the page keys, and type-ahead come from
`packages/client-core/src/kit/keys/collectionIntents.ts`, not from the pane. `active` and `selected`
live in the host's store, keyed by the item's own key ([state ownership](../state-ownership.md)), so
a refetch keeps your place.

`collectionIntents.ts` holds the rules about a list: what wraps, where the first press lands, whether
select or activate picks, and how far a page key moves. Each host supplies two things: putting focus
on an item, and saying whether the item itself holds focus or a control inside it does.
`packages/client-core/src/kit/keys/collection.ts` is the DOM's half: `focus()`, `scrollIntoView`,
the `aria-*` attributes, and the roving `tabindex`. `apps/tui/src/keys/collection.ts` is the
terminal's. Non-virtual documents use a `ScrollViewport`, which owns the offset. A virtual `Rows`
keeps its own window, so the wheel can move the view without changing the active key, and a keyboard
move reveals that key again.

Three nodes differ:

- `Grid` is virtualized, so most rows have no element and roving focus can't be DOM focus. The
  arrows move a `selected` index the caller owns and scroll it into view. The intents and the single
  tab stop match every other collection.
- `Timeline` in the terminal drops the tab stop. A turn is a `Card`, and a card is a stop only where
  it takes an `onPress`, so a conversation's stops are the controls inside its turns. The desktop
  roves over turns.
- `DiffPane` and `KeyValueEditor` aren't collections. A diff is scrolling text whose comment control
  and toolbar are ordinary stops, and finding a line is the `search` intent. A key-value grid makes
  every cell a stop, as `Table` does.

## Scopes are layers

The four `KeybindingScope` values map onto the engine's layers. Priority decides which one wins, not
how local a layer is:

| `KeybindingScope` | Layer | Target | Priority |
| --- | --- | --- | --- |
| `global` | Global | The root | 0 |
| `task` | Global, gated on an open task | The root | 0 |
| `pane` | Global, gated on the focused pane | The root | 0 |
| `typing-exempt` | Global, gated off typing targets | The root | 0 |

Scope belongs to a binding, not a layer, so all four register together and each binding carries a
check for its scope: an open task for `task`, the focused pane for `pane`, and not a text field for
everything but `global`. The layers that take an element belong to a rectangle of the tree: a `tabs`
pane's Cmd+1 through Cmd+9 at priority 30, above the global task-switching chord, and a collection's
intents at priority 40. Both are `focus-within`, so they're live only while focus is inside.

Solid can mount lazy or suspended content in a detached subtree before committing it. An
element-bound layer waits for its target to join the document, and cancels the wait if its owner
unmounts first. So a staged pane neither registers against a destroyed target nor loses its keys when
it shows.

Escape is the exception the engine can't express. An open overlay answers its own Escape, and
`packages/client-core/src/kit/lib/controls/dismissable.ts` keeps a stack of overlays so a pile closes
one press at a time. An `escape` binding goes inactive while focus is inside a dialog, because
consuming the key in the engine would stop the DOM event and the overlay would never see it.

## Overlays and rectangles in the terminal

In the terminal, an overlay and a rectangle each own the keys outright. There's no backdrop to click
through, so a `Modal` or an open `Menu` is a scope. Its box goes on the region store's scope stack
while it's drawn, and every question the store answers is answered inside it. One layer goes with it:
`dismiss`, above everything ([terminal dialogs and rectangles](../tui/traps.md) § Traps).

An entered `pty` rectangle takes every key before dispatch, Ctrl+C included. Escape leaves the
rectangle, and pressing it twice goes back in and sends one Escape through, which is how you reach
vim's normal mode. A rectangle is entered while its box has the keys, is on screen, and has had Enter
pressed since it last lost them. So a rectangle hidden by a tab switch stops taking keys when it goes
off screen ([terminal dialogs and rectangles](../tui/traps.md) § The Rectangle contract).

## The cheat sheet

The cheat sheet (`packages/client-core/src/host/keys/CheatSheet.tsx`, Cmd+/) lists what the keyboard
does here. It reads the engine's own catalog, not the keybinding registry. `getActiveKeys` answers
for the layers live on the focused element, so a chord a pane shadows shows the pane's meaning, and a
chord whose command is unavailable doesn't appear.

The terminal's footer is the same list on one line. `apps/tui/src/chrome/bindings.ts` reads
`getActiveKeys` too and gives each live intent a word. The footer prints as many as fit, and the
cheat sheet on `?` prints all of them. Nothing is declared twice. [Terminal
footer](../tui/footer.md) § The footer owns the table of words.
