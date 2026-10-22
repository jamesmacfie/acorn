# Remote points

This page covers the two code-bearing kinds of [cooperative extension
point](./cooperative-extension-points.md): a remote tree drawn inside another plugin's surface, and a
rectangle placed beside it. It also covers how a tree asks its owner or the host for something. It's
part of the [plugin reference](../plugins.md).

## Remote points

A compiled owner opens a point by drawing a `Slot` from `@acorn/plugin-api/ui/host` in its own view,
with its default as the child:

```tsx
<Slot point="agents:attachment" key={attachment.mediaType} props={() => ({ attachment, taskId, sessionId })}>
  <AttachmentChip file={attachment} />   {/* the default, drawn when nobody matches */}
</Slot>
```

It registers the point with `kind`, `mode`, and `max`, so the trust prompt and the Extension points
page can name it. A loaded owner declares the same fields in its manifest, but its tree can't draw a
`Slot`: the SDK's `Slot` takes only a host-minted `slotRef`. A loaded owner gets host-drawn regions
above or below its own views instead ([detail regions](./detail-regions.md)).

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
| `agents:transcript-attachment`, `agents:artifact` | `replace`, keyed by media type | `{ taskId, sessionId, media }`. The body of a sent attachment's tile or an artifact card. See [transcript media viewers](../managed-agents/attachments.md#transcript-media-viewers) |
| `agents:composer-actions` | `stack`, up to four | `{ taskId, sessionId }` |
| `agents:session-header` | `stack`, up to two | `{ taskId, sessionId, providerId, tokenAccounting, costAccounting, turns }` |
| `agents:request-card` | `stack`, up to two | `{ taskId, sessionId, requestId, kind, title }` |
| `editor:document` | `replace`, keyed by lowercased file basename | `{ taskId, path, text?, revision }`. See [file renderers](../editor/file-renderers.md) |
| `workflows:step-body` | `replace`, keyed by the step's exact kind | `{ taskId, projectId, runId, stepId, kind, status, inputs, inputsTruncated, output, outputTruncated, tail?, revision }`. A step's result in the run pane. See [contributed step bodies](../workflows/routes-and-ui.md#contributed-step-bodies) |
| `git:push-actions` | `stack`, up to two | `{ taskId, projectId, branch, upstream, ahead }` |
| `context:section` | `stack`, up to two, keyed by section id | `{ task, onChanged, onPendingChange }` |
| `docker:stats-beside` | `stack`, up to two | `{ container }` |
| `github:summary-badges` | `stack`, up to four | `{ owner, repo, number }` |
| `gitlab:summary-badges` | `stack`, up to four | `{ owner, repo, number }`, where `owner` is the group path |
| `bitbucket:summary-badges` | `stack`, up to four | `{ owner, repo, number }`, where `owner` is the workspace |
| `core:storage` | `stack`, up to four | `{ nodeId }` |
| `core:security` | `stack`, up to four | `{ nodeId }`. A section on **Settings > Security and backup**. Agents draws its instruction file check |
| `core:plugin-page` | `stack`, up to four | `{ pluginId, nodeId }`. A section on one plugin's **Permissions** tab in Settings > Plugins. Agents draws which harnesses the plugin's tool hooks reach |
| `core:link-preview` | `replace`, keyed by the normalized HTTPS URL | `{ url, label?, taskId?, projectId?, ref? }`. See [link previews](./link-previews.md) |
| `core:markdown-fence` | `replace`, keyed by a closed fence's lowercased language hint | `{ blockId, language, text, revision, taskId?, projectId? }`. See [Markdown fences](./markdown-fences.md) |
| `preview:toolbar-actions`, `terminal:toolbar-actions` | `stack`, up to four | Page or selected-session facts, with `reload` or `interrupt`. See [toolbar actions](./toolbar-actions.md) |
| `linear:issue-summary`, `rollbar:item-summary` | `stack`, up to two | `{ surface, item?, refId?, projectId? }`. Above a loaded owner's detail view, drawn by the host. See [detail regions](./detail-regions.md) |

Read `git:push-actions` before you open a point of your own. It sits under the Changes tab's
branch bar, and its props are the five scalars the bar draws. The git plugin can't say "pull
request". The GitHub plugin fills the point with **Open pull request** and reads the task's pull
number from its own query. An owner that modeled its filler's job would have to import it. With
nobody filling it, a slot draws nothing and takes no space.

`agents:session-header` shows derived UI over owner-held facts. Agents folds its event ledger, prices
each turn's model from the reader's preferences, and says whether a provider's counters replace or
add. The `agent-cost` loaded plugin, not Agents, works out a cost, in its own worker.

`agents:request-card` draws inside a request card while it waits on the person, below the card's own
buttons. It decorates the card and never replaces it, so no contributor draws or presses an answer.
The `requestId` is the one `agents:before-permission` and `agents.requests` name, so a policy plugin such as
`acorn-permission-policy` can draw why it let a risky request through. A code the person types waits on a hook verdict that asks.

The host gives the contributor's tree the owner's `taskId` and `projectId` as its scope, read-only.
Without them, `openPane`, in-app `openUrl`, and task-scoped key bindings would have no task. The scope
is the owner's, not the shell's, so a project pane or reference panel never pushes a pane into a
background task. The scope reaches the bridge only. What the contributor should know goes in props.

[Link previews](./link-previews.md) has `core:link-preview`, the point for previews of HTTPS links.

## Asking the owner

Props are data, so a contributor drawing a replacement for one of the owner's items can't change that
item through them. An owner declares a closed list of actions on the point, and binds handlers per
`Slot`:

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
`solidTree` puts `host` on the component's props beside `bridge`, and a compiled contributor gets the
same `host` prop. Each stays the same object across a props update.

The host forwards a name only when both the point's `actions` and this `Slot`'s handler map contain
it. Neither list is sent to the worker. It's a request, not a setter: the owner still decides. Payload
and result are each under 64 KiB, eight may be outstanding per slot, and the owner has 10 seconds to
answer. The action is scoped by the host-held slot id, so plugin code supplies no plugin, point,
owner, or target id. These requests ride the tree channel, not the bridge, because one worker holds
one bridge for every tree it draws and the slot is part of the address the host trusts. A handler's
second argument is `{ byPerson }`, true only when a person pressed or typed inside that contributor in
the last second. A person-only action refuses without it, as [toolbar actions](./toolbar-actions.md) do.

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
catch that code and leave your static preview up. A phone answers it too when the overlay's `formFactor`
leaves out `mobile`.

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
