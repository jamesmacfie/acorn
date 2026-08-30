# Extension kinds: five ways one plugin lets another in

Part of [docs/future/layout/](./README.md). An extension point is any place where a plugin says
"someone else may come in here." What they bring is one of five things. Every kind follows the same
four rules, so an author who learns one has learned them all.

## The four rules

These exist in the code for `pane.footer` today (`packages/protocol/src/extensionPoints.ts`,
`docs/plugins.md` § Cooperative extension points). Nothing here bends them.

| Rule | What it means |
| --- | --- |
| The owner consents in its manifest | Plugin A writes `extensionPoints: [...]`. A point A did not declare has nothing delivered into it. There is no uncooperative extension. |
| The host mints every name | A point is `<ownerId>:<pointId>`, stamped from the plugin the manifest was read under (`qualifiedExtensionPointId`). B cannot advertise a point in A's name, and B's manifest names A out loud. |
| Both sides appear in the trust prompt | With host-owned copy. "Reserves part of its Agent pane for other plugins." "Can stop a push in the changes plugin." A plugin id is interpolated; manifest text never is (`client-core/src/plugins/permissions.ts` says why). |
| Code does not cross | What travels is data: rows, marks, a component tree, a typed payload. The host carries it, checks it, and draws or runs it. Neither plugin touches the other's document, routes, or state. |

One runtime contract on top: **an unmatched contribution is silent.** Owner missing, disabled,
untrusted on this device, or the point renamed: nothing appears, nothing throws. That is right for a
user and wrong for an author, so the developer view at the end of this file exists.

## Which kind do I want

Ask in this order:

1. **Is it a decision, not a drawing?** "Stop this push." "Change the prompt." A **hook**.
2. **Is it a fact about one item the owner already draws?** Coverage on a line, CI on a PR. An
   **annotation**.
3. **Is it a list of things with names?** Linked issues under a board. **Rows**.
4. **Is it UI you can build from acorn's own components?** A tool card, a sidebar tab, a settings
   section. A **remote tree** in a slot.
5. **Does it own pixels, heavy typing, or a third-party library?** A canvas, Monaco, xterm, a chart
   library. A **rectangle**.

Most third-party plugins will be a rail source, a pane, and a few remote cards. Rectangles become
the exception.

The line between rows and annotations on one side and remote trees on the other is **data versus
code**, not simple versus complex. A remote card can open a `Modal`. What differs is whether plugin
code runs on the client, and the table at the end of this file prices that.

## Rows

Shipped. Plugin A reserves a strip under its pane; plugin B answers a GET on its own namespace with
`{ items: [{ id, title, subtitle?, icon?, badge? }] }`. The host fetches, draws with its own `Row`,
and stamps B's name on the group. The verb is declared once on the contribution from the closed
context-free set, so a row cannot carry an unchecked action.

```json
// A: board plugin
"extensionPoints": [{ "id": "card-links", "kind": "rows", "location": "pane.footer", "surface": "board" }]

// B: tracker plugin
"extensions": [{
  "id": "board-issues",
  "point": "board:card-links",
  "items": "/v2/p/tracker/board-issues",
  "onSelect": { "verb": "openRefPanel" }
}]
```

The same shape gets more locations as surfaces appear to draw them: a `summary.badges` strip on a PR
overview, a `composer.actions` row of buttons in the agent composer. A button row is rows, not a
rectangle. If the owner wants text back from a button, that is a hook the button's verb calls.

Today's `pane.aside`, filled by the user's own dashboard panels, is unchanged and is not an
extension kind; it is documented in `docs/dashboards.md` § Placements.

## Annotations

New. Rows answer "what is related to this pane." Annotations answer "what do you know about this
line." The owner declares what its items are keyed by. The contributor answers with marks for the
keys in view. The host draws the marks at the owner's draw site, which the diff renderer and Monaco
already have for review threads and decorations.

```json
// A: changes declares what can be annotated
"extensionPoints": [{
  "id": "diff-line",
  "kind": "annotation",
  "key": { "file": "string", "line": "number", "side": "string" }
}]

// B: coverage
"extensions": [{
  "id": "coverage-lines",
  "point": "changes:diff-line",
  "items": "/v2/p/coverage/lines",
  "onSelect": { "verb": "openPane", "pane": "coverage" }
}]
```

The host POSTs the keys on screen in one request and B answers marks:

```
POST /v2/p/coverage/lines  { "keys": [{ "file": "src/auth.ts", "line": 42, "side": "new" }, …] }
→ { "items": [{ "key": {…}, "severity": "info" | "warn" | "danger", "text": "Not covered by any test", "icon": "shield-off" }] }
```

