# Cooperative extension points

[Back to plugins](../plugins.md)

## Cooperative extension points

Plugin B could not add anything *inside* plugin A's surfaces, even when A would welcome it. The only
way was for A to import B, which is the coupling the registries were built to remove. Two manifest
keys close that, and the shape is the same one every other contribution has:
`@acorn/protocol/extensionPoints.ts` holds the vocabulary, the node checks it at parse, the client
checks it again on arrival, and the host mints every name.

### Five kinds, four rules

What a contributor brings is one of five things, and the kind is a field on the point:

| `kind` | What crosses | Plugin code on the client | Best for |
| --- | --- | --- | --- |
| `rows` | records | none | a list of things with names under a pane |
| `annotation` | records, keyed | none | facts pinned to items the owner already draws |
| `remote` | a tree of the host's own components | in a worker | UI inside somebody else's surface |
| `rectangle` | nothing; an iframe is placed | in its own iframe | surfaces that own pixels |
| `hook` | a payload and a verdict | none; a node route | acting before something happens |

Ask in this order. **Is it a decision, not a drawing?** A hook. **Is it a fact about one item the owner
already draws?** An annotation. **Is it a list of things with names?** Rows. **Is it UI you can build
from acorn's own components?** A remote tree. **Does it own pixels, heavy typing or a third-party
library — a canvas, Monaco, xterm, a chart library?** A rectangle.

Descriptors stay boring on purpose. When someone asks for a conditional in a row, the answer is a
remote card. The line between rows and annotations on one side and remote trees on the other is **data
versus code**, not simple versus complex — a remote card can open a `Modal`. What differs is whether a
plugin's code runs on the client, and this is what that costs:

| | Descriptor (rows, annotations) | Remote tree | Rectangle | Hook |
| --- | --- | --- | --- | --- |
| What crosses | records | a component tree | nothing; an iframe is placed | a payload and a verdict |
| Plugin code on the client | none | in a worker | in its own iframe | none; a node route |
| Needs a client bundle | no | yes | yes | no |
| Can open a modal or a menu | no | yes, host-drawn | yes, in its own overlay | not applicable |
| Cost of N contributors | N route reads, batched | N live subtrees | N iframes | N route calls |
| The host can index it | yes | no | no | no |
| Best for | facts about many items | UI in someone else's surface | owning pixels | acting before something happens |

Most third-party plugins will be a rail source, a pane, and a few remote cards. Rectangles are the
exception, not the default.

**Where a point id lives.** A point is `<ownerId>:<pointId>`, and the string a contributor spells has
to come from somewhere. Two homes, and the rule is which owner you are: core's own points and the
first-party points core's consumers say — `agents:*`, `core:*` — are in
`@acorn/protocol/extensionPoints.ts`, because both ends of the wire compile against protocol. A
plugin's own points — `changes:diff-line`, `github:diff-line`, `docker:container`,
`context:section` — are in that plugin's own `extensionPoints.ts`, because that is where the owner
lives. **A contributor in another plugin spells the string.** It cannot import the owner's module: a
plugin may not import another plugin, and that boundary is the whole reason these points exist. The
string is the contract, the host mints it from the manifest it was read under, and a typo shows up on
the plugin's page as a contribution whose point nobody declares.

All five obey the same four rules:

| Rule | What it means |
| --- | --- |
| The owner consents in its manifest | A point A did not declare has nothing delivered into it. There is no uncooperative extension. |
| The host mints every name | A point is `<ownerId>:<pointId>`, stamped from the plugin the manifest was read under. B cannot advertise a point in A's name, and B's manifest names A out loud. |
| Both sides appear in the trust prompt | With host-owned copy. A plugin id and a verb are interpolated from fixed tables; manifest text never is. |
| Code does not cross | What travels is data: rows, marks, a component tree, a typed payload. The host carries it, checks it, and draws or runs it. |

`kind` defaults to `rows`, so a manifest written before this field parses to the kind it meant.

**What each kind does in a terminal.** Both hosts read the same registry and the same arbitration; only
the drawing differs. `rows` becomes a keyboard-driven collection at the end of the owning pane rather
than a strip under it. `annotation` marks draw on the line below the item they key, because a diff line
in cells is already as wide as the panel. `remote` trees cross with full parity, and a contributor's
nodes are as reachable as the kit says they are — a `Button` is a stop, a `Text` is not. `rectangle` is
one muted line naming the point, because there is no iframe. `hook` runs on the node and neither host
draws it. `docs/tui.md` § What a plugin loses here is the table, and it is the one place that answer
lives.

