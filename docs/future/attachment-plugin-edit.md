# Editing an agent attachment from a loaded plugin

Status: proposal, 2026-09-04. Not started.

Written and checked against `0141ebd3`. Every path and claim below was read out of the tree at that
commit, so treat them as facts with a date rather than as guesses. The closing section lists what to
reread if a later commit moves any of it.

## Decision

Build this as a **bundled loaded plugin**, tentatively `image-markup`, after adding three small,
general-purpose platform seams:

1. a remote tree may open a manifest-associated overlay and await a bounded result;
2. a remote tree may invoke a bounded action declared by the extension-point owner; and
3. a sandbox bridge may send and receive bounded byte bodies through the plugin's own Node route.

The plugin contributes a native-looking replacement for `agents:attachment` when the attachment is a
PNG or JPEG. Pressing that preview opens a host-chromed overlay whose iframe owns a canvas. The editor
supports a pen, text, undo, redo, reset, Apply, and Cancel. Apply uploads a **new** content-addressed
attachment, returns its id to the remote contribution, and asks the agent composer to replace the old
draft attachment with the new one. The composer remains the only owner of its draft. When the turn is
queued, the existing managed-agent path resolves the replacement id, so the harness receives the
altered image and never sees the superseded original.

Do not make the editor a compiled plugin merely to get callbacks or bytes. The attachment point and
overlay frame were designed for this shape; the missing pieces are platform contracts, not a reason to
move third-party code into the renderer process.

## What exists now

The current path is already close to the desired one.

1. `AgentComposer` holds `AgentAttachment[]` as local draft state and persists the attachment ids in
   local storage per session.
2. `AttachmentSlot` opens the remote, `replace`-mode `agents:attachment` point keyed by media type. Its
   own comment names an image editor as the motivating example.
3. A loaded plugin can match `image/png` and replace the default chip with a remote tree. The tree gets
   only `{ attachment, taskId }`; functions cannot cross its worker boundary.
4. Uploading an attachment writes an immutable, task-scoped row and a content-addressed blob. The
   store deduplicates on `(taskId, contentHash)`.
5. Sending a turn writes an image input part containing the attachment id. The server verifies that it
   is unreferenced, belongs to the task, and fits the count and byte ceilings, then creates the turn's
   attachment reference.
6. At dispatch, the managed runtime resolves the id to a local path. The Codex driver sends a
   `localImage`; the ACP driver sends a `resource_link` with its MIME type and size.

That last half needs no redesign. Replacing the id before enqueue is sufficient to change the image
the agent receives.

The present blockers are precise:

| Missing seam | Why the current API is insufficient |
| --- | --- |
| Slot-bound action | Remote props are structured data. The plugin can draw an Edit button but cannot call `setAttachments` or otherwise ask the owner to replace one draft item. |
| Parameterised overlay | An overlay is currently opened only by a manifest command. It has no invocation input and returns no result. A command cannot identify the attachment whose preview was pressed. |
| Binary bridge | The frame API JSON-stringifies request bodies and discards non-JSON response bodies. Base64 would add copies and roughly one-third wire overhead to images already allowed to reach 10 MiB. |
| Attachment bytes capability | The agents route exposes upload, metadata, and unreferenced delete, but deliberately exposes no attachment-content download. Another loaded plugin also cannot call `/v2/p/agents/*` through its frame bridge. |

The cross-plugin route refusal is correct and must remain. `image-markup` should reach attachment data
through an agents-owned Node capability, then expose only the narrow operations it needs on its **own**
route namespace.

## Scope

### MVP

- Match `image/png` and `image/jpeg` attachments on unsent interactive turns.
- Preserve the current compact attachment presentation shown in the composer: image glyph, filename,
  byte size, and the owner's existing remove affordance. The plugin's portion is pressable and labelled
  “Edit image”. This is a richer version of the current metadata chip, not a bitmap thumbnail.
- Open one full-screen, host-chromed editor overlay.
- Draw freehand strokes with a mouse, trackpad, stylus, or touch pointer.
- Add single- or multi-line text at a chosen image coordinate.
- Choose a small fixed colour palette and pen width.
- Undo, redo, and reset all alterations without damaging the source.
- Apply by creating a replacement attachment and atomically replacing the draft id.
- Cancel, backdrop dismissal, Escape, navigation, and removal of the source attachment leave the
  original draft unchanged.
- Run as a loaded plugin in the desktop DOM host. In the TUI the ordinary attachment chip remains.

### Explicitly out of scope

- Cropping, resizing, selections, fills, shapes, layers, erasing, filters, colour picking, or image
  generation.
- Editing PDF, GIF, or WebP. GIF and WebP may be animated; silently flattening them would be data loss.
- A bitmap thumbnail inside the remote preview. The closed kit has no image node today. Adding one is
  a separate proposal if the compact metadata preview proves insufficient.
- Editing an attachment after its turn has been queued. Referenced attachments are immutable evidence
  of what was sent.
- Saving into the worktree or overwriting the user's source file.
- A generic media-asset service or cross-plugin access to the agents route namespace.
- Collaboration or persisted editor sessions. Unapplied operations live only in the overlay iframe.

## Ownership and invariants

