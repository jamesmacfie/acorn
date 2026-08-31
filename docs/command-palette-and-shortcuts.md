# Command palette and shortcuts

Keyboard commands are registered by the shell and feature contributions. `CommandPalette.tsx`
combines static actions, plugin palette rows, task/workspace rows, and Node-aware aggregate results.
It imports no feature implementation.

## Global commands

| Shortcut | Action |
| --- | --- |
| `⌘K` | Open command palette |
| `⌘P` | Open worktree file finder |
| `⌘L` | Open workspace switcher |
| `⌘⇧N` | Create a local task |
| `⌘⇧T` | Toggle terminal drawer |
| `⌘1`–`⌘9` | Activate the corresponding visible task |
| `⌘,` | Open Settings |
| `Shift+F10` / menu key | Open the context menu for the focused row (the platform fires `contextmenu`; the shell does not bind this itself) |
| `Escape` | Close the topmost overlay or cancel the current action |

The exact platform modifier is handled by the keyboard layer. Inputs, editors, terminals, and
contenteditable elements stop global commands unless a command explicitly opts into text handling.

## Palette data

Palette rows can be static or task/Node-backed. Fleet rows carry a Node label and tolerate partial
availability. A row action targets the Node that owns its resource; no aggregate action pretends to
be cross-Node atomic.

Run targets and workflow rows are contributed from the Node's task configuration. Pane and source
commands are registered by their owning plugin. A loaded plugin's manifest `commands` descriptors are
promoted into the same command registry: one command supplies both its optional palette row and any
keybinding target. The legacy manifest `palette` array is a compatibility alias for a command with
`palette: true`; it never produces a second row.

Context-menu rows share the commands' ceiling without sharing their registry. A menu row is a label, an
order, a predicate over what is under the cursor, and one verb from the same closed context-free set a
command takes — so a right-click can do exactly what a command can do and nothing more. They stay a
separate registry (`registries/panes/contextMenus.ts`) because a command is global and a menu row is about
one thing: the row needs a target and a predicate over it, and neither has any meaning in the palette.
Core's own row actions register there too, which is what keeps the contract honest — see
`docs/ui-design.md § Menus and right-click`.

User-configured shortcuts outrank defaults. Among defaults, first-party bindings win, then loaded
plugins in lockfile installation order with plugin id as the stable tiebreak. A losing binding is
unbound and named as a conflict; no fallback chord is invented.

## Pane shortcuts

The shipped pane chords are contribution-owned and tested with the pane registry. Settings →
Shortcuts can override or unbind them. Persisted pane IDs remain stable because they are layout data.

A pane chord is a binding gated on the focused pane, not a layer of its own. What a pane's *layout*
binds is: a `tabs` pane registers Cmd+1 through Cmd+9 as a `focus-within` layer on its own element,
which shadows the global task-switching chords while focus is in that pane and hands them back the
moment focus leaves.

## Plugin shortcuts

Loaded plugins declare canonical `meta+ctrl+alt+shift+key` chords against commands from their own
manifest. The host qualifies both ids as `plugin.<plugin-id>.<command-id>`, refuses bare keys and
does not expose `typing-exempt`. A `surface` binding is host-bound to a surface declared by that same
manifest.

Settings → Shortcuts shows plugin bindings under the plugin id and names the active Node because
shortcut preferences are per Node, per user. Disabled-plugin rows remain visible, inert and editable;
plugins absent from the active Node do not appear. Uninstalling never deletes overrides, so reinstalling
restores them. The explicit orphan-cleanup action is the only path that removes settings for plugins
which are no longer installed. Reset operates per section and Unbind persists an explicit `null`.

Binding ids are persistence keys. Plugin authors must keep command ids stable across versions or a
renamed command will no longer find the user's override.

Resolution happens before the engine sees anything. `resolveKeybindings` applies the user's
overrides, the first-party-then-lockfile order, and the conflict rule, and hands the engine one
binding per resolved chord. A losing binding arrives with a null chord and registers nothing, which
is why Settings can show it as a conflict while the keyboard behaves as if it were not there.

## Focus and typing