### Rows

**A declares the point it hosts.** One entry, and it is all the code A writes:

```json
{ "contributions": {
  "frames": [{ "target": "pane", "id": "board", "label": "Board" }],
  "extensionPoints": [{ "id": "card-links", "kind": "rows", "label": "Linked items", "location": "pane.footer", "surface": "board" }]
} }
```

`location` is a closed list and it grows when a surface appears to draw it, never ahead of one:
`pane.footer`, a strip the host draws under a plugin pane's frame; `pane.aside`, a column beside it;
and `pane.inline-below` and `pane.inline-beside`, which hold another plugin's rectangle and belong to
the `rectangle` kind below. Position is encoded in the *name*, the same rule the frame `layout`
template family follows: an `orientation` field alongside would be the first knob of a layout language.
`surface` must be a `pane` this same manifest declares; a settings page, importer, overlay, reference
panel or webview is chrome the host already draws around a frame, with nowhere to reserve a strip. One
point per surface per location — so one pane may have several.

**The footer and the aside take two different contributors.** A footer is filled by other plugins'
`extensions`, below. An **aside is filled by the user**: the host draws a dashboard region there, and
what the owner declares is not a route to read but the constraints a person's own composition must
satisfy — `panels: { collections | fieldRole, views, max }`, defaulting to this plugin's own
collections, every view and four panels ([dashboards.md](../dashboards.md) § Placements owns that
vocabulary; a rail source declares the same block to get a panel area beside its list). An
`extensions` entry aimed at an aside delivers nothing, which is the same silent nothing every
unmatched contribution already gets.

Every region obeys one rule without exception: **the host draws them, the plugin's layout only reserves
them.** Panels and rows are host components; the frame is a separate realm. No bridge API may pretend
otherwise.

**B declares what it puts there, by id.**

```json
{ "contributions": { "extensions": [{
  "id": "board-issues",
  "point": "board:card-links",
  "label": "Linear issues",
  "items": "/v2/p/tracker/board-issues",
  "onSelect": { "verb": "runNodeAction", "path": "/v2/p/tracker/open" }
}] } }
```

`point` is `<ownerPluginId>:<pointId>`, so B's manifest names A out loud and an owner reading it at
install time can see which package this one reaches into. `items` is a GET on **B's own** namespace
answering `{ items: [{ id, title, subtitle?, icon?, badge? }] }` — display strings, nothing else.
`onSelect` is declared once, on the contribution, from the context-free verb set, so the node can check
it against B's own surfaces at parse time; the clicked row's id rides along as the item. There is no
per-item action, because that would be an unchecked verb arriving over a route.

An extension names **exactly one** way in — `items`, `remote`, `frame` or `route` — and which one is
right depends on the owner's kind, which the contributor's manifest cannot see. The node checks the
shape ("name one"), and the match between a carrier and a point's kind happens at delivery, where both
are visible.

A compiled plugin has a fifth carrier that no manifest can name: `component`, registered through
`ctx.extensions`. It fills a `remote` point, the same kind a bundle fills, because from the owner's
side and from the trust prompt's side the two are one thing: another plugin's tree of kit nodes in a
slot the owner reserved. What differs is where the code runs. A loaded plugin's bundle runs in a worker
and its tree crosses as a stream of node names; a compiled plugin's component is already in this
process and the host mounts it. The owner writes one `Slot` and cannot tell which answered. Context's
`context:section` point is the worked example, with memory as its one contributor.

### Annotations

Rows answer "what is related to this pane". Annotations answer "what do you know about this line". The
owner declares what its items are keyed by; the contributor answers with marks for the keys on screen.

```json
// A: changes declares what can be annotated
{ "id": "diff-line", "kind": "annotation", "label": "Diff line",
  "key": { "file": "string", "line": "number", "side": "string" } }

// B: coverage
{ "id": "coverage-lines", "point": "changes:diff-line", "label": "Coverage",
  "items": "/v2/p/coverage/lines" }
```

The host POSTs the keys on screen in one request and B answers marks:

```
POST /v2/p/coverage/lines  { "keys": [{ "file": "src/auth.ts", "line": 42, "side": "new" }, …] }
→ { "items": [{ "key": {…}, "severity": "info" | "warn" | "danger", "text": "Not covered by any test", "icon": "shield-off" }] }
```

