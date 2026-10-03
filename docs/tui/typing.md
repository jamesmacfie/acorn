# Terminal typing

This page covers what keys do while a text field has them in the terminal client, and how the typing
layer keeps bare keys with the field. It's part of [the terminal client](../tui.md).

## Fields

A `MentionTextarea` sends on a bare `⏎`, and `⇧⏎` is a newline, as the shared `onSubmit` prop says:
"Enter without a modifier. Absent leaves Enter as a newline." An open suggestion list takes the key
first and completes, as on the desktop. On a terminal that ignores the kitty keyboard protocol, both
keys send the same byte, so `⇧⏎` sends too and a newline has to be pasted.

`ctrl+⏎` is `commit` and submits the `Composer` or `Input` that has the keys. It's typing-exempt, so
it fires from inside the text. A `Composer`'s submit button is a plain stop that Tab reaches.

While an `Input` or `Textarea` has the keys, bare keys type. The move, cross, and page groups go
inactive, except `↑` and `↓` in a multi-line `Textarea`, which move the cursor. Escape leaves the field
for its parent stop or the region's home, which is how you leave a composer without sending. Tab,
Shift+Tab, `ctrl+⏎`, and the pane chords work from inside a field.

### Tab in a field

Tab in a field is the next control before it's the next region. The arrows type in a field, so
without this a field ended its panel's walk. On the pull request pane, the **Comment** button beside
the comment box and the review box below it couldn't be reached. So a field binds Tab and Shift+Tab to
the stop walk at its own tier, above the typing layer, and says whether it moved. At the panel's edge
it declines, and the region tier's Tab answers (`apps/tui/src/kit/asking/fieldRef.ts` § step). The
footer says `tab next` in a field and `tab region` elsewhere. This is the DOM's rule too: Tab is the
next control in a form.

### Arrows at a field's edge

A multi-line field answers Up and Down by moving the caret a row and says so. Where there's no row to
move to, it declines, and the stop walk takes over. So the agents pane's message box, between a
transcript and an action bar, isn't a wall: Up from its first line reaches the header above, and Down
from its last line leaves too.

## Typing is a layer

While a field has the keys, a layer at the `TYPING` tier binds the bare keys, and it's unregistered
when the field loses them (`apps/tui/src/keys/install.ts` § The typing shadow,
`apps/tui/src/keys/tiers.ts`). Its bindings claim the key so nothing below the tier answers, and
carry `preventDefault: false` so the key still reaches the field. It's a scope, like a `Modal`'s key
claim ([traps](./traps.md#traps)), except a scope is pushed by the box that's drawn, and the typing
layer follows the region store's focus signal.

The dispatcher hands the key to the field. `apps/tui/src/keys/install.ts` § typeInto is one listener
after the engine's: when no binding claimed the key and the focused node is a field, it calls that
node's `handleKeyPress` and claims the key. A field installs `handleKeyPress` from its own `ref`
(`apps/tui/src/kit/asking/fieldRef.ts`), and the edit model behind it reads the key and nothing else.

It's a layer because of a cache. `@opentui/keymap` 0.5.9 caches "what's live now" only while no
registered layer, command, or binding carries a runtime check, and that counter is global. The footer
asks that question on every render ([the footer](./footer.md#the-footer)). With a check on every bare
key, 48 bindings disabled the cache on a browse screen. Now none do. The command layer follows the same
rule: its bindings are filtered when they're built, not checked when they fire
(`apps/tui/src/keys/commandLayer.ts`).

The tier sits between the collection's 40 and a stop's 42. Everything at or below it reaches a focused
field from somewhere else: the collection around it, a viewport's page keys, the screen's column moves,
and the command layer's bare keys. Each has to go quiet while you type. The two tiers above are bound
by focus to an exact node, and a field is never that node, with two exceptions that want their key
while you type: the suggestions list under a `MentionTextarea`, and the Down and Escape that leave a
descriptor source's filter field. A `MenuList` keeps its arrows below the collection on purpose, so it
registers a second pair above the typing layer while a field inside it has the keys.
