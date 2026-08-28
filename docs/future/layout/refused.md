# Refused: what was considered and set aside, with the argument

Part of [docs/future/layout/](./README.md). Each of these will be asked for again, and the request
will sound reasonable. This file exists so the argument is had once.

## Iframes inside iframes

The original question, taken literally. Refused because the plugin scheme's CSP says
`frame-src 'none'` (`apps/desktop/src-tauri/src/plugin_scheme.rs`) and that is load-bearing. An
iframe embedded by another plugin's iframe lets the outer plugin overlay, resize, and clickjack the
inner one with no way for the inner one to detect it, puts the messages between them out of the
host's sight, and makes the trust prompt for the outer plugin a lie: "draws a pane" cannot describe a
tree of other plugins' frames. Rectangles are siblings placed by the host, never children of a
plugin's document.

## Free `postMessage` between plugins

Refused for the same reason. Every cross-plugin byte in acorn passes the host and is validated
against a declared shape. Two plugin origins talking directly cannot be gated, capped, logged, or
described in a trust prompt. The remote tree, hooks, and rectangle slots all carry messages the host
checks.

## Nested slots

A contributor's subtree grafted into an owner's slot does not itself open slots. One level. A tree of
grafts makes the trust prompt a tree and makes "who is drawing this" unanswerable. If a real case
appears, it can be argued then against a concrete plugin.

## A static widget schema

Slack Block Kit, Adaptive Cards, and every "JSON that describes a card." Always one field short:
someone needs a conditional, then a loop, then a computed value, and a bad language has been invented
inside JSON. `docs/plugins.md` refuses this as "a widget toolkit in the wire format" and that refusal
stands. The remote tree is a different object: the vocabulary is the kit that already exists, and the
logic is the plugin's code, so the schema never grows an `if`. Descriptors (rows, annotations) stay
deliberately small for the same reason; the tree is where the overflow goes.

## Styling props on kit nodes

No `class`, `className`, or `style`, including "just for desktop" and "just for first-party." The
moment a plugin can say a pixel or a colour, the kit stops being portable and the terminal host has
to guess what was meant. Semantic props only: `tone`, `emphasis`, `size` in three steps, grouping by
`space` role. Desktop visual tuning moves into the kit's own CSS, once per component. A plugin that
needs its brand purple has a rectangle, priced as DOM-only.

## Raw scale values in plugin-facing tokens

`space.row`, never `space.3` or `gap: 8`. A scale step is a value; a role is a meaning. Each host maps
roles to its own values, and a terminal has no value for `8`.

## Plugin-positioned layout

A plugin picks one of six layouts and fills regions. It never says where a region goes, how wide it
is, or which way things flow. `orientation`, `columns`, and `width` knobs are refused; a new named
layout is the answer when six is not enough. Position is in the name, the rule
`docs/third-party/monaco.md` set for templates.

## Per-item remote trees at volume

A remote subtree per diff line or per file-tree row would be thousands of sandboxed mounts. Facts
pinned to items are annotations: batched, host-drawn, indexable. A remote tree is for a card, a tab,
a section, things that number in the dozens on a screen.

## Hooks on streams or per-keystroke paths

PTY output, editor keystrokes, the agent token stream, per-render and per-selection changes.
`docs/plugins.md § What is not an event` refuses these as events; a hook is more expensive than an event, so
it is refused harder.

## A transform that changes the payload's shape

A hook handler's output is validated against the same declared shape as its input. A handler cannot
hand the owner something the owner did not say it accepts.

## Plugins depending on hover

Hover exists on the DOM host with a pointer and nowhere else. The kit uses it for affordance only,
and everything reachable on hover is reachable by focus. A `RowActions` that appears only on hover is
a bug.

## Controlled and uncontrolled selection mixed on one node

React Aria supports both and it is a constant source of bugs. The host owns `selected` by default;
a node that declares controlled mode is controlled for every operation. Never half.

## A second keymap

One engine (`@opentui/keymap`), one command catalog (the command registry), one adapter per host.
No plugin and no first-party pane installs its own key handler outside inputs and rectangles.

## The hidden iframe as the tree sandbox

Considered as the cheapest path: reuse `app-plugin://`, the CSP, and the bridge, and never draw.
Refused in favour of a Web Worker: no DOM at all, lighter per plugin, and the bridge is a transport
swap. The iframe survives only as the rectangle.

## First-party plugins through the remote root

Considered for the flattest possible plugin story. Refused for this programme: every first-party pane
would pay the sandbox hop and the agents transcript's performance risk would land here. First-party
renders directly against the same API; the two paths produce the same tree, so slots and focus work
across them. Making a first-party plugin loadable is a later, per-plugin decision.

## A native iOS host

Considered when the terminal was on the table. Set aside in favour of a PWA: one DOM host with
responsive layouts instead of a third renderer and a kit that maps to native controls. The kit's
intent-only rule survives because the terminal still demands it.

## Rebuilding the agents transcript first

The pane that pays for the whole exercise and the one most tempting to start with. Refused as a
starting point: it is the largest and most performance-sensitive pane in the product (a virtualizer
was deleted there on purpose; see the memory index). Every mechanism it needs is exercised on
smaller panes first, and it moves last.

## Reopening `frame-src`

For any reason. The Rust test in `plugin_scheme.rs` that pins the policy stays green for the life of
the design.