Batched, so a plugin with two thousand marks answers one request. Display strings only, capped by the
host, the same rule `PluginExtensionItem` has. The lookup is minted from the **owner's** declared
fields in the owner's order, so a contributor cannot widen its own match by inventing a field.
Provenance is stamped on every mark and drawn beside it. A contributor that fails draws nothing for
itself and leaves the others alone: a mark is a note under somebody else's row, and one plugin's outage
must not blank the row.

### Remote trees

Plugin code runs in a sandbox, renders against a fake DOM, and the fake DOM serialises to a tree of the
host's own component names ([The tree contract](descriptors.md#the-tree-contract) owns the wire format, and
`docs/shell.md § The plugin worker` the sandbox). An owner that draws through the tree declares a point as a node:

```tsx
<Slot point="agents:attachment" key={selected?.mime}>
  <AttachmentChip file={selected} />   {/* the default, drawn when nobody matches */}
</Slot>
```

and in its manifest, so the trust prompt can say it:

```json
{ "id": "attachment", "kind": "remote", "label": "Attachment", "mode": "replace", "selector": "mime" }
```

A contributor names the point, the entry its bundle registered with `mountTree`, and what it matches:

```json
{ "id": "agent-images", "point": "agents:attachment", "label": "Image viewer",
  "remote": "attachment", "matches": ["image/png", "image/jpeg"] }
```

The host grafts the contributor's subtree at the slot node. Neither plugin sees the other's nodes, and
the contributor's code has exactly the permissions its own manifest declares — sitting inside A's pane
grants it nothing of A's. **One level only**: a contributor's tree is a stream of kit node names, and
`Slot` is not one of them, so a grafted subtree has no way to open a slot of its own.

**The first-party remote points, and what each hands over.** Props are the owner's own data in the
owner's own words, which is why no two of these agree on a shape:

| Point | Mode | Props |
| --- | --- | --- |
| `agents:tool-card` | `replace`, keyed by tool name | `{ tool, taskId, defaultOpen }` |
| `agents:attachment` | `replace`, keyed by media type | `{ attachment, taskId, sessionId }` |
| `agents:composer-actions` | `stack`, up to four | `{ taskId, sessionId }` |
| `changes:push-actions` | `stack`, up to two | `{ taskId, projectId, branch, upstream, ahead }` |
| `context:section` | `stack`, up to two, keyed by section id | `{ task, onChanged, onPendingChange }` |
| `github:summary-badges` | `stack`, up to four | `{ owner, repo, number }` |

`changes:push-actions` is the one to read if you are opening a point of your own. It sits under the
Changes pane's branch bar and holds what somebody else does once a branch is on its remote, and the
five props are the five scalars the bar itself draws — no markup, and nothing about what a filler is
*for*. The changes plugin cannot say "pull request" and does not learn: the GitHub plugin fills the
point with **Open pull request** and reads the task's pull number off its own task query, because the
owner has no such field to hand over. An owner that had tried to model the filler's job would have
had to import it, which is the coupling the point exists to remove.

With nobody filling it the slot draws nothing and takes no space, which is what lets an owner reserve
room for a plugin the reader has not installed.

**What a slot's tree may reach.** The host hands the contributor's tree the owner's `taskId` and
`projectId`, read-only, as its scope — the same two the host gives a rectangle occupant. Without them a
card drawn in somebody else's pane is inert: `openPane`, in-app `openUrl` and task-scoped key bindings
are all questions about a task, and a tree with no task gets `undefined` from every one of them.

They are the owner's, not the shell's. A project-scoped pane and a reference panel are not looking at a
task even while one is selected in the rail behind them, so reading the ambient task would push a pane
into a background task's layout, where the reader is not. It is the same rule a frame's bridge follows.

The scope is not data. What the owner wants the contributor to *know* goes in the slot's props, where
the owner writes the names; the scope is the host's answer to "where am I", it reaches the bridge and
nowhere else, and the contributor never reads it directly.

#### Asking the owner

Props are data, and that leaves a gap: a contributor drawing a replacement for one of the owner's own
items has no way to ask the owner to change that item. A callback prop cannot cross the worker
boundary, and pretending it could would split what a compiled and a loaded contribution mean.

So an owner declares a closed vocabulary of actions on the point, and binds a handler per `Slot` it
draws:

```json
{ "id": "attachment", "kind": "remote", "label": "Attachment", "mode": "replace",
  "actions": ["replace"] }
```

