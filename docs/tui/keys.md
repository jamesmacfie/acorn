# Terminal keys

This page covers how the terminal client routes a key press: the keymap adapter, and the five key
groups with what each does on each kind of focused thing. Read it before you bind a key in the
terminal client. It's part of [the terminal client](../tui.md).
[Focus and typing](../command-palette-and-shortcuts/focus-and-typing.md) owns the intents and the
layer tiers both hosts share.

## Keys and focus

The agent conversation keeps Mode, Model, and Effort on one compact row that wraps only when the pane
is too narrow. The terminal layout leaves out the permission selector and the transcript buttons.
Their actions are in the palette and on these shortcuts, which work while the message field has focus:

| Keys | Action |
| --- | --- |
| `Alt+U` and `Alt+D` | Scroll the transcript to the top or the bottom |
| `Alt+M` | Show only agent and user messages, or everything |
| `Alt+C` | Collapse every tool card |
| `Alt+E` | Expand or collapse the message box |

`?` opens the cheat sheet of active shortcuts. The desktop keeps its visible controls.

### The adapter

`apps/tui/src/keys/install.ts` builds the engine from `apps/tui/src/keys/keymapHost.ts`, this
package's own `KeymapHost`, where the desktop builds `createDefaultHtmlKeymap(root)`. All 13 members
answer over the node tree and the region store: the tree walk follows a node's `parent`, the key
stream is an emitter the input parser pushes onto, and `getFocusedTarget` and `onFocusChange` are the
store's one focus value and its signal. Three are absences: a node is never destroyed, so
`isTargetDestroyed` is false and `onTargetDestroy` never fires, and there's no raw input to prepend
to, because bytes become events first.

The engine is pure TypeScript, and the desktop drives the same one through
`packages/client-core/src/kit/keys/keymapHost.ts`, so the two adapters can't drift. A host owns the 13
answers, and the one that matters is where focus comes from ([focus](./focus.md#focus-regions)). The
kit's keymap host holds the engine at its widest type pair and hands each host its own pair back. One
host-supplied check crosses: "is somebody typing".

Chords are spelled with `ctrl` here. The engine reports the platform's primary modifier, `super` on
macOS, and a terminal emulator keeps Cmd, so `setKeymap` takes a `primary` and this host passes
`ctrl`.

A legacy terminal sends `\r` for Return with or without Ctrl, so `ctrl+return` never reaches the
engine. `apps/tui/src/input/terminal.ts` asks the terminal, on entry, for the kitty keyboard
protocol's `disambiguate` flag, along with the alternate screen, raw mode, SGR mouse reporting, DEC
1004 focus reporting, and bracketed paste. The flag also settles a lone Escape without a wait. A
terminal that doesn't know the request ignores it, and the mode is popped on exit. Both test harnesses
ask for the same protocol.

### The five key groups

Every key is an intent first (`packages/client-core/src/kit/keys/intents.ts`). Where an intent lands
depends on what has the keys. It bubbles: the innermost thing that can answer does, and a handler that
returns `false` passes it on.

| Group | Keys | In a collection | On a parent stop | On a plain stop | On a viewport with no stops | Bubbled to the region tier |
| --- | --- | --- | --- | --- | --- | --- |
| Move | `↓` `j` and `↑` `k` | Next or previous row, wrapping as `collectionIntents.ts` says | Down enters the panel the strip shows. Up goes to the previous stop. | Next or previous stop in reading order within the panel, revealed in every viewport around it. The bottom edge is a wall, and Up from a panel's first stop goes to its strip. | Scroll a fifth of a page | Nothing |
| Cross | `→` `l` and `←` `h` | `expand` or `collapse`, which a tree answers and a horizontal collection moves on. A plain list and a leaf bubble. | The next or previous tab. An edge bubbles. | Bubbles | Bubbles | One column left or right, landing on that column's last-used region, without wrapping. Inside a panel only the pane's own columns count. With none that way, the strip that owns the panel takes the key: the tab changes if it can, and the keys land on the strip. |
| Act | `⏎` `space` | Activate the row, then enter main where the region says so | Nothing | Press: `onPress`, a toggle, a `Select`'s list, an `Input`'s submit, or entering a rectangle | Nothing | Nothing |
| Back | `esc` | The parent stop if a panel holds the collection, else the region's home | The region's home | The parent stop, else the region's home | The region's home | Clear a notification, else climb as the shell's topology says |
| Page | `pgup` `pgdn` `home` `end` `g` `G` | `pagePrev`, `pageNext`, `first`, `last` on the collection | Scroll the viewport around it | Scroll the viewport around it | Scroll | Nothing |

`g` and `G` are `first` and `last` in the shared `intentKeys`, so a desktop list answers them too. The
vim sequence `g g` is refused: `g` already means `first`, so a prefix would put a timeout in front of a
key that answers at once, and the footer can't draw "g then g" in a cell.

A cross key has one meaning per level and one at the bottom. A handler that changed nothing returns
`false`, so the key carries on down: a tab strip at its last tab, a tree row that's a file, a list with
no fold. At the region tier, `h` and `l` mean a column move, so Left with nothing to the left goes one
column left from any control. The footer says `column` where that's what the key will do.

A panel is a level, and a bubbled cross key doesn't skip it. A key bubbling up from a control inside a
panel used to pass the strip and move a column, which sent you to the rail.
`crossParent` in `apps/tui/src/keys/regions.ts` is the missing level, and the region tier asks it
before moving a column. Inside a panel the pane's own columns still count, because Right on a file in
the editor's tree reaches the document beside it. The rail doesn't count, because Escape is the way
out of a pane. With no column that way, the strip takes the key, changes its tab if it can, and the
keys land on the strip. The footer says `column` inside a panel while the pane has a second column, and
`tab` where the strip answers. A dialog drawn inside a panel is outside the panel's scope, so neither
rule reaches the tab behind it.

Tab and Shift+Tab cycle every region on screen in declared order and wrap, and the pane chords cross
the column edge before they switch the pane ([navigation](./navigation.md)). Neither bubbles. Tab has
one exception inside a field ([typing](./typing.md#tab-in-a-field)).
