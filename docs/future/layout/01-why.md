# Why: the discussion and the reasoning

Part of [docs/future/layout/](./README.md). This file is the argument. The other files are the
design. If a later reader wants to know why a rule exists rather than what it says, it is here.

## The question that started it

Could a plugin that draws a frame let other plugins insert their own frames inside it, recursively,
with the two talking over `postMessage`? The manifest would list string-keyed parts, the frame would
call an acorn-managed UI to receive other plugins' frames, and it would declare which message types
it accepted. Three examples motivated it: an image editor rendering and editing an attachment inside
the agents pane and handing the edited file back; a markdown preview button in the editor that the
editor knows nothing about; a graph of docker's logs drawn by another plugin.

The literal mechanism was refused, and the refusal is already in the code and the docs three times
over. The plugin scheme serves every frame with `frame-src 'none'`
(`apps/desktop/src-tauri/src/plugin_scheme.rs`), so a frame cannot contain an iframe.
`docs/plugins.md` § "There is no uncooperative extension" and `docs/first-party-plugins.md` reason B
say why: an iframe inside another plugin's iframe makes A's rectangle B's attack surface. A can draw
an invisible layer over B's buttons, resize B to nothing, or steal focus, and B cannot tell. Messages
between two plugin origins bypass the host, so nothing can gate, cap, or log them. And the trust
prompt for A says "draws a pane"; it cannot say that A will run B, C, and D inside it.

None of that argued against the outcome. It argued against A doing the embedding. So the first answer
was: the host embeds, the host relays.

## Rectangles, and why they were a third of the answer

A *rectangle* is a box the host owns the edges of. The host decides where it is, how big it is, and
which iframe goes in it. Every pane, reference panel, settings page, and overlay is one today. The
first design added a rectangle declared as an extension point: A reserves a box beside or below its
pane, B declares that one of its frames fills it, the host draws the two iframes as siblings, and a
typed, manifest-declared message contract crosses through the host. `document-over-frame` was the
precedent: a host-owned Monaco above a plugin frame with three verbs between them.

Then the question was asked of every plugin: what will people want to add to this, and does a
rectangle serve it? The survey ([02-survey.md](./02-survey.md)) found about 45 wants. Twelve were
rectangles. Ten were rows a footer strip already serves. Nine were facts pinned to a specific item
somebody else draws: coverage on a diff line, a feature flag on an editor line, CI on a PR, a pod on a
container. Ten were decisions: stop this push, change this prompt, refuse this tool call. Four did not
fit anything: a custom tool card in the agent transcript, a section with real inputs in the context
tray, hover inside Monaco, a replacement diff renderer.

The integration catalogue (`docs/future/integration-ideas.md`) made the same point from the other
side. Its two hundred ideas collapse into four shapes, three of which are a plugin's own surfaces and
work today. What those plugins want from *other* plugins is almost always to attach a fact to an item
or to act before something happens. Almost never a box.

So a rectangle is real and it stays, but it is the smallest of several pieces, and it is the one
that helps a third-party author least.

## Data versus code

The next distinction was the one that reorganised everything. It is not "simple versus complex."
A remote card can open a modal or a menu and be as rich as anything first-party. The line is whether
plugin code runs on the client.

**Descriptors are data.** Rows and annotations are records the host fetches from the plugin's node
half and draws itself. No plugin code runs in the renderer. That buys four things: a plugin with no
client bundle can contribute, which is half the catalogue; the host can batch, so coverage answers
one request for two thousand lines rather than mounting two thousand things; the host can index the
records into search, dashboards, and the attention inbox; and ten contributors cost ten fetches, not
ten sandboxes.

**A remote tree is code.** A sandbox is running, holding state, answering events. That buys
interactivity and composition, and it costs a running sandbox per contributor, a bundle to trust,
and someone else's JavaScript in the debugging story.

Both survive, and descriptors stay deliberately small. The moment someone asks for a conditional or a
stateful button in a descriptor, the answer is "that is a remote card," not a wider schema. The
remote tree existing is what lets the descriptor vocabulary stay frozen.

