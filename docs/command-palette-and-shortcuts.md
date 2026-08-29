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
separate registry (`registries/contextMenus.ts`) because a command is global and a menu row is about
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
`client-core/keys/install.ts`. Its HTML adapter turns DOM keydowns into keymap events and tracks
targets with a `MutationObserver`; the same package carries a terminal adapter, which is what keeps a
terminal renderer a matter of swapping the adapter rather than rewriting the keyboard.

**Keys become intents before a component sees one.** The closed set is in
`client-core/keys/intents.ts`: `next`, `prev`, `first`, `last`, `pageNext`, `pagePrev`, `expand`,
`collapse`, `activate`, `dismiss`, `commit`, `search`, `menu`, `delete`, and the four region and pane
moves. `client-core/keys/keymap.ts` maps this host's keys onto them, and it is the only file that
knows a platform difference: `commit` is Cmd+Enter on macOS and Ctrl+Enter everywhere else, and
nothing else changes between the two. A kit node handles intents. A plugin receives `onSelect`,
`onActivate` and the rest, and never a key event, outside `Input`, `Textarea`, `Composer` and the
inside of a rectangle.

An unhandled intent bubbles. A binding whose handler returns `false` is not handled, so the engine
carries on to the next layer: the focused collection answers, or an ancestor does, or the region
layer does, or nothing does.

**Focus is a property of the tree.** Each kit node has a fixed focus role
(`client-core/ui/kit/focusRoles.ts`), and a plugin sets none of it: stops, collections with roving
focus, items inside a collection, and the two traps. Every layout region is a focus group. F6 and
Shift+F6 move between the regions of a pane, Ctrl+Option+Right and Ctrl+Option+Left move between
panes, and each group remembers the node focus was last on, so coming back lands where you left.
`client-core/keys/regions.ts` holds that, writes `focusedPane`, and emits `runtime:focus-changed`
with the task, pane and region.

**Collection state is the host's.** A run of `Row`s inside a `Rows`, a tab strip, a menu, a chip row,
a segmented control, a timeline and a grid are all one collection with roving focus inside, and the
arrows, Home, End, the page keys and type-ahead come from `client-core/keys/collection.ts` rather
than from the pane. `active` and `selected` live in the host's store keyed by the item's own key
([state.md](./state.md)), so a refetch keeps your place.

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
`ui/dismissable.ts` keeps a stack of them so a pile unwinds one press at a time, so an `escape`
binding goes inactive while focus is inside a dialog. Consuming the key in the engine would stop the
DOM event too, and the overlay would never see it.

**The cheat sheet** (`client-core/keys/CheatSheet.tsx`, Cmd+/) lists what the keyboard will do right
here, read from the engine's own catalog rather than from the keybinding registry. `getActiveKeys`
answers for the layers that are live against the element that has focus, so a chord a pane shadows
shows the pane's meaning and a chord whose command is unavailable does not appear.

A sandboxed plugin frame has its own document, so its SDK normalizes and forwards unclaimed keydowns
over the existing rate-limited bridge. The host resolves them against the same binding table,
preferring that frame's surface binding before global or task bindings. This keeps shell chords
working while a frame is focused without adding another shell listener.

A frame may keep only the modified chords declared in its manifest `claimsKeys`. Runtime
`acorn.keys.claim()` may narrow that set, never extend it. Claims are visible in Shortcuts and in the
trust prompt. The palette (`meta+k`), settings (`meta+,`), task switching (`meta+1`-`meta+9`) and
`escape` are reserved and cannot be claimed. Bare typing inside a frame remains local.