Display strings only, the same rule `PluginExtensionItem` has. Batched, so a plugin with two thousand
marks answers one request. Provenance is stamped on every mark. Refresh happens on the owner's own
invalidation and on the contributor's `plugin:<id>:*` channel.

Draw sites, as built: `changes:diff-line` and `github:diff-line` (both through `DiffPane`),
`docker:container`, and `core:task` (the rail row, which supersedes Slice 3 of
`docs/future/rail-tab.md`; a mark there is drawn as a rail marker rather than as a line of text,
because 52 pixels has no room for words).

Two more were named here and are struck until a plugin asks for them. `editor:line` (the gutter) is
Monaco's, and a mark in Monaco's gutter is a decoration rather than a kit draw site — a different
mechanism wearing the same name. `editor:path` (the file tree row) has no consumer and no argument for
one that `changes:diff-line` does not already answer.

## Remote tree

New, and the largest piece. Plugin code runs in a sandbox, renders with a normal framework against a
fake DOM, and the fake DOM serialises to a tree of kit node names. The host mounts its own component
per node and posts events back. [06-remote-tree.md](./06-remote-tree.md) owns the wire format and
the sandbox; this section covers only how it is an extension kind.

An owner that draws through the tree declares a point as a node:

```tsx
<Slot point="attachment" mode="replace" key={selected?.mime}>
  <AttachmentChip file={selected} />          // the default child, drawn when nobody matches
</Slot>
```

and in its manifest, so the trust prompt can say it:

```json
"extensionPoints": [{ "id": "attachment", "kind": "remote", "mode": "replace", "selector": "mime", "accepts": ["image/*", "text/csv"] }]
```

A contributor names the point, the bundle entry that renders into it, and what it matches:

```json
"extensions": [{ "id": "agent-images", "point": "agents:attachment", "remote": "./dist/attachment.js", "matches": ["image/png", "image/jpeg"] }]
```

The host grafts the contributor's subtree at the slot node. Neither plugin sees the other's nodes.
The contributor's code has exactly the permissions its own manifest declares; sitting inside A's
pane grants it nothing of A's. One level only: a contributor's subtree does not itself open slots
(see [refused.md](./refused.md)).

First slots: `agents:tool-card` (keyed by tool name; this replaces the compiled-only
`agentToolRenderers` registry), `agents:composer-actions`, `agents:attachment`,
`context:section` (keyed by section id; this replaces `contextSectionSlots`), `docker:stats-beside`.

## Rectangle

Exists as every pane today. New here: a rectangle declared as an extension point, so the iframe in
it may belong to someone else. After remote trees exist, rectangles are for surfaces that own
pixels: Monaco, xterm, a canvas, a chart library, a preview of arbitrary HTML.

```json
// A: editor declares a box beside its document
"extensionPoints": [{
  "id": "beside",
  "kind": "rectangle",
  "location": "pane.inline-beside",
  "surface": "editor",
  "mode": "replace",
  "selector": "path",
  "hooks": { "calls": { "document-changed": { "text": "string" } } }
}]

// B: markdown-preview fills it for *.md
"frames": [{ "target": "inline", "id": "preview", "label": "Markdown preview" }],
"extensions": [{ "id": "md-preview", "point": "editor:beside", "frame": "preview", "matches": ["*.md", "*.mdx"] }]
```

The two iframes are siblings; the host draws both and sits between them. Position is in the location
name (`pane.inline-below`, `pane.inline-beside`), never an orientation knob, the same rule the layout
template family follows. Talking across the box uses hooks ([08-hooks.md](./08-hooks.md)), so
`slot.call('document-changed', { text })` is a hook with one handler. One concept, not two.

The iframe path itself is unchanged: `app-plugin://<hash>`, the CSP in `plugin_scheme.rs`, the
bridge in `client-core/src/plugins/frames/`, `claimsKeys`, the trust prompt on bytes.

## Hook

New, node side. A turn in a decision before it happens. Owned by [08-hooks.md](./08-hooks.md);
listed here because it shares the manifest key and the four rules.

```json
// owner
"extensionPoints": [{ "id": "before-push", "kind": "hook", "payload": { "branch": "string", "remote": "string", "commits": "string[]" }, "allows": ["observe", "veto"], "timeoutMs": 5000, "onTimeout": "allow" }]

// contributor
"extensions": [{ "id": "scan-push", "point": "changes:before-push", "route": "/v2/p/secret-scan/push", "mode": "veto" }]
```

## Arbitration: who fills a box