## A static schema versus a component tree

Two things get called a UI DSL and they are not the same.

A **static schema** is Slack Block Kit or Adaptive Cards: the plugin sends JSON saying "a card with a
title and three rows," the host has one renderer per block, every click is a round trip and a whole
new blob. It is always one field short. Somebody needs an `if`, then a loop, then a computed value,
and a bad programming language has been invented inside JSON. This is exactly what
`docs/plugins.md` refuses as "a widget toolkit in the wire format," and the refusal was right.

A **remote component tree** is Shopify's remote-dom, and before it remote-ui, which is how a third
party draws inside Shopify's admin without an iframe per widget. The plugin's code runs in a sandbox
and renders with a normal framework against a fake DOM. The fake DOM serialises to a tree of named
host components and streams mutations to the host. The host mounts its own Solid component per node
and posts events back. Logic stays in the plugin. Pixels, theme, focus, and accessibility stay in the
host. No conditional is ever written in JSON, because the plugin's real code does the conditional
and emits a different tree.

The second is what this folder builds. Internally the word "DSL" is discouraged for it, because the
word invites the first shape. It is a component model with more than one renderer.

It keeps the one rule everything rests on. What crosses is `{ type: 'Row', props: { title } }`, and
the host refuses any `type` not in its kit. No script, no CSS, no DOM. The plugin's JavaScript runs
in the same sandbox it runs in today. A frame emits pixels into its own rectangle; a remote tree
emits components into the host's.

It also answers the four wants that fit nothing. A tool card in the transcript is a `Card` with the
plugin's subtree inside, dozens per screen as dozens of small Solid subtrees, which is what the
compiled tier was for. Memory's section in the context tray is a form made of kit inputs, so it is a
remote tree in a slot. And once an owner draws through the tree, an extension point is a node in it:
the host grafts the winning contributor's subtree at `<Slot>`, and neither plugin sees the other's
nodes.

## One reversal, stated plainly

`docs/third-party/monaco.md` says: "the moment the host renders a plugin's list from data, someone
has to design and eternally version a descriptor vocabulary … That request will recur; the answer
stays no." This folder says yes, and owes the reason.

The refusal was aimed at a static schema, and it stands against one. The remote tree is a different
object. Its vocabulary is the kit, which exists and is versioned already through
`@acorn/plugin-api/ui`; the tree adds no second vocabulary. Its logic is the plugin's code, so the
schema never grows an `if`. And the argument in monaco.md that a frame can always draw what a
descriptor cannot is true and unchanged: the frame survives as the rectangle, for pixels. What the
tree adds is the tier between "a list of facts" and "an iframe," which is where a tool card, a
sidebar tab, and a settings section live and where nothing lived before.

## Layouts belong to the host

The owner asked whether a whole first-party UI, the agent conversation say, could be a tree with
extension points in it. Yes, and that is the end state. Along the way came a second observation:
every pane in the survey is one of about six arrangements (list beside detail, header over body over
footer, tabs, a document over or beside a frame, a split with a handle, a wizard), and every plugin
writes its arrangement by hand with `<section class="pane">`, a header div, a scroll div, and its
own CSS. The two largest plugins hold 121 and 117 raw layout tags between them.

If the host owns the six arrangements and a plugin only picks one and fills its regions, three things
follow. Responsiveness is a cost per layout, not per pane, which is what makes a mobile client
cheap enough to build. A terminal projection is a property of the layout, so the terminal client is
six projections plus the kit. And regions are natural focus groups, which the keyboard design needs.

The mobile question settled the host count. Native iOS would have needed a third renderer and a kit
that mapped every component to a native control. A PWA needs only the DOM host with responsive
layouts, and the doc that already exists for it (`docs/future/remote.md`) says mobile should be a
deliberate subset shell rather than the workspace squeezed down. Host-owned layouts make that subset
cheaper; they do not remove the decision about what is in it. So the kit has two hosts to satisfy,
the DOM and, later, the terminal. The terminal is the strict one and it sets the vocabulary.