```tsx
<Slot
  point="agents:attachment"
  key={attachment.mediaType}
  props={() => ({ attachment, taskId, sessionId })}
  actions={{ replace: (payload) => replaceDraftAttachment(attachment.id, payload) }}
>
  <AttachmentChip file={attachment} />
</Slot>
```

A contributor names one:

```ts
await mount.host.invoke('replace', { expectedAttachmentId, replacementAttachmentId })
```

`solidTree` puts `host` on the component's props beside `bridge`, so a Solid tree reaches it as
`props.host` without touching the mount. Both are the same object across a props update, which is what
keeps a handler valid while it is awaiting.

Two lists have to contain the name before the host forwards anything: the point's `actions`, which is
the owner plugin's published contract, and this particular `Slot`'s handler map, which is the
instance's consent. A name in one and not the other is refused. Neither the handlers nor their names
are sent to the worker; a contributor learns which actions exist from the published declaration, names
one, and the host looks it up.

It is a request and not a setter. The owner still decides — the agent composer checks that the id it
was told to expect is still in the slot before it swaps anything — which is why a contributor never
receives a handle to the owner's state.

The bounds: payload and result each under 64 KiB, eight outstanding per slot, ten seconds for the
owner to answer. An action is scoped by the host-held slot id, so plugin code supplies no plugin,
point, owner or target id and there is nothing to forge.

**Binding on the mount, not the bridge.** One worker serves every tree its bundle draws and holds one
bridge, so a composer showing four image attachments has four trees and one port. A request sent over
the bridge could not say which of the four sent it and the host would have to guess from focus. These
ride the tree channel, where the slot is part of the address the host already trusts.

#### Companion overlays

A tree that needs a rectangle — a canvas, an editor, anything with pixels — declares one overlay of its
own plugin's on the extension descriptor:

```json
{ "id": "image-attachment", "point": "agents:attachment", "label": "Image markup",
  "remote": "attachmentPreview", "matches": ["image/png", "image/jpeg"], "overlay": "editor" }
```

```ts
const result = await mount.host.openOverlay('editor', { taskId, attachmentId })
```

`overlay` is a qualifier on the `remote` carrier, never a carrier of its own: a descriptor still names
exactly one of `items`, `remote`, `frame` or `route`. It must name an `overlay` frame the same manifest
declares, and it counts as a valid opener for that frame, so a plugin whose only opener is a companion
overlay passes the "an overlay needs an action that opens it" rule.

One name, not a list. A tree that could name any of its plugin's overlays would have a dispatcher; one
name is a grant a person can read in the manifest at trust time.

Name it as your manifest spells it. The device rewrites a frame id that sits outside your plugin's
namespace to `<pluginId>.<id>`, and rewrites the descriptor's `overlay` reference with it
(client-core/host/plugins/contributionIds.ts), but the string your tree passes is yours. The host
qualifies it the same way before comparing, so `editor` and `my-plugin.editor` both reach the same
frame and neither is refused for naming your own overlay.

The host accepts it only from a person, and at most once a second. Either the shell's focus is inside
that exact tree, or somebody pressed something in it within the last second. Two answers rather than
one because focus alone is not enough: WebKit does not move focus to a button when it is clicked, which
is the behaviour behind macOS's "Keyboard navigation" setting and the platform the desktop shell runs
on, so a focus-only gate meant a click on a kit `Button` could never open an overlay at all. A
background timer produces neither, which is the property being kept. The throttle is the same second
gate `ui.openUrl` has one rung down.

**The result lifecycle.** The overlay store holds an invocation rather than a pair of ids: an id that
keys the iframe, the opener's input, and the waiter. `openOverlay` resolves with whatever the overlay
passed to `bridge.ui.close(result)`, and with `null` for every dismissal — Escape, the backdrop, the
close button, another overlay opening over it, the source tree unmounting, navigating away. An opener
never has to tell "cancelled" from "went away", and nobody is ever left waiting.

Reopening the same overlay builds a fresh iframe keyed by the new invocation id. An editor must never
inherit the previous canvas or the previous input, or the reader has no way to tell which image they
are drawing on.

Input and result are each capped at 64 KiB and are data. An overlay that needs a file gets its id in
the input and fetches the bytes over its own plugin's route.

**A host without overlays** answers `unsupported_host`. The terminal is the case: it mounts remote
trees and has no iframe to put a rectangle in, and this project is not going to invent a cell-drawn
canvas. A contributor catches that code and leaves its static preview up, so the owner's own fallback
is what a reader sees there.

### Rectangles