| Concern | Owner | Invariant |
| --- | --- | --- |
| Draft order and membership | `plugins/agents` client | A contributor may request one declared action; it never receives a setter or a handle to the draft array. |
| Attachment validation and blobs | `plugins/agents` Node half | Stored content is immutable and content addressed. Replacement always creates or deduplicates a new attachment row. |
| Canvas pixels and edit history | `image-markup` overlay | Raw DOM, pointer events, and canvas stay inside the sandboxed iframe. |
| Cross-plugin attachment access | `agents.draftAttachments` capability | Only task-owned, still-unreferenced draft attachments may be read or used as replacement sources. |
| UI placement and dismissal | client-core | The host owns the overlay backdrop, title, close affordance, focus trap, and one-overlay-at-a-time rule. |
| Agent input | existing managed-agent runtime | Only the attachment id present when enqueue validates the draft becomes a turn reference and reaches a driver. |

Five invariants deserve tests rather than comments:

1. Stored attachment bytes are never modified in place.
2. A replacement request is compare-and-swap: the expected source id must still occupy that exact
   attachment slot.
3. A plugin cannot open an overlay that its own extension descriptor did not associate with that
   remote contribution.
4. A tree cannot invoke an action the owner did not declare and bind for that point.
5. No image bytes are encoded as JSON, base64, a data URL, or a tree prop at any stage.

## End-to-end flow

```text
file picker
  -> agents attachment store (original immutable attachment A)
  -> AgentComposer draft [A]
  -> agents:attachment slot
  -> image-markup remote preview
       | press Edit (the exact mounted slot is known to the tree channel)
       v
     host overlay -> image-markup iframe
       -> GET /v2/p/image-markup/draft-attachments/A/content
       -> image-markup node -> agents.draftAttachments.read(A)
       -> canvas operations in iframe
       -> POST edited bytes to /v2/p/image-markup/draft-attachments/A/replacements
       -> image-markup node -> agents.draftAttachments.createReplacement(A, bytes)
       -> replacement immutable attachment B
       -> overlay closes with { replacementAttachmentId: B }
       -> remote preview invokes owner action replace(A, B)
       -> AgentComposer verifies A is still in that slot, persists [B], then removes unreferenced A
       -> enqueue uses B
       -> existing runtime resolves B to the edited local image
       -> agent receives the altered image
```

No server transaction can include the client-local draft array. Atomic here therefore means a
compare-and-swap at the draft owner: either the expected id is replaced once, or nothing changes. The
new unreferenced attachment may temporarily remain after a crash or stale result; the existing
unreferenced-attachment garbage collector is the correct recovery path.

## Platform seam 1: slot-bound tree requests

Do not add `openOverlay` to the existing per-bundle `AcornBridge` and call it from the preview worker.
One worker serves every mounted tree from a bundle, while the bridge is connected once by the first
mount. A task may show several image previews simultaneously; the bridge alone cannot reliably prove
which mounted preview has focus or which attachment initiated the request.

Extend `TreeMount` with a slot-bound request surface instead:

```ts
type TreeMount = {
  // existing fields
  readonly host: {
    invoke<TResult = unknown>(action: string, payload?: unknown): Promise<TResult>
    openOverlay<TResult = unknown>(overlayId: string, input?: unknown): Promise<TResult | null>
  }
}
```

The names are illustrative, but the two operations must remain separate: `invoke` calls the owner of
the extension point; `openOverlay` asks the shell to present this contributor's own frame. Neither is
an arbitrary RPC dispatcher.

### Owner actions

Add an optional, bounded action vocabulary to a `remote` extension point. A simple string array is
enough:

```json
{
  "id": "attachment",
  "kind": "remote",
  "label": "Agent turn attachment",
  "mode": "replace",
  "selector": "mediaType",
  "actions": ["replace"]
}
```

`Slot` gains a host-only action map; it is never included in the props sent to the worker:

```ts
<Slot
  point="agents:attachment"
  key={attachment.mediaType}
  props={() => ({ attachment, taskId, sessionId })}
  actions={{
    replace: (payload) => replaceDraftAttachment(attachment.id, payload),
  }}
>
  ...
</Slot>
```

The host accepts a request only when all of these are true:

- the slot is still mounted;
- the action is declared by the owning extension point;
- that `Slot` instance supplied a handler of the same name;
- the payload and eventual result each serialize to no more than 64 KiB; and
- the slot has fewer than eight owner-action requests in flight.

Use a 10-second owner-action deadline. Return a small structured error to the plugin, without a host
stack. On unmount, reject outstanding requests and ignore late handler results. An action is scoped by
the worker's host-held slot id; plugin code supplies no plugin id, point id, owner id, or target slot.

Add correlated tree messages in `packages/protocol/src/tree/messages.ts` rather than sending these
over the frame bridge. One viable wire shape is:

```ts
// sandbox -> host
{ kind: 'tree:host-request', slot, id, op: 'owner.invoke', name, payload }
{ kind: 'tree:host-request', slot, id, op: 'overlay.open', name, payload }

// host -> sandbox
{ kind: 'tree:host-reply', slot, id, ok: true, body }
{ kind: 'tree:host-reply', slot, id, ok: false, error: { code, message } }
```

Use one request id sequence per worker and a pending map per mounted slot in the SDK. Measure request
and reply bytes before posting, as tree mutation batches already do. Unknown operations, actions, and
overlay ids are denied; they are not forwarded and then ignored.

### Associated overlays

Add an optional `overlay` field to a remote extension descriptor:

```json
{
  "id": "image-attachment",
  "point": "agents:attachment",
  "label": "Image markup",
  "remote": "attachmentPreview",
  "matches": ["image/png", "image/jpeg"],
  "overlay": "editor"
}
```

