# Refused: what was considered and set aside, with the argument

Part of [docs/future/before-terminal-ui/](./README.md).

## Keeping Monaco for the document surface

Replacing only the editor plugin's instance was the smaller first step, and it was refused because
it buys nothing: `monaco-editor` stays in `packages/client-core`, the worker boot wiring stays, and
the app ships two editor stacks. The document surface's extras — one completion provider, one
keybinding hook — are the parts CodeMirror's packages cover most directly. If the migration stalls,
it stalls with one editor everywhere rather than pausing halfway on purpose.

## `onPress` on `Text` instead of a `Link` node

Fewer names in the kit, and refused by the owner: `Text` is presentational, and a press handler on
it makes every piece of text in the vocabulary potentially interactive, which breaks the
one-intent-per-node rule the closed kit is built on. A reader of a tree should know from the node
name what can happen; "this text acts" is `Link`'s sentence, not a `Text` prop.

## A path-based attachment upload

Have `pickFiles` return paths and add a node route that reads them — less data over the bridge, and
refused because it is wrong on the deployment the product is built around: the client and the node
are not always the same machine, and the file being attached lives with the person, not the node. A
node reading client-named paths is also a capability the trust model would have to account for.
Bytes cross the seam, the existing upload route stays the only write path, and the composer's caps
bound the transfer.

## Redesigning the pricing page to avoid growing the kit

The pricing tables could become `Rows` of `Field`s and the kit would not need table rows. Refused:
three callers write raw row markup today, so the vocabulary gap is real beyond this one page, and a
form that loses column alignment loses the thing a pricing grid is for — scanning four numbers
across models. The kit grows through its admission conditions; this is what they are for.

## Deleting or fallback-rendering the preview pane

Neither hiding preview everywhere nor giving it a terminal fallback UI. The pane is the right shape
on a host with a webview, and on any other host the honest rendering of "a page" is absence — the
same decision the terminal programme took for rectangles generally. The fix is the gate asking the
right question, not the pane pretending it has a second form.

## A form node for Enter-to-submit

Dropping the raw `<form>`s loses Enter-to-submit from a focused field, and the tempting fix is a kit
`Form` node. Refused for now: two settings pages are the only callers, both have a visible submit
button, and a node whose whole meaning is a keyboard affordance is thin. If a third form-shaped
surface appears, that is the admission argument, and the door is noted in phase 0.

## Extending the purity rule beyond the plugin tier

Running the raw-DOM scan over `packages/client-core/src/features` too. Refused: core chrome is host
code — the settings modal, the rail, the topbar draw DOM because something has to. The tree
contract's promise is about plugins, and a rule that lumps the host in with the tier it hosts would
either carry a permanent baseline or force kit-ification of chrome the terminal redraws natively
anyway.