After remote trees exist, rectangles are for surfaces that own pixels: Monaco, xterm, a canvas, a chart
library, a preview of arbitrary HTML. The point is a region of the owner's pane, and the frame in it may
belong to somebody else.

```json
// A: editor declares a box beside its document
{ "id": "beside", "kind": "rectangle", "label": "Beside the document",
  "location": "pane.inline-beside", "surface": "editor", "mode": "replace", "selector": "path" }

// B: markdown-preview fills it for *.md
"frames": [{ "target": "inline", "id": "preview", "label": "Markdown preview" }],
"extensions": [{ "id": "md-preview", "point": "editor:beside", "label": "Markdown preview",
                 "frame": "preview", "matches": ["*.md", "*.mdx"] }]
```

The two iframes are **siblings**; the host draws both and sits between them. An `inline` frame is
registered in no pane switcher of its own — the only thing that ever draws it is an owner's point,
which is what makes "the owner consents" true of this kind too. A manifest declaring an `inline` frame
that nothing places is a parse error, and so is an extension naming a frame it never declared.

Talking across the box is a hook with one handler, so there is one concept and not two.

### Arbitration: who fills a box

`remote` and `rectangle` points declare one of two modes.

| | `stack` | `replace` |
| --- | --- | --- |
| Occupants | every matching contributor, up to `max` | exactly one: the best match for the `key`, else the owner's default |
| Selector | optional; contributors may still filter with `matches` | required in practice; the owner passes `key` when opening |
| Example | tools beside a note; buttons in a composer | the renderer for the selected attachment |

`matches` takes an exact string, a trailing star as a prefix (`image/*`) or a leading star as a suffix
(`*.md`). A contributor that names none matches every key.

`max` matters for `stack`: each remote contributor is a live subtree and each rectangle contributor is
an iframe. Past `max` the host draws a count of what was left out — a count and no names, because the
owner set the ceiling and listing the losers would invite a person to fix somebody else's arithmetic.

When two contributors match the same key in `replace` mode, the user picks in Settings → Plugins and
**the owner's default draws until they do**. A pick naming a plugin that has stopped matching falls
back to the owner's default rather than to the runner-up: silently promoting the other candidate would
mean the box changed hands because somebody uninstalled something. An override is an offer, not a
seizure.

### What the host binds

None of it can be stated by a manifest:

| | |
| --- | --- |
| the point's public name | `<owner>:<point>`, minted from the plugin the manifest was read under. B cannot advertise a point in A's name. |
| the provenance | every delivered group and every mark is stamped with the **contributing** plugin's id and renders it beside the content. An owner looking at somebody else's items inside a pane can always see whose they are. |
| the fetch | confined to the contributor's own `/v2/p/<id>/`. A contribution cannot make the host read the point owner's routes on its behalf — the "reading another plugin's routes" refusal below is enforced by construction, not by a rule. |
| the gate | nothing is delivered unless **both** plugins are running on the node being looked at, and neither has code this device withheld. A `remote` or `rectangle` contribution additionally needs this device to have accepted the contributor's bundle, exactly as a pane does. |

**Descriptors cross; code does not.** The rows are drawn by the host, with the shell's own `Row`,
`Badge`, `SectionHeader` and `Icon`, in host markup that sits *outside* A's iframe. A never receives
B's data and B never touches A's document. That is the same rule
[first-party-plugins.md](../first-party-plugins.md) gives for why in-realm composition is banned, applied
one level up, and it is why this is an extension point rather than a hole.

**An unmatched contribution is silent.** A point that is not there — A not installed, disabled on this
node, its bundle refused here, or A dropped the point in an update — delivers nothing. No error, no
warning, nothing to catch. The two halves come from two manifests registered in an order nobody
controls, so a contribution never resolves its point at registration time; delivery is resolved at read
time, and "there is nobody on both ends of this pipe today" is one outcome with one behaviour.

Both directions appear in the trust prompt under **Enforced**, and both are recorded against the
decision so a version that starts reaching into a *different* package, or bringing a *different kind*
of thing, reads as newly requested rather than sliding past unremarked.

### Seeing what matched

Silent-when-absent is right for a user and the worst possible thing for an author: a typo in `point`
produces an empty pane and no error. **Settings → Plugins** lists every point on this node, its kind
and mode, and who fills it; every contribution whose point nobody declares, with a nearest-name
suggestion; and, for a tied `replace` slot, the picker that settles it. It reads the same registries the
hosts read and adds no bridge verb, so it can never disagree with what is on screen.