The field is valid only with the `remote` carrier and must name an `overlay` frame in the same
manifest. It counts as a valid opener for the existing “an overlay must be reachable” manifest rule.
The client contribution projection must retain it so `RemoteTree` can bind that **one association** to
the mounted slot. Do not hand the worker a list of every overlay in the plugin.

`mount.host.openOverlay('editor', input)` is accepted only while focus is within that exact
`RemoteTree` container, and at most once per second per slot. This makes opening a modal a person's
act and fixes the ambiguity the bundle-level bridge would introduce. A background timer is denied.

The overlay store changes from `{ pluginId, surface } | null` to an invocation record containing:

```ts
type OverlayInvocation = {
  id: string
  pluginId: string
  surface: string
  source: { workerHash: string; slot: string }
  input: unknown
  settle(result: unknown | null): void
}
```

Only one invocation remains open globally. Opening another settles the previous one with `null`.
Backdrop, close button, Escape, source-slot unmount, plugin removal, and navigation away all settle
with `null`. Reopening the same overlay creates a fresh iframe keyed by invocation id; an editor must
never inherit the previous canvas or the previous input.

Add optional invocation input to the overlay frame's `PluginFrameContext`, bounded to 64 KiB. Extend
`bridge.ui.close()` to accept an optional JSON result on overlay surfaces:

```ts
bridge.context.input // overlay invocation only
await bridge.ui.close({ replacementAttachmentId })
```

Importer `close()` retains its no-result behavior. A non-overlay surface supplying a result is denied.
The result is bounded to 64 KiB, settled exactly once, and delivered only to the source tree request;
it is not an event and is not globally observable.

For TUI, do not emulate a canvas. The DOM host accepts `overlay.open`; a host without overlay-frame
support answers a typed `unsupported_host` error. The preview should render its Edit button only when
the host advertises this operation; until the tree protocol has feature discovery, catching that
error and leaving the static preview is acceptable. The owner's fallback chip remains the default on
a host that does not mount the contribution.

## Platform seam 2: bounded binary bridge calls

Keep the five JSON methods unchanged and add explicit byte methods to the published SDK:

```ts
type PluginByteResponse = {
  bytes: Uint8Array
  type: string
  filename: string | null
}

bridge.api.getBytes(
  path: string,
  options?: { signal?: AbortSignal },
): Promise<PluginByteResponse>

bridge.api.postBytes<T>(
  path: string,
  body: { bytes: Uint8Array; type: string; filename?: string },
  options?: { signal?: AbortSignal },
): Promise<T>
```

This feature needs no streaming API. The desktop broker already fully buffers Node responses, and the
agents store already caps one attachment at 10 MiB. Add a bridge ceiling of 12 MiB in either binary
direction: large enough for the existing attachment limit plus envelope overhead, small enough to be
an explicit memory bound. The agents store's 10 MiB ceiling remains authoritative.

Use distinct bridge messages and replies so existing JSON requests cannot accidentally acquire byte
semantics:

```ts
{ kind: 'api.bytes', id, method: 'GET', path }
{ kind: 'api.bytes', id, method: 'POST', path, bytes, type, filename? }

{ kind: 'api.bytes.reply', id, ok: true, status, bytes, type, filename? }
```

Failures continue to use the existing error envelope. Apply the existing route-scope decision before
looking at the byte body. `image-markup` may call `/v2/p/image-markup/*` because it is its own
namespace; `/v2/p/agents/*` must still be refused even if requested through the byte method.

Most of the host half is already written, which makes this the smallest of the three seams.
`packages/client-core/src/infra/node/apiClient.ts` carries an `ApiResponse` whose body is a
`Uint8Array` all the way from the broker, its `send` accepts a `{ kind: 'bytes', bytes }` body, and
its `readBytes` returns `{ bytes, type, filename }`, which is `PluginByteResponse` under another
name. Only two things stand between that and a frame: `frameServices.fetch` hard-codes
`content-type: application/json` and `JSON.stringify`, and `sendRaw` catches the parse failure and
throws a non-JSON success body away on purpose. So the work is a second `frameServices` method over
transport that already carries bytes, not new transport.

The scope gate is `allowApi(binding, method, path)` in
`packages/client-core/src/host/frames/scopes.ts`. It allows `/v2/p/<own id>/` and denies any other
`/v2/p/` prefix outright, before consulting the route table. The byte handler must call it at the
same point the JSON handler does, which is before the body is touched at all: `broker.ts` posts the
denial without ever reaching `services.fetch`, and the desktop end-to-end suite asserts that by
spying at the broker.

`frameServices` should call that raw transport with `{ kind: 'bytes', bytes }` and return response
headers and bytes without a JSON parse. Transfer an `ArrayBuffer` across each
`MessagePort` where the runtime permits it. Slice a view before transfer when detaching the caller's
backing buffer would be surprising. Abort follows the existing request-cancellation path.

Validate `type` as a short MIME string and `filename` as a short display value, but do not trust either
for attachment acceptance. The receiving attachment store repeats MIME magic-byte validation and safe
filename normalization.

Because these additions enlarge the published plugin API without removing anything, they should not
force an API-major bump under the present compatibility rule. The plugin and platform should ship in
the same bundled release. Before publishing `image-markup` independently, add a manifest feature-floor
mechanism or bump the API major; `apiVersion: "10"` alone cannot distinguish an older API-10 host that
lacks these additive methods.