The keyboard is one engine, `@opentui/keymap`, installed on the shell root by
`client-core/host/keys/install.ts`. Its HTML adapter turns DOM keydowns into keymap events and tracks
targets with a `MutationObserver`. The same package carries a terminal adapter, and the terminal
client uses it: `apps/tui/src/keys/install.ts` builds `createDefaultOpenTuiKeymap(renderer)` and gets
the same four tiers, the same `intentKeys` table and the same bubbling. What differs is the pair of
type parameters — a target is an OpenTUI `Renderable` there and an `HTMLElement` here — so
`client-core/kit/keys/keymapHost.ts` names neither: the host supplies its pair at `setKeymap`, along
with its own answer to "is somebody typing right now", which is the only question a binding asks
about the focused thing.

**There is no second keymap, and there will not be.** One engine, one command catalog, one adapter per
host. No plugin and no first-party pane installs a key handler of its own outside an input and the
inside of a rectangle. A pane that wants a chord registers a command and a binding, which is how it
reaches Settings → Shortcuts, the palette, and the cheat sheet at once; a handler installed beside the
engine reaches none of them and cannot be rebound, overridden, or shown to the reader in a conflict.

**Keys become intents before a component sees one.** The closed set is in
`client-core/kit/keys/intents.ts`: `next`, `prev`, `first`, `last`, `pageNext`, `pagePrev`, `expand`,
`collapse`, `activate`, `dismiss`, `commit`, `search`, `menu`, `delete`, and the four region and pane
moves. `client-core/kit/keys/keymap.ts` maps this host's keys onto them, and it is the only file that
knows a platform difference: `commit` is Cmd+Enter on macOS and Ctrl+Enter everywhere else, and
nothing else changes between the two. Which of the two a host gets is the host's answer and not the
platform's, because a terminal emulator keeps Cmd for itself and never delivers it — so the terminal
passes `ctrl` to `setKeymap` and every chord in the table, and every chord its shell registers,
is spelled with Ctrl there. A kit node handles intents. A plugin receives `onSelect`,
`onActivate` and the rest, and never a key event, outside `Input`, `Textarea`, `Composer` and the
inside of a rectangle.

An unhandled intent bubbles. A binding whose handler returns `false` is not handled, so the engine
carries on to the next layer: the focused collection answers, or an ancestor does, or the region
layer does, or nothing does.

**Focus is a property of the tree.** Each kit node has a fixed focus role
(`client-core/kit/tokens/focusRoles.ts`), and a plugin sets none of it: stops, collections with roving
focus, items inside a collection, and the two traps. Every layout region is a focus group. F6 and
Shift+F6 move between the regions of a pane, Ctrl+Option+Right and Ctrl+Option+Left move between
panes, and each group remembers the node focus was last on, so coming back lands where you left.
`client-core/host/keys/focusRegions.ts` holds that, writes `focusedPane`, and emits `runtime:focus-changed`
with the task, pane and region.

The terminal keeps the contract and replaces the mechanism, in `apps/tui/src/keys/regions.ts`: a
layout registers each region with the order it draws it rather than having it derived from document
position, a region's first stop is found by walking the retained renderable tree, and focus is the
renderer's. Two rules are the terminal's own, and both are about a host with no pointer. A pane opens
with the keys already somewhere, because there is no click to put them there. And a region opens on
its list where it has one, rather than on the first field above it: on the desktop a reader clicks
what they meant, and here the first thing focused is the thing the bare keys drive, so landing in a
filter box would mean `j` types a `j`.

Two more are the terminal's own and both come from drawing one pane. The cycle is the whole screen
rather than the focused pane — rail, pane strip, the pane's own regions, and back — because there is no
second pane to be surprised by, and the chrome joins it by declaring orders outside the range a layout
uses. And Tab is `nextRegion` there, beside F6: the browser owns Tab and a terminal does not, and a
reader in one presses it first. The intent is the shared one and `intentKeys` is still the table; a
host adding a key to an intent it already has is what a per-host key table is for.

**Collection state is the host's.** A run of `Row`s inside a `Rows`, a tab strip, a menu, a chip row,
a segmented control, a timeline and a grid are all one collection with roving focus inside, and the
arrows, Home, End, the page keys and type-ahead come from `client-core/kit/keys/collectionIntents.ts`
rather than from the pane. `active` and `selected` live in the host's store keyed by the item's own
key ([state-ownership.md](./state-ownership.md)), so a refetch keeps your place.

That file is the rules about a *list*: what wraps, where the first press lands, which of select and
activate picks, what a page key moves by. Each host supplies two things and nothing else — put focus
on an item, and say whether the item itself holds focus rather than a control inside it.
`collection.ts` beside it is the DOM's half: `focus()`, `scrollIntoView`, the `aria-*` attributes and
the roving `tabindex`. `apps/tui/src/keys/collection.ts` is the terminal's, where a row hands its
renderable back as it draws and the caret is drawn wherever focus is.