Every kind with a slot or rectangle declares one of two modes.

| | `stack` | `replace` |
| --- | --- | --- |
| Occupants | owner's default plus every matching contributor, up to `max` | exactly one: best match for the `key`, else the default |
| Selector | optional; contributors may still filter with `matches` | required in practice; the owner passes `key` when opening |
| Messages | fan out to all, hear from any | one pipe |
| Precedent | `pane.footer` groups from many plugins | `coreSlot` with the settings picker |
| Example | tools beside a note; buttons in a composer | renderer for the selected attachment |

`max` matters for `stack`: each remote contributor is a live subtree and each rectangle contributor
is an iframe. Past `max` the host draws a disclosure or refuses; the owner sets the number because
it is the owner's screen.

When two contributors match the same key in `replace` mode, the user picks in Settings → Plugins,
the same control the `rail.taskList` exclusive slot uses (`registries/exclusiveSlots.ts`), and the
owner's default draws until they do. An override is an offer, not a seizure.

## The unified manifest

One key, five kinds, the same rules:

```json
"extensionPoints": [
  { "id": "card-links",  "kind": "rows",       "location": "pane.footer",        "surface": "board" },
  { "id": "diff-line",   "kind": "annotation", "key": { "file": "string", "line": "number", "side": "string" } },
  { "id": "attachment",  "kind": "remote",     "mode": "replace", "selector": "mime" },
  { "id": "beside",      "kind": "rectangle",  "location": "pane.inline-beside", "surface": "editor", "mode": "replace", "selector": "path" },
  { "id": "before-push", "kind": "hook",       "payload": { … }, "allows": ["observe", "veto"], "timeoutMs": 5000 }
],
"extensions": [
  { "point": "board:card-links",    "items": "/v2/p/me/rows" },
  { "point": "changes:diff-line",   "items": "/v2/p/me/lines" },
  { "point": "agents:attachment",   "remote": "./dist/attachment.js", "matches": ["image/*"] },
  { "point": "editor:beside",       "frame": "preview", "matches": ["*.md"] },
  { "point": "changes:before-push", "route": "/v2/p/me/scan", "mode": "veto" }
]
```

`kind` defaults to `rows` so today's manifests parse unchanged. The node checks the block at parse
and the client re-checks it on arrival, as `extensionPoints.ts` does now.

## What each kind costs

| | Descriptor (rows, annotations) | Remote tree | Rectangle | Hook |
| --- | --- | --- | --- | --- |
| What crosses | records | a component tree | nothing; an iframe is placed | a payload and a verdict |
| Plugin code on the client | none | in a worker | in its own iframe | none; a node route |
| Needs a client bundle | no | yes | yes | no |
| Can open a modal or menu | no | yes, host-drawn | yes, via its overlay | not applicable |
| Cost of N contributors | N fetches, batched | N live subtrees | N iframes | N route calls |
| Host can index it | yes | no | no | no |
| Best for | facts about many items | UI in someone else's list | owning pixels | acting before something happens |

Descriptors stay boring on purpose. When someone asks for a conditional in a row, the answer is a
remote card.

## The developer view

Silent-when-absent is right for users and the worst possible thing for an author. A typo in `point`
produces an empty pane and no error. Registration failures already reach the roster row and the
attention inbox (`client-core/src/plugins/surfaceFailures.ts`, `node/pluginFailures.ts`). Extension
points need the same plus one screen under Settings → Plugins:

- every point on this node, its kind and mode, and who fills it, with per-contributor timing for
  annotations and hooks;
- every contribution whose point nobody declares, with a "did you mean" against the known points;
- for remote slots, which contributor won and why (match, user pick, default).

Cheap to build, and it decides whether anyone finishes their first plugin.

## Existing code to grow, not replace

- `packages/protocol/src/extensionPoints.ts`: `EXTENSION_POINT_LOCATIONS`,
  `qualifiedExtensionPointId`, `parseExtensionPointRef`, `PluginExtensionItem`. Gains `kind`,
  `key`, `mode`, `selector`, `max`, `accepts`, `payload`, `allows`.
- `packages/client-core/src/plugins/frames/register.ts`: the `pane.footer` branch and the
  `ExtendedPane` wrapper are where rectangle slots attach.
- `packages/client-core/src/plugins/chrome/ExtensionPointHost.tsx`: draws rows today; annotations
  and the developer view read the same registry.
- `packages/client-core/src/registries/exclusiveSlots.ts`: the picker pattern for `replace` ties.
- `packages/client-core/src/plugins/permissions.ts`: host-owned trust copy per kind and direction.