## Agents-owned draft attachment capability

Add a contract beside the agents plugin's other capability contracts, for example
`plugins/agents/src/contract/draftAttachments.ts`, and catalogue it in `packages/plugin-types` for
loaded consumers:

```ts
export type DraftAttachmentBytes = {
  attachment: AgentAttachment
  bytes: Uint8Array
}

export type CreateDraftAttachmentReplacement = {
  taskId: string
  sourceAttachmentId: string
  filename: string
  mediaType: 'image/png' | 'image/jpeg'
  bytes: Uint8Array
}

export type DraftAttachmentsCapability = {
  read(input: {
    taskId: string
    attachmentId: string
  }): Promise<DraftAttachmentBytes | null>

  createReplacement(
    input: CreateDraftAttachmentReplacement,
  ): Promise<AgentAttachment>
}

export const AGENTS_DRAFT_ATTACHMENTS =
  capabilityId<DraftAttachmentsCapability>('agents.draftAttachments')
```

Both methods must load rows by `(taskId, attachmentId)` and require the source to have no turn
reference. `read` uses the store's resolved local path internally and returns a copy of the bytes;
the local path never crosses the capability. `createReplacement` rechecks the source immediately
before writing, accepts only PNG/JPEG, and delegates to the same validation, hashing, deduplication,
safe-name, and storage-key logic used by ordinary upload.

Do not put “replace the draft” or “delete the source” on this Node capability. The draft is client
state, and deletion before the client commits its compare-and-swap can lose the user's only valid
attachment. The capability creates a candidate replacement; the owner action commits it.

Register the capability in the agents plugin and retain/dispose its handle like the other provided
capabilities. A loaded consumer declares:

```json
{
  "requires": { "plugins": [{ "id": "agents" }] },
  "permissions": {
    "node": {
      "capabilities": ["agents.draftAttachments"]
    }
  }
}
```

Resolve it at route-call time, never during plugin init. If agents is disabled or the capability is
unavailable, return a retryable `dependency_unavailable` envelope. The `requires.plugins` declaration
should normally prevent this, but reload and disable transitions still exist.

## The `image-markup` loaded plugin

### Package shape

Create a normal workspace plugin package, using existing loaded packages as the pattern:

```text
plugins/image-markup/
  acorn-plugin.config.mjs
  package.json
  src/
    contract/routes.ts
    node/index.ts
    server/routes.ts
    client/index.ts
    client/preview/AttachmentPreview.tsx
    client/editor/ImageEditor.ts
    client/editor/editor.css
    client/editor/model.ts
    client/editor/model.test.ts
```

Names may move to match conventions discovered at implementation time. The separation is the
important part: pure edit operations and coordinate math in `model.ts`, DOM/canvas lifecycle in the
editor, remote tree preview in its own component, and Node capability adaptation in the server.

The builder emits one client bundle for both runtimes. Its entry must branch before mounting:

```ts
if (typeof document === 'undefined') {
  mountTree({ attachmentPreview: solidTree(AttachmentPreview) })
} else {
  mountFrame({ styles }, mountImageEditor)
}
```

Calling both unconditionally is wrong: the iframe handshake has no tree port, and the worker has no
DOM.

The manifest/config contributes:

- one remote extension of `agents:attachment`, matching only PNG and JPEG;
- one associated `overlay` frame named `editor`;
- a Node entry and client entry;
- `requires.plugins: [{ id: 'agents' }]`;
- the `agents.draftAttachments` Node capability permission;
- no core API scope, events, secrets, exec, network, storage migration, source, pane, command, or
  keybinding.

Add `image-markup` to `apps/desktop/scripts/build-bundled-plugins.mjs` only after all platform and
plugin tests pass. Do not add it to the compiled client or Node plugin rosters.

### Plugin-owned routes

The plugin exposes two routes in `/v2/p/image-markup/`:

| Method and path | Behavior |
| --- | --- |
| `GET /draft-attachments/:attachmentId/content?taskId=...` | Resolve `agents.draftAttachments` and return bytes with `Content-Type`, `Content-Length`, `Content-Disposition: attachment`, and `Cache-Control: no-store`. |
| `POST /draft-attachments/:attachmentId/replacements?taskId=...` | Accept a raw byte body plus bounded MIME and filename headers, call `createReplacement`, and return `{ attachment }`. |

Use route helpers/constants shared by the plugin's node and client halves so path spelling cannot
drift. Validate task and attachment ids before capability dispatch. Body reading must stop at the
bridge/server limit rather than buffering an unbounded stream. Do not accept an arbitrary source id in
the JSON response path: the source is the route parameter and is rechecked by agents.

The routes do not need a plugin database. They are adapters from a sandbox-safe namespace to an
agents-owned capability.

### Preview contract and behavior

Change `AttachmentSlot` so the contributor receives:

```ts
{
  attachment: AgentAttachment
  taskId: string
  sessionId: string
}
```

The plugin must treat this as untrusted changing input. Its preview rerenders when the slot props
change, cancels any stale operation, and labels the pressable control with the attachment filename.
The owner must continue to draw and own removal; do not give the plugin a `remove` action merely to
recreate the existing ×. Concretely, refactor `AttachmentSlot` into an owner-drawn wrapper containing
(a) the replaceable preview `Slot` and (b) a host `Button` for removal. The fallback chip no longer
owns `onRemove`; the external button does. This keeps removal available when a contributor replaces
the preview and keeps its callback out of worker props.

