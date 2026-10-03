# UI and cooperation

This page is the reasoning behind how plugins draw and how they extend each other. It's part of
[extensibility](../extensibility.md). The mechanisms are in [choosing how a plugin
draws](../plugins/ui-tiers.md) and [cooperative extension
points](../plugins/cooperative-extension-points.md).

## Data, code, and pixels

Plugin UI splits three ways, and the split isn't about effort. Ask in this order and take the first
that fits:

- A **descriptor** is data, such as a rail row, a badge, a palette entry, or a mark under another
  plugin's diff line, that the host renders with its own components from the plugin's own routes. An
  iframe for a 20-pixel badge would be absurd, but the real reason is that chrome has to be live when
  no plugin UI is mounted. Its data comes from the plugin's node half, which always runs.
- A **tree** is the plugin's code running in a sandbox with no DOM, emitting names of the host's
  components. The host draws them, so the result has the shell's focus handling, keyboard model, ARIA,
  and style pack, which an iframe can't borrow. Panes, reference panels, settings pages, and cards in
  another plugin's list live here.
- A **rectangle** is a sandboxed iframe on its own origin with no network, for surfaces whose pixels
  are the product: a canvas, a chart library, a rich editor, or a page of arbitrary HTML.

For a long time there were only two answers, descriptors for chrome and frames for rectangles, and
that pushed every pane into an iframe. Rollbar's rail lost its filters on migration, because a
descriptor row can't express a filter. With trees, that exploration is drawn from the host's own
controls.

Descriptors stay small. The closed verb set stays closed, because every time it widens for one
plugin, every future plugin inherits more to get wrong. When someone asks for a conditional in a row,
the answer is a tree, not a bigger descriptor, and a tree isn't the static widget schema acorn has
refused. The furthest descriptors go is a typed data source: the plugin declares records and query
capabilities, and the host owns querying, authoring controls, and dashboards
([typed data sources](../data-sources.md)).

## Plugins may extend each other, and only by invitation

The same split applies one level up. A plugin declares a place inside one of its own surfaces that
other plugins may fill, and another plugin declares what it puts there, both by id. What it puts there
is rows or annotations (descriptors), a remote tree, a rectangle the host places as a sibling, or a
hook, which isn't drawn at all but takes a turn in a decision. The host carries it from one plugin to
the other, stamps whose it is, and draws or runs it.

Three things are the design, not the implementation:

- **Both sides are declared.** Nothing is inferred or discovered at runtime, and the trust prompt shows
  "this plugin opens a list to others" or "this plugin adds rows to that plugin's list" before
  anything runs.
- **The owner opted in.** There's no uncooperative extension. Some tools let any plugin rewrite any
  other plugin's DOM and document it honestly as trusted same-origin code, not a sandbox. That's the
  absence of a boundary, and it makes every plugin part of every other's attack surface. If a real
  need can't be expressed as a cooperative point, the answer is a wider vocabulary, not an open realm.
  Memory's editable section in the Context pane used to be cited as a permanent cost, and it's a
  `context:section` tree contribution.
- **Registering never takes anything.** A plugin offering to draw acorn's own rail task list makes an
  offer. The person picks in settings, and core draws whenever the chosen provider is missing,
  disabled, or broken.

The Node has the same seam ([node-side extension points](../plugins/node-side-extension-points.md)).
Before it existed, the Node's only plugin-to-plugin door was a capability, which has one provider, so
every "many plugins each add one of these" case grew a private registry inside some plugin. The rule
that came out of it: a capability when there's one right answer, an extension point when there are
many. Node points carry functions, not descriptors, and they're declared and filled through `ctx`, with
no manifest form.

## Plugins get building blocks, not only a boundary

A sandbox that isolates a plugin and leaves it to rebuild a button is one nobody enjoys writing
against. A plugin gets acorn's own components, such as buttons, fields, badges, pickers, and the diff
viewer, so it looks and behaves like the rest of the app, and the work of a plugin is its own logic.

The kit is closed, and that matters most. Every component a plugin may draw is in one list, and a
node's props are role tokens, content, counts, Booleans, and handlers, never `class`, `style`, or a DOM
attribute ([the closed kit](../ui-design/closed-kit.md#the-closed-kit)). A closed kit lets the same
source render compiled in this process or in a worker with no DOM, and it keeps a second host, such as
the terminal, from being a rewrite.

Two earlier decisions make this possible:

- **A sandbox is a separate realm.** A second Solid instance inside a frame or a worker shares no
  reactive graph with the shell, so the one-Solid hazard doesn't apply.
- **The design system is enforced-pure.** `client-core/src/kit/` is props in, DOM out, with no
  data-layer imports, checked by the boundaries test, so its components drop into a sandbox with no
  query client or shell context.

An outside author writes a tree against `acorn-plugin-sdk/remote`, the published kit nodes and Solid
adapter, and the bridge comes from `acorn-plugin-sdk` ([published
packages](../plugins/publishing.md)). The DOM component barrel, `@acorn/plugin-api/ui`, stays a
workspace dependency: publishing it would need a Solid peer dependency, a bundled slice of client-core,
and prop types for about 40 components. A frame doesn't need it, because the host serves `/ui.css` at
every plugin origin, so `class="ui-btn"` gets acorn's own look with no JavaScript. No plugin acorn
ships has a stylesheet, and an architecture rule refuses one.
