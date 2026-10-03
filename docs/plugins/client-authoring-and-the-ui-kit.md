# Client authoring and the UI kit

This page covers how a plugin's client code is built, the rules for drawing with the kit, and the
client contribution points a compiled plugin registers. It's part of the
[plugin reference](../plugins.md). Commands and shortcuts are in [commands](./commands.md).

## Client authoring and the UI kit

The repository package builder applies one client transform, for the tree path. The Solid preset is
set to `generate: 'universal'` with `@acorn/plugin-api/ui/tree` as its module, so JSX becomes acorn's
own node names instead of DOM. A plugin's direct `solid-js` dependency doesn't break the shell's
one-Solid rule, because a frame's document is a separate reactive realm and a tree's worker is a
separate thread. A bundle that draws a rectangle writes no JSX, so the transform has nothing to do.

A tree imports its nodes from `@acorn/plugin-api/ui/tree` and must not import `@acorn/plugin-api/ui`.
That barrel holds components compiled for a document. A frame imports the components. Don't copy the
kit's primitives or write replacements.

The host draws a tree's nodes, so the reader's theme, style pack, and density already apply. The
shell serves a frame's document and links `/ui.css`, built from the same presentation-only kit CSS
the shell uses. The appearance bridge applies the theme, style, and token projection to the frame
root. A frame may add CSS for its own markup, but it doesn't bundle a copy of acorn's kit CSS. A frame
written without Solid can use the same class names.

Three architecture rules hold for every plugin in this repository:

- No plugin ships a stylesheet. Kit nodes take no `class` and no `style`.
- No plugin draws a raw `div` or `span` (`tools/arch/primitiveAdoption.test.ts`).
- No plugin mounts a Solid root of its own, because a root the host doesn't know about sits outside
  every focus group.

## Client contribution points

A compiled plugin's client initialization is synchronous registration. The host has contribution
points for panes, sources, settings pages, slots, extension points, extensions, provider reference
panels, agent contexts, schedules, persisted-state slices, Node statistics, attention sources, brand
marks, content links, context menus, rail markers, and commands. An activation pass handles
subscriptions and local storage once every descriptor exists.

- `slots` is one point for both shapes. The slot id decides whether the component receives the shell
  context or only a task id ([registries](../frontend/registries.md)).
- `schedules` takes a raw `intervalMs`, because a renderer poll isn't a Node cadence.
- `extensionPoints` and `extensions` are the compiled halves of the manifest keys of the same name.
  The host mints `<pluginId>:<id>` for a point and stamps `pluginId` on a contribution. A compiled
  contribution's carrier is a `component`.

`ctx.contribute(registry, entry)` is the escape hatch for a registry another plugin published. A
registry the host owns gets a named member.

A contribution that names a provider must name its own plugin. `declaredProvider` in
`registries/extensionPoints/plugin.ts` stamps `providerId` from the activating plugin, never from the
contribution, so a plugin can't claim another plugin's integration rows.

`persistedStateSlices` has no manifest form. A slice is a
`{ codec, empty, unknownIds, maxBytes, binding: { values, hydrate } }` record the host drives through
its restore phases, writing shell signals at boot before any frame exists. A loaded plugin uses its
frame's `state.get` and `state.set` in its own `plugin:<id>:*` namespace, the same preferences the node
half's `prefs` facet reads. The frame reads its state when it mounts and clears its own keys.

A source may contribute routes. A route addresses an item inside a surface and never gates whether the
surface renders. A source scopes itself to the routed project at core's `/p/:projectId`, and its own
paths hang below that, such as `/p/:projectId/pulls/:number`. Core's URLs are constants in
client-core, so a contributed route can't resolve in core's place. `SourceContribution.taskPath` is
the one question core asks back: where a task the source owns should live.

## Loaded surfaces in the manifest

A loaded project-scoped pane needs three entries that refer to each other, and the Node checks all
three at parse:

```json
{
  "contributions": {
    "frames": [{ "target": "pane", "id": "linear-issue", "label": "Linear issue", "scope": "project",
                 "layout": "single", "regions": { "body": { "kind": "remote", "entry": "issue" } } }],
    "routes": [{
      "id": "linear.issue-route",
      "path": "/p/:projectId/x/linear/issues/:identifier",
      "surface": "linear-issue",
      "item": "identifier",
      "order": 60
    }],
    "sources": [{
      "id": "linear-issues",
      "label": "Linear",
      "order": 20,
      "items": "/v1/p/linear/rail-items",
      "onSelect": { "verb": "navigate", "surface": "linear-issue" }
    }]
  }
}
```

The surface receives `projectId` and, when the URL addresses one, the item. Later selections arrive as
`select` messages, not remounts. A project-scoped surface never gets a `taskId`. Its `label` and
`glyph` aren't shown, because it's drawn beside its own rail list. Core reserves the `x` segment, and
`tools/arch/boundaries.test.ts` pins it.

An `overlay` surface is a full-screen picker. The host draws the backdrop, box, title, and dismiss
control, and the plugin draws only the contents. The `openOverlay` verb is the only way to open it, so
an overlay nothing opens is a parse error:

```json
{
  "contributions": {
    "frames": [{ "target": "overlay", "id": "files", "label": "Go to file" }],
    "commands": [{ "id": "open-files", "kind": "action", "title": "Go to file",
                   "action": { "verb": "openOverlay", "overlay": "files" } }],
    "keybindings": [{ "command": "open-files", "defaultChord": "meta+p", "when": "task" }]
  }
}
```

One overlay is on screen at a time, and opening a second replaces the first. The frame dismisses
itself with `ui.close()` once its picker has picked. The overlay is bound to the task that was active
when it opened.

## Trust gating

When a plugin has a client bundle, its frames, trees, webviews, and descriptors wait for trust, per
device and per bundle. The first sight of a `(plugin, hash)` pair prompts before anything registers,
an update prompts again with the permission diff, and a rejected bundle gets nothing. A
descriptor-only plugin has no client bytes and registers directly.

The prompt shows three separate lists: the node-half permissions, the enforced UI scopes and key
claims, and the webview hosts. `packages/client-core/src/host/trust/permissions.ts` classifies every
line against what the host can grant, instead of echoing manifest text. Each list is enforced at a
different boundary, and a webview host reaches a page with live network access, so the lists are
never merged.

The `footer` slot is the task footer, so a footer badge is invisible until a task is open.