On Edit:

1. call `mount.host.openOverlay('editor', { taskId, attachmentId, filename, mediaType, byteSize })`;
2. ignore a `null` result;
3. validate the result shape and require a non-empty replacement id;
4. call `mount.host.invoke('replace', { expectedAttachmentId, replacementAttachmentId })`;
5. show an inline failure or toast if commit fails; and
6. do not optimistically redraw against the replacement until the owner updates the slot props.

The owner action in `AgentComposer` must:

- mark that attachment slot as replacing and disable Submit for the duration;
- require `expectedAttachmentId` to equal the id currently at the captured array index;
- fetch replacement metadata through the existing agents client API;
- require the replacement to belong to the same task, remain unreferenced, have an accepted image
  MIME, and keep draft count/aggregate-size limits valid;
- replace exactly that array element, preserving order;
- synchronously persist the new attachment-id draft before attempting cleanup;
- call `removeUnreferenced` for the old id only after the new draft is durable; and
- clear the replacing state in `finally`.

If old cleanup fails, keep the successfully committed replacement and let garbage collection recover
the old row. If validation or compare-and-swap fails, keep the original and best-effort delete the
unreferenced candidate replacement. Sending and removing should both be disabled for the slot while
the compare-and-swap runs.

### Editor model

Decode with `createImageBitmap(new Blob(...))`; this bakes JPEG orientation into the rendered pixel
dimensions on supported desktop engines. Refuse before allocating the backing canvas when either
dimension exceeds 8,192 pixels or total decoded area exceeds 40 megapixels. Keep these as named,
tested constants and display an actionable error. The byte ceiling alone does not prevent a compressed
image from exhausting renderer memory.

Use one immutable base bitmap plus a serializable operation list:

```ts
type Point = { x: number; y: number }

type EditOperation =
  | { kind: 'stroke'; color: string; width: number; points: Point[] }
  | { kind: 'text'; color: string; size: number; at: Point; text: string }
```

Coordinates and widths are in source-image pixels, not CSS pixels. Convert every pointer coordinate
using the displayed canvas bounding rectangle and current zoom. Use `setPointerCapture` for a stroke;
ignore pressure for MVP so mouse, trackpad, and pen produce the same result. Coalesce points closer
than a small image-space threshold to bound history and render cost.

Undo and redo move whole operations between two arrays. Reset empties both. Re-render the base plus
committed operations after each history change; render the active stroke on a transient overlay or in
one animation-frame pass. Do not store full-canvas snapshots per history step—one 40 MP RGBA snapshot
is already about 160 MiB.

The text tool uses an HTML textarea positioned over the displayed canvas while editing. Enter with a
modifier or an explicit Add button commits; Escape cancels that text operation. Empty or whitespace-
only text is not an operation. Rasterize with a documented bundled/fallback sans-serif font and line
height. Canvas text is not itself accessible, so the live operation list should expose text entries to
screen readers and allow the latest text operation to be undone by keyboard.

Suggested controls:

- tools: Pen and Text;
- colours: black, white, red, yellow, green, blue;
- pen widths expressed in image pixels with small/medium/large presets scaled from image dimensions;
- `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`, and `Cmd/Ctrl+Y` for history;
- Reset, Cancel, Apply;
- zoom-to-fit initially, plus zoom in/out if it fits without complicating the first slice.

The canvas backing dimensions equal the decoded image dimensions. CSS scales it to the available
viewport. Theme tokens style the chrome; they must not alter exported pixels.

### Export policy

- PNG input exports PNG.
- JPEG input exports JPEG at quality `0.92` and uses the decoded orientation, so EXIF orientation is
  no longer required in the output.
- Use the source basename with one `-annotated` suffix and the matching extension. Do not repeatedly
  append the suffix on subsequent edits.
- If the encoded result exceeds 10 MiB, do not silently resize or switch formats. Keep the editor open
  and explain that the edited image exceeds the attachment limit.
- If no operations were committed, Apply closes as cancel; it does not create a duplicate attachment.
- If encoded bytes hash to the source content, deduplication may return the source id. Treat that as a
  no-op and close without invoking replacement.

Call `canvas.toBlob`, not `toDataURL`. Revoke object URLs on replacement, cancel, and unmount.

## Failure and concurrency behavior

| Situation | Required result |
| --- | --- |
| Source removed while editor is open | Overlay may finish creating a candidate, but owner compare-and-swap refuses it; candidate is best-effort deleted/otherwise GC'd. |
| User navigates to another task/session | Source slot unmount closes the invocation with `null`; no draft changes. |
| Submit pressed during Apply | Submit is disabled as soon as the owner-action commit begins. The editor overlay normally covers it, but correctness must not depend on visibility. |
| Two edits opened serially | Opening the second settles the first with `null` and mounts a fresh iframe. Only a result whose expected id still occupies its slot can commit. |
| Node goes offline during read | Editor shows retry and retains no fake canvas state. |
| Node goes offline after encoding | Keep operations and allow retry; no owner action occurs without a returned replacement id. |
| Replacement upload succeeds but client crashes | Candidate remains unreferenced and is collected by the existing 24-hour GC. Original draft id survives in local storage. |
| Replacement commits but old cleanup fails | New id remains in the draft; old unreferenced content is collected later. |
| Plugin disabled/uninstalled | The owner fallback chip resumes. Existing drafts and attachments are unaffected. |
| Contributor conflict | Existing `replace` arbitration applies. The owner's default remains until the user chooses among matching contributors. |