`Grid` is the one documented exception, and it is a consequence of virtualisation rather than a
shortcut. Most of its rows have no element, so roving focus cannot be DOM focus: the arrows move a
`selected` index the caller owns and scroll it into view. The intents and the single tab stop are the
same as every other collection's, which is the part the role promises; where the place is kept is not.

`DiffPane` and `KeyValueEditor` are not collections at all, and the focus table says so. A diff is a
scroller of text whose focusable parts — the per-line comment control, the toolbar — are ordinary stops,
and finding a line is the `search` intent rather than a rove. A key-value grid is every cell a stop
already, the same answer `Table` gives.

**Scopes are layers.** The four `KeybindingScope` values map onto the engine's model, and priority is
what decides which one wins, not how local a layer is:

| `KeybindingScope` | Layer | Target | Priority |
| --- | --- | --- | --- |
| `global` | global | the root | 0 |
| `task` | global, gated on an open task | the root | 0 |
| `pane` | global, gated on the focused pane | the root | 0 |
| `typing-exempt` | global, gated off typing targets | the root | 0 |

Scope is a property of one binding rather than of a layer, so all four register together and each
binding carries a matcher that reproduces its scope: an open task for `task`, the focused pane for
`pane`, and off a text field for everything but `global`. The layers that do take an element are the
ones a rectangle of the tree owns: a `tabs` pane's Cmd+1 through Cmd+9 at priority 30, above the
global chord that switches tasks, and a collection's intents at priority 40. Both are `focus-within`,
so they are live only while focus is inside them.

Escape is the exception the engine cannot express. An open overlay answers its own Escape, and
`kit/lib/dismissable.ts` keeps a stack of them so a pile unwinds one press at a time, so an `escape`
binding goes inactive while focus is inside a dialog. Consuming the key in the engine would stop the
DOM event too, and the overlay would never see it.

**In a terminal, an overlay and a rectangle each own the keys outright**, and these are the two places
the terminal's keyboard is not the desktop's. There is no scrim to click through and no window to
click outside of, so a `Modal` or an open `Menu` takes two layers: `dismiss` above everything, and a
swallow of every other intent above a pane's own layer and below a collection's. The swallow sits
below the collection tier on purpose — priority decides, not locality, so a swallow at the trap's own
tier would eat Enter before a list drawn inside the modal could answer it, and a collection behind the
overlay cannot fire anyway, because the overlay took the focus. An entered `pty` rectangle takes every
key before dispatch, `Ctrl+C` included, which is the point of entering one. Escape alone leaves a
rectangle; pressing it twice goes back in and sends one through, which is how a reader reaches vim's
normal mode from in there.

**The cheat sheet** (`client-core/host/keys/CheatSheet.tsx`, Cmd+/) lists what the keyboard will do right
here, read from the engine's own catalog rather than from the keybinding registry. `getActiveKeys`
answers for the layers that are live against the element that has focus, so a chord a pane shadows
shows the pane's meaning and a chord whose command is unavailable does not appear.

**The terminal's footer is the same list, one line long.** `apps/tui/src/chrome/bindings.ts` reads
`getActiveKeys` too, gives each live intent a word, and the footer prints as many as fit while the
cheat sheet on `?` prints all of them. Nothing is declared twice. `getActiveKeys` is a snapshot with
no signal behind it, so the list also reads the two signals that move the active layers — where the
keys are, and whether an overlay has taken them — or the footer would be whatever was true at the
render that happened to build it. While a rectangle is entered the footer says `esc leave · esc esc
send escape` instead, because every other hint is false in there.

A sandboxed plugin frame has its own document, so its SDK normalizes and forwards unclaimed keydowns
over the existing rate-limited bridge. The host resolves them against the same binding table,
preferring that frame's surface binding before global or task bindings. This keeps shell chords
working while a frame is focused without adding another shell listener.

A frame may keep only the modified chords declared in its manifest `claimsKeys`. Runtime
`acorn.keys.claim()` may narrow that set, never extend it. Claims are visible in Shortcuts and in the
trust prompt. The palette (`meta+k`), settings (`meta+,`), task switching (`meta+1`-`meta+9`) and
`escape` are reserved and cannot be claimed. Bare typing inside a frame remains local.
