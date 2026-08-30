# Keys and focus without a DOM

## What is already host-agnostic

The keymap engine is `@opentui/keymap`, adopted in layout phase 2, and acorn adds no key handling
outside `packages/client-core/src/host/keys/`. Inside that folder, three files never mention the DOM:

- `intents.ts`: the eighteen intents (`next`, `prev`, `activate`, `select`, `search`, `dismiss`, and
  the rest) plus the typing exemptions. Nodes handle intents, never keys. Its header says a terminal
  renderer teaches `j` and `k` in one table rather than in every component; this is that table.
- `keymap.ts`: chord spelling translation, `intentKeys(primary)` as the one per-host key table, and
  `BARE_KEYS`.
- `collection.ts`, the intent half: `next`, `prev`, `first`, `last`, `pageUp`, `pageDown`, `select`,
  `activate` against a host-owned store of `active`, `selected`, and `offset` keyed by the item's own
  key (`docs/state-ownership.md`). Type-ahead is a raw key by design and stays one on both hosts.

The four layer tiers hold on the TUI unchanged (`install.ts`: command layer at 0, region and pane
chords at 5, pane layer at 30, collection intents at 40). Priority decides, not locality.

## The adapter

`install.ts` builds `createDefaultHtmlKeymap(root)` from `@opentui/keymap/html`. The same package
exports `createDefaultOpenTuiKeymap(renderer)` from `@opentui/keymap/opentui`, typed
`Keymap<Renderable, KeyEvent>` where the DOM one is `Keymap<HTMLElement, HtmlKeymapEvent>`. The
swap is the seam `install.ts` names in its own header ("its terminal adapter, which we do not use
yet, is in the same package").

`keys/host.ts` holds the keymap singleton and is typed to the DOM. It becomes generic over the two
type parameters, with each host package supplying its pair at install. `isTerminalTarget` there asks
`.closest('.ui-rect[data-kind="pty"]')`; its TUI sibling asks the focused renderable whether it is a
PTY region. Same question, same caller, the kit's own rectangle so a plugin cannot opt out.

## Focus regions

`keys/regions.ts` is the file that needs the most work, and the only one. It orders regions by
`compareDocumentPosition`, finds a region's first stop with `querySelector`, focuses with
`element.focus()`, and listens to `focusin` and `pointerdown`. None of that exists in a terminal.

The TUI's `regions.ts` keeps the contract and replaces the mechanism:

- A region is registered by a layout with its id and its order, from the layout's own knowledge of its
  regions (`LAYOUT_REGIONS` in `packages/protocol/src/paneLayouts.ts`), not derived from position.
- A region's first stop is the first renderable in its subtree whose focus role
  (`ui/kit/focusRoles.ts`) is `stop`, `item`, `collection`, or `trap`. The walk is over OpenTUI's
  renderable tree, which is retained and ordered.
- Focus is OpenTUI's focus. There is one focused renderable at a time and the renderer owns it.
- The pointer half is absent. Mouse support in the terminal, if it comes, clicks to focus and does
  nothing else; it is not a phase in this folder.

The region chords (`layers at 5`) and the `regionFocus` behaviour a layout gets today through the
`use:regionFocus` directive become a helper each TUI layout calls in its setup, because there is no
directive mechanism outside the DOM renderer.

## Collections

`collection.ts` splits at the line where it stops handling an intent and starts touching an element:
`elements.get(key).focus()`, `scrollIntoView`, the `aria-*` and `tabindex` getters. The intent half
becomes a shared module both hosts import; the element half has a DOM file and a TUI file. On the TUI,
"focus the active item" sets the renderer's focus to the item's renderable and "scroll into view" moves
the collection's `offset` so the row is inside the visible rows. `Grid` keeps its documented
exception: virtualised rows have no renderable, so the arrows move `selected` and the view follows.

## Traps

`keys/trap.ts` contains Tab inside a modal by walking focusable DOM elements. It is not ported. On the
TUI a `Modal` or `Menu` traps by owning the key layer while it is open: it pushes a layer above the pane
layer that answers `next`, `prev`, `dismiss`, and swallows the rest. That is what a terminal modal is,
and it is the same thing the overlay stack in [07-chrome.md](./07-chrome.md) does for the palette.

## The Rectangle contract

A rectangle is one tab stop from outside. Enter hands the keys to whatever is inside, Escape takes them
back (`packages/client-core/src/kit/components/Rectangle.tsx`). On the TUI the PTY region takes every key while
entered, including `Ctrl+C`, and Escape alone leaves. A person who needs to send Escape to the PTY
presses it twice, and the footer says so while a PTY is entered. This is the one place the TUI adds a
key rule the desktop does not have, and it is a rule about the terminal's own limits rather than a
second keymap: the desktop can click outside, the terminal cannot.

## The footer

Textual renders active bindings as a footer. The TUI does the same: the footer line lists the intents
the focused thing accepts with their primary keys, read from the keymap's active layers. Nothing is
declared twice; the footer is a view of the same table `intentKeys` reads. `?` opens the full cheat
sheet, which is the kit's `CheatSheet` drawn as a `Modal`.

## What must never happen

- A second keymap, or key handling in a component. `docs/future/client-plugins/refused.md § A second
  keymap` already refuses it for replaceable surfaces; the TUI inherits the refusal for itself.
- A node that handles `ArrowDown`. Nodes handle `next`.
- Focus state a node owns. The host owns it on both hosts.