## Security and privacy

- The extension declaration is the owner's consent for UI replacement; its `overlay` association and
  the point's `actions` list are the explicit new grants.
- The plugin receives only the attachment metadata already passed to the slot and bytes for a single
  task-scoped, unreferenced id it names through its own route.
- The Node capability rechecks task ownership and unreferenced status on read and create. Never rely on
  the client-supplied task id alone.
- No filesystem path, task token, node credential, or agents-route access crosses into the sandbox.
- No network permission is requested. Content remains on the selected node and in the local desktop
  renderer/iframe.
- Byte requests obey the same pinned-node transport as every other frame request.
- MIME metadata is advisory; the agents store's magic-byte validation is authoritative.
- The iframe stays `sandbox="allow-scripts allow-same-origin"` at its content-hash origin, with the
  existing `connect-src 'none'` policy. The canvas need not relax CSP.
- Avoid logging filenames, byte bodies, text annotations, or attachment ids in routine telemetry.
  Record bounded operational facts only: MIME family, byte count, duration, success/failure code.
- A text annotation is user content. It must not enter an error message, toast detail, or audit row.
- No new audit verb is needed: this is an unsent local draft transformation, comparable to editing the
  prompt before send. The queued turn remains the durable record of what reached the agent.

## Implementation order

Each phase is intended to be independently reviewable. Do not begin the plugin UI until the platform
contract tests for its seam are green.

### Phase 1 — Specify slot actions and companion overlays

Outcome: a fixture loaded plugin can open its own associated overlay from a particular remote tree,
return a JSON result, and invoke one owner-declared action on that same slot.

Work likely touches:

- `packages/protocol/src/plugin/contract.ts` and plugin manifest projection types;
- `packages/protocol/src/tree/messages.ts`;
- `packages/client-core/src/host/tree/{Slot,RemoteTree,workerHost}.ts*`;
- `packages/client-core/src/host/frames/{overlays,PluginOverlay,PluginFrame}.ts*`;
- `packages/client-core/src/host/frames/sdk.ts`;
- `packages/plugin-sdk/src/public.ts` and its contract tests;
- `packages/node-core/src/server/plugins/manifest.ts` and manifest tests; and
- trust/permission wording for the new overlay association and owner-action vocabulary.

One manifest detail decides whether this phase works at all. `manifest.ts` collects
`openedOverlays` from action descriptors carrying `verb: 'openOverlay'`, then rejects any overlay
frame missing from that set with the message `overlay '<id>' needs an action that opens it`. An
extension descriptor's new `overlay` field has to add to the same set. Miss that, and a plugin whose
only opener is an extension fails manifest validation, which reads as a plugin bug rather than as
the platform gap it is.

Tests must cover manifest validity, undeclared overlay denial, undeclared action denial, exact-slot
focus, request/reply size limits, in-flight limits, owner timeout, unmount cancellation, fresh iframe
per invocation, result-once behavior, and null settlement for every dismissal path. Add a small
architecture assertion that remote-tree props remain data-only.

### Phase 2 — Add binary bridge requests

Outcome: a fixture frame round-trips bytes to and from its own plugin route with MIME/filename metadata,
while cross-plugin paths and oversize payloads are refused before dispatch.

Work likely touches:

- `packages/protocol/src/plugin/bridge.ts`;
- `packages/client-core/src/host/frames/{broker,frameServices,scopes,sdk}.ts`;
- `packages/client-core/src/infra/node/apiClient.ts`, to reach `readBytes` and the `{ kind: 'bytes' }`
  body from a frame rather than to build anything new;
- `packages/plugin-sdk/src/public.ts`, published surface snapshot, and contract tests; and
- the bridge, frame-services, and desktop plugin E2E fixtures.

Test zero-length bytes, a 10 MiB payload, the 12 MiB refusal boundary, non-JSON success, JSON error
envelopes, abort, transfer of a subarray without corrupting unrelated bytes, own-namespace permission,
and denial of `/v2/p/agents/*`.

### Phase 3 — Publish the agents draft-attachment capability

Outcome: a permitted loaded Node plugin can read and create a candidate replacement for a PNG/JPEG
draft attachment without learning a path or mutating/deleting the source.

Work likely touches:

- a new agents capability contract;
- `plugins/agents/src/server/sessions/attachmentStore.ts` to factor shared validated storage;
- `plugins/agents/src/node/index.ts` for capability registration/disposal;
- `packages/plugin-types/src/public.ts` for the catalogue declaration; and
- agents store/capability and node plugin lifecycle tests.

Test wrong task, missing id, referenced source, unsupported MIME, spoofed MIME, unsafe filename,
oversize bytes, deduplication, source bytes unchanged, and capability disappearance on dispose.

### Phase 4 — Make replacement a composer-owned operation

Outcome: a fixture remote contributor can replace one attachment id safely, and the next queued turn
references only the replacement.

Work likely touches:

- `plugins/agents/src/client/composer/AttachmentSlot.tsx` and tests;
- `plugins/agents/src/client/composer/AgentComposer.tsx` plus a small pure replacement helper/model;
- draft persistence helpers; and
- managed client calls used for metadata validation and cleanup.