## Hooks are not events

The owner also wanted plugins that intercept events: forward them to analytics or an audit log, block
them, or change them and use the changed data elsewhere in the plugin's UI. The first two are what
[docs/future/events.md](../events.md) already designs: node-side `ctx.events.on`, a cross-plugin
grant, fan-out, fire and forget. An audit plugin is a subscriber.

Block and modify are not events. An event has already happened; "task archived" cannot be blocked
after the archive. What is wanted is to be asked *before*, in a chain, with a return value. That is a
hook, and the codebase has five of them, single-slot and first-party only: `WORKTREE_CREATED`,
`taskChecks`, and the `routeCapability` seams. [08-hooks.md](./08-hooks.md) generalises them the same
way extension points generalised `pane.footer`: the owner declares the moment and what is allowed at
it, contributors register a route, the host runs the chain with a timeout and hands the owner a
verdict. The interceptor plugin is then three existing pieces: a transform handler on the node, an
emit on the plugin's own channel, and its remote card or rectangle redrawing.

## Focus for free

The last piece. Keyboard navigation is an afterthought today: `createListNavigation` and
`trapOverlayFocus` in `client-core/src/ui/focus.ts`, attached where someone remembered, and DOM
defaults everywhere else. If plugins can only emit kit nodes and pick layouts, the host knows the
whole tree, and the tree can carry focus.

Four references shaped the design. **ratatui** has no focus system; the app owns a focus enum and
widgets are stateless renderers that take `ListState { offset, selected }` from outside. The lesson
is that selection and scroll are data owned outside the widget and keyed by the thing listed, which
is what keeps a list's place when its rows are rebuilt (a bug acorn has hit twice; see the `<For>`
versus `<Index>` note in the memory index). **opentui** is a retained tree with `focusable` nodes,
`focus()` subscribing a node to keys, and `hasFocusedDescendant` propagating up the parents so a
container knows it has focus within; and its `@opentui/keymap` package is a host-agnostic keymap
core with a DOM adapter and a terminal adapter, focus-scoped layers, sequences, and a command
catalog. **Flutter** maps keys to intents in a shortcuts layer and lets widgets handle intents, so
platform differences live in one map. **React Aria** and its Solid port **Kobalte** treat every
collection as one tab stop with roving focus, type-ahead, and selection kept separately from items.
**Textual** declares bindings on widgets and derives the focus chain from the tree, and renders the
active bindings as a footer from that data.

The design in [07-focus-and-keys.md](./07-focus-and-keys.md) takes each of those: focus roles fixed
by the kit, collection state owned by the host and keyed by identity, intents instead of keys, and
`@opentui/keymap` as the engine with acorn's four keybinding scopes mapped onto its layers.

## The costs, honestly

- **Every first-party pane is rewritten.** agents and github are 26 KB and 20 KB files with years of
  small decisions in them. They are features, not refactors, and they are scheduled last.
- **The kit becomes a frozen public API.** Renaming a prop breaks strangers. The kit is kept small on
  purpose, and an unknown node or prop renders a labelled placeholder, which is the forward-compat
  rule `docs/plugins.md` already has.
- **Every interaction in a remote tree is a message hop.** A click is a few milliseconds and fine.
  Per-keystroke UI is not, so inputs are host-owned and uncontrolled, and typing-heavy UI is a
  rectangle.
- **Styling belongs to the host, entirely.** A plugin cannot make its card purple. The rectangle is
  the escape valve, with the rectangle's costs.
- **State lives in the sandbox, and sandboxes die on unmount.** Same contract frames have.
- **Focus and keyboard become the host's problem.** Which is the win, and also real work once, since
  some of `/ui/host`'s focus machinery moves into the kit.
- **It is a subsystem.** remote-dom is around eight thousand lines with its adapters. Ours is
  smaller, with a closed kit and one host framework, but it is not a weekend.
- **Two hosts, eventually.** The DOM host is mostly existing components. The terminal host is a new
  product surface. This programme builds only the first and keeps the second possible.
