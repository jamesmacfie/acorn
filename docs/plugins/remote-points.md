# Remote points

This page covers the two code-bearing kinds of [cooperative extension
point](./cooperative-extension-points.md): a remote tree drawn inside another plugin's surface, and a
rectangle placed beside it. It also covers how a tree asks its owner or the host for something. It's
part of the [plugin reference](../plugins.md).

## Remote points

An owner that draws through the tree declares a point as a node:

```tsx
<Slot point="agents:attachment" key={selected?.mime}>
  <AttachmentChip file={selected} />   {/* the default, drawn when nobody matches */}
</Slot>
```

It also declares the point in its manifest, so the trust prompt can name it:

```json
{ "id": "attachment", "kind": "remote", "label": "Attachment", "mode": "replace", "selector": "mime" }
```

A contributor names the point, the entry its bundle registered with `mountTree`, and what it matches:

```json
{ "id": "agent-images", "point": "agents:attachment", "label": "Image viewer",
  "remote": "attachment", "matches": ["image/png", "image/jpeg"] }
```

The host grafts the contributor's subtree at the slot. Neither plugin sees the other's nodes, and the
contributor has only the permissions its own manifest declares. Grafting is one level deep: a
contributor gets no slot reference, so a grafted subtree can't open a slot of its own.

A compiled plugin fills the same points with a `component` carrier, registered through
`ctx.extensions`. From the owner's side and the trust prompt's, the two are one thing: another
plugin's tree of kit nodes in a slot the owner reserved. A loaded plugin's tree crosses as node names
from a worker, and a compiled component is mounted in process. The owner writes one `Slot` either way.

The first-party remote points hand over the owner's own data in the owner's own words:

| Point | Mode | Props |
| --- | --- | --- |
| `agents:tool-card` | `replace`, keyed by tool name | `{ tool, taskId, defaultOpen, fileChanges? }` |
| `agents:attachment` | `replace`, keyed by media type | `{ attachment, taskId, sessionId }` |
| `agents:composer-actions` | `stack`, up to four | `{ taskId, sessionId }` |
| `agents:session-header` | `stack`, up to two | `{ taskId, sessionId, providerId, tokenAccounting, costAccounting, turns }` |
| `changes:push-actions` | `stack`, up to two | `{ taskId, projectId, branch, upstream, ahead }` |
| `context:section` | `stack`, up to two, keyed by section id | `{ task, onChanged, onPendingChange }` |
| `docker:stats-beside` | `stack`, up to two | `{ container }` |
| `github:summary-badges` | `stack`, up to four | `{ owner, repo, number }` |
| `core:storage` | `stack`, up to four | `{ nodeId }` |

Read `changes:push-actions` before you open a point of your own. It sits under the Changes pane's
branch bar, and its props are the five scalars the bar draws. The Changes plugin can't say "pull
request". The GitHub plugin fills the point with **Open pull request** and reads the task's pull
number from its own query. An owner that modeled its filler's job would have to import it. With
nobody filling it, a slot draws nothing and takes no space.

`agents:session-header` shows derived UI over owner-held facts. Agents folds its event ledger,
resolves each turn's model against the reader's price preferences, and says whether a provider's
counters replace or add. It doesn't calculate a cost. The `agent-cost` loaded plugin does that in its
own worker.

The host gives the contributor's tree the owner's `taskId` and `projectId` as its scope, read-only.
Without them, `openPane`, in-app `openUrl`, and task-scoped key bindings would have no task. The scope
is the owner's, not the shell's, so a project pane or reference panel never pushes a pane into a
background task. The scope reaches the bridge only. What the owner wants the contributor to know goes
in the slot's props.

## Asking the owner

Props are data, so a contributor drawing a replacement for one of the owner's items can't change that
item through them. An owner declares a closed list of actions on the point, and binds a handler for
each `Slot` it draws:

```json
{ "id": "attachment", "kind": "remote", "label": "Attachment", "mode": "replace", "actions": ["replace"] }
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

A contributor names one with `await mount.host.invoke('replace', { expectedAttachmentId, replacementAttachmentId })`.
`solidTree` puts `host` on the component's props beside `bridge`, and both stay the same object across
a props update.

The host forwards a name only when both the point's `actions` and this `Slot`'s handler map contain
it. Neither list is sent to the worker. It's a request, not a setter: the owner still decides. Payload
and result are each under 64 KiB, eight may be outstanding per slot, and the owner has 10 seconds to
answer. The action is scoped by the host-held slot id, so plugin code supplies no plugin, point,
owner, or target id. These requests ride the tree channel, not the bridge, because one worker holds
one bridge for every tree it draws and the slot is part of the address the host trusts.

## Companion overlays

A tree that needs a rectangle, such as a canvas, declares one overlay of its own plugin on the
extension:

```json
{ "id": "image-attachment", "point": "agents:attachment", "label": "Image markup",
  "remote": "attachmentPreview", "matches": ["image/png", "image/jpeg"], "overlay": "editor" }
```

```ts
const result = await mount.host.openOverlay('editor', { taskId, attachmentId })
```

`overlay` qualifies the `remote` carrier. It isn't a carrier of its own. It must name an `overlay`
frame the same manifest declares, and it counts as an opener for that frame. Name it as your manifest
spells it. The host qualifies it the same way the device rewrites ids, so `editor` and
`my-plugin.editor` reach the same frame.

The host accepts it only from a person, at most once a second: focus must be inside that tree, or
somebody pressed something in it within the last second. Focus alone isn't enough, because WebKit
doesn't move focus to a clicked button.

`openOverlay` resolves with whatever the overlay passed to `bridge.ui.close(result)`, and with `null`
for every dismissal: Escape, the backdrop, the close button, another overlay opening, the tree
unmounting, or navigating away. There's no deadline, because a person editing an image takes as long
as they take. Reopening builds a fresh iframe, so an editor never inherits the previous input. Input
and result are each capped at 64 KiB. Pass an id and fetch bytes over your own route.

A host without overlays answers `unsupported_host`. The terminal mounts trees but has no iframe, so
catch that code and leave your static preview up.

## Rectangles

Rectangles are for surfaces that own pixels: a canvas, a chart library, a terminal emulator, or a
preview of arbitrary HTML. The point is a region of the owner's pane, and the frame in it may belong
to another plugin:

```json
// A: editor declares a box beside its document
{ "id": "beside", "kind": "rectangle", "label": "Beside the document",
  "location": "pane.inline-beside", "surface": "editor", "mode": "replace", "selector": "path" }

// B: markdown-preview fills it for *.md
"frames": [{ "target": "inline", "id": "preview", "label": "Markdown preview" }],
"extensions": [{ "id": "md-preview", "point": "editor:beside", "label": "Markdown preview",
                 "frame": "preview", "matches": ["*.md", "*.mdx"] }]
```

The two iframes are siblings, and the host draws both. An `inline` frame appears in no pane switcher.
Only an owner's point draws it, so a manifest declaring an `inline` frame that nothing places is a
parse error, and so is an extension naming a frame it never declared. Talking across the box is a
hook with one handler.