Test order preservation, expected-id mismatch, wrong-task replacement, referenced replacement,
aggregate-size refusal, submit/remove disabled during commit, durable-id-before-cleanup ordering,
cleanup failure, failed commit candidate cleanup, and the `AgentInputPart` built after success.

### Phase 5 — Implement `image-markup`

Outcome: the bundled loaded plugin supplies the compact preview and usable editor, and an integration
test proves altered pixels reach the managed-agent input path.

Implement pure model tests before canvas wiring. Add Node route tests, remote preview tests, and DOM
editor tests with canvas/image APIs stubbed at the boundary. Keep the editor files small enough that
coordinate math, history, encoding, and transport failures can be tested without an iframe.

Build it through the normal package builder, then add it to the desktop bundled-plugin list. Verify
the generated manifest requests no permission beyond `agents.draftAttachments` and names the remote
point and companion overlay exactly once. The current builder does not emit `spec.requires`; extend
`apps/node/scripts/build-plugin.mjs` to copy a declared `requires` block into the generated manifest,
and cover that in its builder tests. Do not silently omit the agents dependency.

### Phase 6 — Documentation and release closure

Move shipped behavior out of this file to its owners:

- `docs/plugins.md`: tree host requests, companion overlays, overlay result lifecycle, binary bridge;
- `docs/plugin-authoring.md`: manifest examples and SDK signatures;
- `docs/plugin-map.md`: canvas/editor recipe and the new owner-action seam;
- `docs/contribution-kinds.md`: action-bearing remote points;
- `docs/managed-agents.md`: draft attachment replacement and immutable storage behavior;
- `docs/security.md`: the new bounded tree and binary bridge messages;
- `docs/frontend.md`: binary data through the node transport; and
- `docs/testing.md`: automated suites and the manual checks below.

Update generated manifest schema and published API snapshots through their owning test/update commands.
Delete this future file or reduce it to a pointer once all behavior is owned and shipped.

## Test and acceptance matrix

Automated acceptance is not merely “the editor rendered.” The following behaviors close the feature:

1. Attach a known 4×4 PNG, draw a red stroke over known pixels, Apply, enqueue, and assert the driver
   resolves the replacement attachment whose decoded pixels contain the stroke.
2. Attach a JPEG with EXIF rotation, add text, Apply, and assert output dimensions/orientation match
   what the editor displayed.
3. Cancel after edits and assert the draft and original content hash are unchanged.
4. Remove the attachment while an invocation is open and assert a late result cannot reinsert it.
5. Cause replacement upload to fail and assert edit operations remain available for retry.
6. Force old-attachment cleanup to fail and assert the new id still queues successfully.
7. Attempt to edit a referenced attachment through the plugin route and assert the agents capability
   refuses it.
8. Attempt direct binary access to `/v2/p/agents/*` from the frame and assert the broker never calls
   the transport.
9. Mount two image previews from one worker, focus the second, and assert the overlay receives the
   second attachment id. This is the regression test for choosing the tree channel over the shared
   bundle bridge.
10. Open, close, and reopen the same editor and assert the second iframe has only the second input and
    no first-invocation history.
11. Load without `image-markup` and assert the existing attachment chip, removal, draft restoration,
    and send path are unchanged.
12. Render in the TUI and assert no unusable Edit control is offered and the fallback remains legible.

Manual desktop checks:

- pen input at zoom-to-fit remains under the pointer at each corner and on a Retina display;
- text placement, wrapping, undo, redo, and reset are visually correct;
- keyboard focus starts in the overlay, stays trapped, and returns to the initiating preview;
- Escape cancels an in-progress text entry before it dismisses the overlay;
- high-contrast/light/dark and all style packs leave controls legible without changing export colours;
- a 10 MiB source and a near-40 MP source fail or succeed with clear, non-janky feedback;
- switching tasks or disabling the plugin while editing leaves no overlay or stuck Submit state; and
- the altered image, not merely a new filename, is visibly present in a real agent turn.

Run at minimum:

```sh
pnpm lint
pnpm --filter @acorn/protocol test
pnpm --filter @acorn/plugin-sdk test
pnpm --filter @acorn/client-core test
pnpm --filter @acorn/node-core test
pnpm --filter @acorn/plugin-agents test
pnpm --filter @acorn/plugin-image-markup test
pnpm --filter @acorn/desktop test
pnpm test
```

Confirm the actual package names before copying these commands. Use `pnpm test`, not an unbounded
`turbo run test`, for the full suite.

## Refused alternatives

- **Compile the plugin into the app.** This hides missing platform capability and gives the editor more
  renderer authority than it needs. Reconsider only if the feature fundamentally cannot be expressed
  through a general loaded-plugin seam after the contracts above exist.
- **Pass callback props to a remote tree.** Functions cannot cross the worker boundary, and pretending
  they can would split compiled and loaded contribution semantics.
- **Let the plugin call the agents routes.** Cross-plugin route confinement is a security boundary, not
  an inconvenience. The narrow Node capability makes the dependency reviewable.
- **Put image bytes in remote props or tree nodes.** It would copy megabytes through mutation machinery
  capped and designed for UI descriptions.
- **Base64 over JSON.** It adds size, allocation, decode work, and log/inspection risk for no benefit.
- **Edit the stored blob in place.** Content-addressed storage, deduplication, draft recovery, and the
  evidence of sent turns all depend on immutability.
- **Have the Node capability replace or delete the draft.** The Node does not own the unsent client
  array and cannot transact with it.
- **Use a manifest command as the only opener.** A command has no attachment instance to pass. A
  companion overlay declared on the extension is both more precise and trust-visible.
- **Open the overlay through the shared worker bridge.** One bridge belongs to a bundle, not to one of
  its many mounted attachment slots; focus and input would be ambiguous.
- **Add raw pointer events or a Canvas node to the closed kit.** A canvas is exactly the rectangle case.
  Expanding the host-rendered tree with pixel-level events would leak DOM assumptions into the TUI.
- **Always export PNG.** Annotated photographs can exceed the existing attachment ceiling. Preserve
  PNG/JPEG families for MVP.
- **Support GIF/WebP by flattening.** A file that may be animated must not silently become one frame.
- **Delete the original as soon as upload succeeds.** A stale or failed compare-and-swap would then lose
  the valid draft. Commit first, clean up second.

## Open product choices

These do not block the architecture, but the implementer should get a product decision before polishing
the relevant UI:

- Whether the compact replacement should say “Edit” visibly or make the filename/body pressable with
  an accessible label. The latter matches the supplied chip more closely; the former is more
  discoverable.
- Whether zoom controls belong in MVP or zoom-to-fit is enough. Coordinate storage is image-space in
  either case, so adding zoom later is reversible.
- Whether JPEG quality `0.92` is acceptable as a fixed policy. If not, expose a small quality choice;
  do not implement an opaque automatic degradation loop.

## Checked at `0141ebd3`

Every line below was read out of the tree, not assumed. Recheck one before you rely on it, and treat
a mismatch as a reason to reread this proposal rather than to work around it.

The agents side:

- `plugins/agents/src/client/index.ts:49` registers `agents:attachment` as `remote`, `replace`,
  `max: 1`. It sets no `selector`, so the `selector: 'mediaType'` in the manifest example above is
  part of the work rather than a description of what is there. The field itself is real:
  `packages/protocol/src/plugin/contract.ts:417` accepts it on a `replace` point, and `accepts` beside
  it can list the media types the point will pass.
- `AttachmentSlot.tsx:15` takes `{ attachment, taskId, onRemove }`, keys the `Slot` on the media type,
  and passes only `{ attachment, taskId }` to the contributor. `AgentComposer.tsx` owns the array and
  the local-storage draft ids.
- `attachmentStore.ts` caps one attachment at 10 MiB, sniffs PNG and JPEG from magic bytes, and
  deduplicates on `(taskId, contentHash)`.
- The routes live at `plugins/agents/src/server/routes/managed.ts`. `GET /attachments/:attachmentId`
  returns the metadata row, not content, and there is no content route to borrow. Do not add a public
  one as a shortcut.
- `AgentInputPart` in `packages/protocol/src/managedAgents.ts:120` represents an image as
  `{ type: 'attachment', attachmentId }`. Both drivers resolve the id at dispatch and read
  `attachment.localPath` there: `codexDriver.ts:67` emits a `localImage`, `acpDriver.ts:70` emits a
  `resource_link`. Neither caches a path in client state or in the stored turn, which is the whole
  reason replacing the id before enqueue is sufficient.

The platform side:

- `packages/client-core/src/host/tree/workerHost.ts:88` keeps one worker per bundle hash and shares it
  across every tree from that bundle. That is what makes a bundle-level opener ambiguous and the tree
  channel correct.
- Overlay state at `packages/client-core/src/host/frames/overlays.ts:14` is one global signal
  holding `{ pluginId, surface } | null`, with no invocation input and no result.
- `manifest.ts:597` refuses an overlay frame that no `openOverlay` action reaches.
- `apiClient.ts:34` types a response body as `Uint8Array`, `apiClient.ts:198` has `readBytes`, and
  `apiClient.ts:229` documents throwing a non-JSON success body away deliberately. `frameServices.ts:88`
  is the single line that forces JSON on a frame request.
- `scopes.ts:227` denies another plugin's `/v2/p/` namespace before the route table is consulted.
- `contract.ts:481` counts `items`, `remote`, `frame`, and `route` and refuses a descriptor that names
  anything other than exactly one of them. The `overlay` field this proposal adds has to sit outside
  that count, as a qualifier on the `remote` carrier. Add it to the carrier list by accident and every
  descriptor using it is rejected.
- The TUI mounts remote trees through `apps/tui/src/plugins/RemoteTree.tsx` but has no overlay frame
  host, for the reason written at the top of `apps/tui/src/plugins/pluginWorker.js`: a terminal has no
  iframe. The fallback chip is the terminal answer, and this project should not invent a terminal
  canvas.
- `PLUGIN_API_MAJOR` is `'10'` in `packages/protocol/src/plugin/apiVersion.ts`. If it moved, use the
  current value and regenerate the schema and snapshots rather than hardcoding the number written here.
- `apps/node/scripts/build-plugin.mjs` writes no `requires` block into a generated manifest, so phase 5
  has to extend the builder before the agents dependency can be declared at all.

Two things this pass did not open, because they need a running build rather than a read:

- Whether the loaded-plugin builder's single client bundle survives the DOM and worker branch in one
  entry. Check it against a hybrid fixture before writing the plugin entry against it.
- Whether `apps/desktop/scripts/build-bundled-plugins.mjs` needs anything beyond a roster line for a
  plugin that ships both a tree and an overlay frame.
