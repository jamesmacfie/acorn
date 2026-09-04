# Agent attachment image editor plugin

Status: proposal, 2026-09-04. Plugin not started. Every platform seam it needs is now shipped.

The prerequisite this file was written against is done. The three seams and the agents capability
landed on 2026-09-04, and the proposal that described them has been retired into the docs that own
the behaviour: `docs/plugins.md` § Asking the owner, § Companion overlays and § Binary bridge calls,
`docs/managed-agents.md` § Draft attachments, and `docs/security.md` § Rung 0. Read those rather
than this file's summary of them; the summary below is kept because it names what this plugin uses,
not because it is the contract.

The spellings in the dependency contract below are the ones that shipped. Paths in the rest of this
file are architectural hints, not promises.

## Outcome

Add a bundled loaded plugin with package/id `agent-attachment-image` and display name **Image markup**.
It replaces the compact preview for unsent PNG and JPEG agent attachments. Pressing the preview opens
a deliberately small, MS Paint-like editor where the user can draw freehand strokes or add text. Apply
creates a new immutable attachment and replaces the source id in the agent composer. The existing
managed-agent enqueue and driver path then sends the altered image to the agent.

The plugin should feel native where it is small and own pixels where that is necessary:

- the composer preview is a remote tree made from Acorn kit controls;
- the editor is a sandboxed overlay iframe containing a DOM canvas; and
- image bytes cross only through the bounded binary API and the agents-owned draft-attachment
  capability that the platform prerequisite introduced.

This file is the implementation brief for the plugin only. It does not redesign the plugin platform.
If the reported platform implementation materially differs from the prerequisite contract below,
update this file first instead of adding compatibility code inside the plugin.

## Dependency contract

These are the shipped signatures, checked against the tree on 2026-09-04.

```ts
// Remote tree, bound to one mounted contribution slot.
mount.host.openOverlay<TResult>(overlayId: string, input?: unknown): Promise<TResult | null>
mount.host.invoke<TResult>(action: string, payload?: unknown): Promise<TResult>

// Sandboxed frame, routed through the pinned node transport.
bridge.api.getBytes(path: string, options?: { signal?: AbortSignal }): Promise<{
  bytes: Uint8Array
  type: string
  filename: string | null
}>
bridge.api.postBytes<T>(path: string, body: {
  bytes: Uint8Array
  type: string
  filename?: string
}, options?: { signal?: AbortSignal }): Promise<T>

// Node capability provided by agents and requested in the manifest.
type DraftAttachmentsCapability = {
  read(input: { taskId: string; attachmentId: string }): Promise<{
    attachment: AgentAttachment
    bytes: Uint8Array
  } | null>
  createReplacement(input: {
    taskId: string
    sourceAttachmentId: string
    filename: string
    mediaType: 'image/png' | 'image/jpeg'
    bytes: Uint8Array
  }): Promise<AgentAttachment>
}
```

The expected declarative contracts are:

- `agents:attachment` declares an owner action equivalent to `replace`;
- a remote extension may associate one of its own overlay frames;
- overlay invocation input is available in the frame context;
- overlay `close(result)` resolves only the initiating tree request;
- binary request and response bodies are bounded above the 10 MiB attachment limit;
- another plugin's `/v2/p/agents/*` routes remain inaccessible to the client sandbox; and
- `agents.draftAttachments` reads and creates replacements only for task-scoped, unreferenced draft
  attachments and never exposes a filesystem path.

No fallback transport should be built. In particular, do not substitute base64 JSON, a data URL,
direct agents-route access, or filesystem reads if any prerequisite is missing.

## User experience

### Composer preview

For `image/png` and `image/jpeg`, replace the fallback attachment body with a native kit preview that
shows:

- the image glyph;
- filename;
- rounded KiB size;
- an Edit affordance or a pressable body with accessible label `Edit <filename>`; and
- a busy state while an edit result is being committed.

The agents plugin must continue to own the remove button outside the replaceable portion. The image
plugin must not receive or recreate attachment removal. This ensures the attachment remains removable
when the editor plugin is disabled, fails, or loses extension-point arbitration.

The supplied UI reference is a compact metadata chip rather than a thumbnail. Match that density for
the first version. Do not add an image/thumbnail node to the closed kit as part of this work.

### Editor overlay

The overlay has host-owned modal chrome and a plugin-owned editor body:

```text
┌ Image markup · screenshot.png ─────────────────────────────── × ┐
│ [Pen] [Text]   [● ● ● ● ● ●]   Width [S M L]  Undo Redo Reset │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│                    image canvas, fit to view                   │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│  PNG · 1920 × 1080                          [Cancel] [Apply]    │
└────────────────────────────────────────────────────────────────┘
```

The first release includes only:

- Pen and Text tools;
- black, white, red, yellow, green, and blue;
- small, medium, and large pen widths;
- undo, redo, reset, cancel, and apply;
- zoom-to-fit, with optional zoom in/out only if it remains a contained addition; and
- keyboard shortcuts for history and dismissal.

The initial tool is Pen, colour is red, and width is medium. Remember the last tool, colour, and width
through plugin state if the shipped bridge already offers bounded namespaced state; do not persist the
image or operation history.

### Interaction rules

- Pointer down on the canvas begins a stroke only when Pen is active.
- Pointer capture continues the stroke if the pointer leaves the canvas.
- Pointer up/cancel commits one stroke operation.
- A click with Text active places a DOM textarea over the image at that image coordinate.
- `Cmd/Ctrl+Enter` or an explicit Add control commits text. Escape cancels the text entry before it
  dismisses the overlay.
- `Cmd/Ctrl+Z` undoes; `Cmd/Ctrl+Shift+Z` and `Cmd/Ctrl+Y` redo.
- Reset removes every committed alteration after confirmation only when there is more than one
  operation; for a single operation, ordinary Undo is sufficient and less interruptive.
- Apply with no committed operations behaves like Cancel and creates no attachment.
- Cancel, backdrop click, the host close control, and navigation discard the in-memory operation list.
- Apply stays disabled while source loading, decoding, encoding, upload, or replacement commit is in
  progress.
- If upload fails, keep the operations and let the user retry.

The overlay must never close merely because encoding or upload began. It closes with a replacement id
only after the Node has accepted and stored the replacement candidate.

## Scope

### In scope

- A new `plugins/agent-attachment-image` workspace package.
- Its loadable-plugin config, Node route adapter, remote preview, overlay editor, pure edit model, and
  tests.
- Adding it to the desktop bundled-loaded-plugin roster.
- Minimal fixes to the implemented platform seam if integration exposes a clear defect in the shipped
  contract, with a regression test at the platform owner.
- Owning documentation for the shipped plugin.

### Out of scope

- PDF, GIF, WebP, SVG, HEIC, video, or arbitrary file preview.
- Animated-image flattening.
- Crop, resize, rotate, selection, fill, shapes, layers, eraser, filters, eyedropper, or clipboard
  paste.
- AI image generation or semantic image understanding.
- Editing an attachment after enqueue or modifying a sent turn.
- Writing to the project worktree or overwriting the file from which the attachment originated.
- A generic media library, asset database, or plugin database.
- A TUI canvas editor. The terminal keeps the default/static attachment rendering.
- A compiled plugin or a new entry in compiled plugin rosters.
- A public attachment download endpoint under `/v2/p/agents/`.

## Architecture and data flow

```text
AgentComposer draft contains source attachment A
  -> agents:attachment arbitration selects agent-attachment-image
  -> remote AttachmentPreview renders native compact UI
  -> user presses Edit
  -> slot-bound openOverlay(editor, metadata for A)
  -> overlay frame GETs plugin-owned content route as bytes
  -> plugin Node route calls agents.draftAttachments.read(A)
  -> frame decodes A and records pen/text operations in memory
  -> Apply rasterizes base + operations and POSTs bytes to plugin-owned replacement route
  -> plugin Node route calls agents.draftAttachments.createReplacement(A, bytes)
  -> agents store creates/deduplicates immutable attachment B
  -> overlay closes with { kind: 'applied', replacementAttachmentId: B.id }
  -> remote preview invokes owner action replace(expected A, replacement B)
  -> AgentComposer compare-and-swaps A -> B, persists the draft, then cleans up A
  -> ordinary enqueue references B
  -> existing driver resolution sends B's local image to the agent
```

The plugin never owns the draft array. The Node never claims that replacement has committed. It only
creates candidate B. The agents client makes the final compare-and-swap because only it can prove that
A still occupies that composer slot.

## Package and file shape

Use this as the intended ownership split, adjusting filenames only to match the live conventions:

```text
plugins/agent-attachment-image/
  acorn-plugin.config.mjs
  package.json
  src/
    contract/
      routes.ts
      wire.ts
    node/
      index.ts
    server/
      attachmentImageRoutes.ts
      attachmentImageRoutes.test.ts
    client/
      index.ts
      preview/
        AttachmentPreview.tsx
        AttachmentPreview.test.tsx
      editor/
        ImageEditor.ts
        editor.css
        model.ts
        model.test.ts
        coordinates.ts
        coordinates.test.ts
        rasterize.ts
        rasterize.test.ts
```

Keep files feature-owned and narrow:

- `wire.ts` owns parsed input/result shapes used on both sides of the iframe boundary.
- `routes.ts` owns plugin-local route builders used by client and Node code.
- `attachmentImageRoutes.ts` adapts HTTP bytes to the agents capability; it contains no image editing.
- `model.ts` owns tools, operation history, undo/redo, and dirty state without DOM types.
- `coordinates.ts` converts displayed pointer positions to source-image coordinates.
- `rasterize.ts` draws a base bitmap and operation list into an injected 2D context and encodes it.
- `ImageEditor.ts` owns DOM/canvas lifecycle and composes those pure modules.
- `AttachmentPreview.tsx` owns only remote-tree UI and the two slot-bound calls.

Avoid one large editor component containing pointer math, history, HTTP, encoding, and DOM creation.

## Package metadata and manifest

Use package name `@acorn/plugin-agent-attachment-image`, version `0.1.0`, private workspace package,
ES modules, and the same lint/test scripts as other plugins:

```json
{
  "scripts": {
    "lint": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

Expected workspace dependencies are `@acorn/plugin-api`, `@acorn/plugin-agents` for the capability
contract if that is how the implementation exported it, `@acorn/protocol` for `AgentAttachment`,
`solid-js` for the remote preview, and the existing test/build dependencies used by loaded plugins.
Do not add an image-editing dependency for pen and text; Canvas 2D is sufficient.

The config should express this effective manifest:

```js
export default {
  name: 'Image markup',
  entry: '@acorn/plugin-agent-attachment-image/node/index.ts',
  factory: 'agentAttachmentImagePlugin',
  client: { entry: './src/client/index.ts' },
  requires: { plugins: [{ id: 'agents' }] },
  permissions: {
    api: [],
    events: [],
    node: {
      core: [],
      capabilities: ['agents.draftAttachments'],
      secrets: false,
      exec: false,
      net: [],
    },
  },
  contributions: {
    frames: [{
      target: 'overlay',
      id: 'editor',
      label: 'Image markup',
    }],
    extensions: [{
      id: 'agent-image',
      point: 'agents:attachment',
      label: 'Image markup',
      remote: 'attachmentPreview',
      matches: ['image/png', 'image/jpeg'],
      overlay: 'editor',
    }],
  },
}
```

Use the final implemented manifest field names, not the illustrative names above. The generated
manifest must contain `requires.plugins`; verify the loaded-plugin builder now copies that config
field. There should be no command just to make the overlay appear reachable. Its association with the
remote extension is the real opener.

Do not request `core.tasks:read`: task identity comes from the owner-scoped contribution and the Node
capability performs the authoritative ownership check. Do not request general filesystem, secrets,
network, or process authority.

## Node half

The Node plugin is a thin route adapter with no state:

```ts
export const agentAttachmentImagePlugin = (): NodePlugin => ({
  name: 'agent-attachment-image',
  init: (ctx) => {
    ctx.routes.fetch(createAttachmentImageFetch(() =>
      ctx.capabilities.require(AGENTS_DRAFT_ATTACHMENTS),
    ), { prefix: '', note: 'read and create image draft attachment replacements' })
  },
})
```

Resolve the capability per request, or pass a getter as above. Plugin initialization order is not a
safe time to capture another plugin's capability. Follow the portable fetch-carrier pattern used by
the existing loaded plugins; do not export a live Hono instance across the loaded boundary.

### Routes

Use two plugin-owned endpoints, with route builders shared by client code:

| Method | Plugin-relative route | Success |
| --- | --- | --- |
| GET | `/draft-attachments/:attachmentId/content?taskId=:taskId` | Raw image bytes with source MIME, filename, content length, and `Cache-Control: no-store`. |
| POST | `/draft-attachments/:attachmentId/replacements?taskId=:taskId` | JSON `{ attachment: AgentAttachment }` after storing/deduplicating the candidate. |

The POST body is raw image bytes. Send media type and filename using the exact metadata carrier the
binary bridge implementation chose; do not duplicate them in a JSON wrapper. Validate:

- method and path;
- non-empty bounded task and attachment ids;
- `image/png` or `image/jpeg` only;
- a bounded non-empty display filename;
- declared content length before reading where available; and
- actual bytes through the agents capability/store, which remains authoritative for magic bytes,
  per-file size, safe basename, and content hash.

Map a missing or referenced source to a stable not-editable/not-found error without revealing whether
an attachment exists on another task. Map unavailable capability to the host's dependency-unavailable
error. Pass existing structured errors through rather than converting every failure to 500.

No route deletes the candidate. If composer commit fails, the agents owner can use its existing
unreferenced-delete operation; otherwise normal attachment GC handles it.

### Route tests

Use an injected fake capability and assert:

- GET returns exact bytes and headers;
- GET missing/wrong-task/referenced is refused without bytes;
- POST passes the route source id, task id, filename, MIME, and exact bytes to `createReplacement`;
- PNG and JPEG succeed;
- unsupported/spoofed/oversize input is surfaced from the capability as a structured error;
- dependency absence is explicit and retryable where appropriate;
- an error response never echoes bytes, filename content, or annotation text; and
- no filesystem path appears in any response.

## One client bundle, two runtimes

The loaded-plugin builder emits one browser bundle. The entry has to select its runtime before
mounting:

```ts
if (typeof document === 'undefined') {
  mountTree({ attachmentPreview: solidTree(AttachmentPreview) })
} else {
  mountFrame({ styles }, (bridge, root) => mountImageEditor(bridge, root))
}
```

Do not invoke both mount functions. A frame handshake has no tree port; a worker has no DOM. Keep the
DOM editor free of Solid if that makes canvas lifecycle simpler. The universal Solid transform can
still compile the remote preview because the branch and imports share one bundle.

If the implementation's CSP or build pipeline cannot bundle CSS as a string for `mountFrame`, use the
existing frame stylesheet pattern. Do not add a separately fetched asset: the plugin origin serves a
single content-addressed client bundle.

## Shared wire shapes

Define and parse these at the iframe/worker boundary:

```ts
type EditorInput = {
  taskId: string
  attachmentId: string
  filename: string
  mediaType: 'image/png' | 'image/jpeg'
  byteSize: number
}

type EditorResult =
  | { kind: 'applied'; expectedAttachmentId: string; replacementAttachmentId: string }
  | { kind: 'unchanged' }
```

`null` is host dismissal and is not an `EditorResult`. Parse with small hand-written guards unless the
plugin already depends on Zod for another reason. Reject unexpected fields only where the implemented
bridge promises strict JSON; otherwise ignore additive fields and validate what is consumed.

The frame must verify that `bridge.context.target` is `overlay`, that input parses, and that input MIME
matches the metadata returned by GET. The worker must require the result's expected id to equal the id
from the current preview props before invoking the owner action.

Do not send image bytes, operation history, or text annotation contents through overlay input/result.

## Remote preview implementation

`AttachmentPreview` receives changing owner props and the slot-bound host interface. Its flow is:

1. parse `{ attachment, taskId, sessionId }` from the mount props;
2. render a kit `Chip`/`Button` composition matching the default attachment density;
3. on press, capture the current attachment id and set local busy state;
4. open `editor` with `EditorInput`;
5. if dismissed or unchanged, clear busy state;
6. if applied, validate both ids and invoke owner action `replace` with
   `{ expectedAttachmentId, replacementAttachmentId }`;
7. wait for owner acknowledgement rather than optimistically rewriting props; and
8. clear busy/error state unless the mount was disposed.

If props change while the overlay is open, treat the captured id as stale. The platform should dismiss
an overlay when its source slot unmounts, but the preview must still rely on the owner's compare-and-
swap, not on that UI behavior for correctness.

Disable repeated presses while one invocation is live. An error should leave the original preview and
offer Edit again. Use a concise inline status when the kit supports it; use a toast only for failures
that occur after the overlay has closed and therefore have no editor surface left to display them.

The preview has no `onRemove`, does not call the managed-agent API directly, and never sees attachment
bytes.

## Editor domain model

Keep the source bitmap immutable and store alterations as operations:

```ts
type ImagePoint = { x: number; y: number }

type StrokeOperation = {
  kind: 'stroke'
  color: EditorColor
  width: number
  points: ImagePoint[]
}

type TextOperation = {
  kind: 'text'
  color: EditorColor
  size: number
  at: ImagePoint
  text: string
}

type EditOperation = StrokeOperation | TextOperation

type EditorHistory = {
  committed: EditOperation[]
  undone: EditOperation[]
}
```

Rules:

- committing a new operation clears `undone`;
- undo moves the last committed operation to `undone`;
- redo restores the last undone operation;
- reset clears both arrays;
- a stroke with fewer than two distinct points becomes a dot, not an empty operation;
- empty/whitespace-only text is not committed;
- cap text at 2,000 Unicode scalar values per operation;
- cap committed operations at 1,000 and points at 20,000 per stroke; and
- when a cap is hit, stop accepting that operation and tell the user instead of silently truncating
  the exported result.

Do not implement undo as `ImageData` snapshots. At the permitted 40 MP decoded ceiling, one RGBA
snapshot is roughly 160 MiB before history or browser overhead.

The six colours are closed literal values, not arbitrary CSS supplied by state. Width presets resolve
to image-space pixels. Suggested initial values are based on the shorter image dimension:

```ts
small  = clamp(round(shortSide * 0.002), 2, 12)
medium = clamp(round(shortSide * 0.005), 4, 32)
large  = clamp(round(shortSide * 0.012), 8, 72)
```

Store the resolved width on each operation so changing the active preset does not alter history.

## Image loading and memory bounds

Load source bytes with an `AbortController`, create a `Blob` using the returned authoritative MIME,
and decode with `createImageBitmap`. Revoke any object URL and close the bitmap on unmount.

Before allocating the working canvas, refuse when:

- width or height is zero;
- either dimension exceeds 8,192 pixels; or
- `width * height` exceeds 40,000,000 pixels.

Keep these named constants next to tests. The encoded 10 MiB attachment limit does not prevent a
highly compressed image from creating an unsafe decoded allocation.

`createImageBitmap` should apply JPEG orientation as displayed by the browser. Use the decoded
`bitmap.width` and `bitmap.height` as the canonical source dimensions; exported pixels bake that
orientation in. Add a fixture with non-default EXIF orientation to prove the desktop engine behavior.
If the runtime does not honor orientation consistently, STOP and add an explicit orientation decoder;
do not ship an editor whose export rotates the user's image.

Keep one source-sized render canvas. A second source-sized scratch canvas is acceptable during final
export but must not persist between exports. The visible CSS size is independent of backing pixels.

## Coordinates, zoom, and pointer input

Every operation uses image-space coordinates. Convert from client coordinates with:

```ts
x = clamp((clientX - rect.left) * imageWidth / rect.width, 0, imageWidth)
y = clamp((clientY - rect.top) * imageHeight / rect.height, 0, imageHeight)
```

This remains correct under zoom as long as `rect` describes the actual displayed canvas. Test all four
corners, center, non-integer scaling, letterboxed layout, and out-of-bounds clamping.

For Pen:

- listen to Pointer Events, not separate mouse/touch paths;
- call `setPointerCapture(pointerId)` after a valid pointer down;
- track one active pointer only;
- use round line caps and joins;
- ignore pressure for MVP so device type does not change exported semantics;
- coalesce move events into at most one render per animation frame; and
- skip a new point when it is less than `max(0.5, width / 8)` image pixels from the last point.

Render the active stroke without committing it. Pointer cancel discards that active stroke. Unmount
must release capture and scheduled animation frames.

For Text, position a normal textarea over the displayed canvas using the inverse mapping from image
coordinates to CSS coordinates. Keep editing text in DOM state until commit. Rasterize committed text
with a stable documented font stack, explicit size, baseline, and line height. Use wrapping only if it
is deterministic and covered by tests; otherwise preserve explicit newlines and do not silently wrap.

## Rasterization and export

`rasterize` must be deterministic for a given decoded bitmap, dimensions, and operation list:

1. reset the context transform and clear the destination;
2. draw the base bitmap at decoded dimensions;
3. replay operations in order;
4. render strokes with their stored colour and image-space width;
5. render text line by line with its stored colour and size; and
6. encode only after the final replay completes.

Export policy:

- PNG source becomes PNG via `canvas.toBlob('image/png')`.
- JPEG source becomes JPEG via `canvas.toBlob('image/jpeg', 0.92)`.
- Do not use `toDataURL`.
- Do not silently resize, change format, or lower JPEG quality to fit a byte limit.
- Refuse an encoded result over the agents attachment limit while keeping the editor open.
- Name the output `<base>-annotated.png` or `<base>-annotated.jpg`.
- Strip an existing final `-annotated` before adding it, so repeated edits do not accumulate suffixes.
- A null `toBlob` result is a visible encoding failure, not an empty upload.

Comparing local encoded bytes to the source is optional. The attachment store already deduplicates by
content hash. If the returned replacement id equals the source id, close with `unchanged` and do not
invoke the owner action.

## Apply and replacement lifecycle

Apply is a four-stage state machine:

```ts
type ApplyState =
  | { kind: 'idle' }
  | { kind: 'encoding' }
  | { kind: 'uploading'; bytes: number }
  | { kind: 'closing' }
  | { kind: 'failed'; message: string }
```

On Apply:

1. prevent a second apply;
2. finish or cancel any active text edit according to the user's explicit action;
3. render and encode base plus committed operations;
4. reject locally if bytes exceed the known maximum;
5. POST raw bytes to the plugin-owned replacement route;
6. validate returned attachment metadata and same task;
7. if replacement id equals source id, close `{ kind: 'unchanged' }`;
8. otherwise close with both expected and replacement ids; and
9. let the remote preview invoke the owner `replace` action and await acknowledgement.

The editor cannot know whether composer commit succeeds after it closes. If the owner action rejects,
the preview reports the failure and keeps the original. The candidate replacement is best-effort
deleted by agents or later collected as unreferenced.

Never delete source A from the plugin Node route. The composer persists B in the local draft before
cleaning up A. A cleanup failure is not a failed replacement.

## Concurrency and failures

| Event | Required behavior |
| --- | --- |
| Source removed while editor is open | Source slot dismissal should close the overlay. A late result still fails owner compare-and-swap and cannot reinsert the image. |
| Source queued elsewhere | Capability refuses replacement of a now-referenced attachment, or owner refuses stale replacement. Sent evidence is unchanged. |
| Props change during editing | Result carries the captured expected id; only an exact current slot match can commit. |
| Node goes offline during GET | Show retryable load failure; no blank editable canvas. |
| Node goes offline during POST | Keep operations and allow Apply retry. |
| Upload succeeds, overlay/client crashes | Candidate remains unreferenced and existing GC removes it. Source id remains in persisted draft. |
| Owner commit fails | Original remains. Preview reports failure and candidate is cleaned up best-effort/GC'd. |
| Source cleanup fails after commit | Replacement remains committed and sendable; GC removes source later. |
| Plugin is disabled | Agents fallback preview returns; attachment and draft are untouched. |
| Two matching preview plugins exist | Existing replace arbitration applies. Do not bypass user choice. |
| Reopen after Cancel/Apply | A fresh iframe and empty operation history are created. |
| Unsupported host | No active Edit control is rendered; default/static attachment presentation remains usable. |

## Accessibility and visual rules

- The preview control has an accessible name including the filename and exposes busy/disabled state.
- Host overlay chrome owns dialog semantics, focus trap, close button, and return focus.
- The editor toolbar uses real buttons with pressed state for active tool/colour/width.
- Colour controls include text names; colour alone is not the label.
- Canvas has a concise accessible label and instructions associated by description.
- The positioned text textarea is a normal labelled form control.
- Status changes such as loading, encoding, upload failure, and apply success use a polite live region.
- Controls meet the existing hit-target and focus-ring conventions in every style pack.
- Exported colours are fixed image values. Theme tokens style editor chrome only.
- At narrow overlay sizes, toolbar rows wrap but the canvas remains the one scrolling/fitting region.
- Do not use raw Acorn CSS classes inside the remote tree. Use kit components and props. Frame CSS may
  use the tokens pushed by the bridge.

## Security and privacy

- Request only the agents draft-attachment capability; no API, event, filesystem, secret, process, or
  network grant.
- Keep client access inside `/v2/p/agent-attachment-image/*`; the Node capability is the only
  cross-plugin data seam.
- Treat task id, attachment id, filename, MIME, dimensions, and overlay result as untrusted at every
  boundary.
- Let the agents store perform authoritative magic-byte and task/reference validation.
- Never return or log local attachment paths.
- Never log image bytes, operation lists, annotation text, or full filenames.
- Operational logging, if added, is limited to MIME family, source/output byte counts, decoded
  dimensions, duration, and stable error code.
- No audit event is needed for edits to an unsent draft. The queued turn is the durable record of what
  the agent actually received.
- Revoke object URLs, abort fetches, cancel animation frames, close `ImageBitmap`, and remove DOM
  listeners on every exit.
- Never attempt to recover an unapplied image from local storage; doing so would persist user image
  content in a second, less-governed store.

## Implementation steps

### Step 0 — Read the seams you are building on

The prerequisite is shipped, so this step is reading rather than syncing. Four places, and the tests
beside each are the specification:

| What you need | Where it lives | Its tests |
| --- | --- | --- |
| `mount.host.invoke` and the point's `actions` | `client-core/host/tree/hostRequests.ts`, `Slot.tsx`, `RemoteTree.tsx` | `RemoteTree.grants.test.tsx`, `hostRequests.test.ts` |
| `mount.host.openOverlay` and the descriptor's `overlay` | `client-core/host/frames/overlays.ts`, `PluginOverlay.tsx` | `overlays.test.ts`, `RemoteTree.grants.test.tsx` |
| `bridge.api.getBytes` / `postBytes` | `client-core/host/frames/{broker,frameServices}.ts` | `broker.test.ts` § byte requests |
| `agents.draftAttachments` | `plugins/agents/src/contract/draftAttachments.ts` | `server/sessions/draftAttachments.test.ts` |

Run them before you start, so a failure later is yours:

```sh
pnpm --filter @acorn/client-core exec vitest run src/host/tree src/host/frames
pnpm --filter @acorn/plugin-agents exec vitest run src/server/sessions/draftAttachments.test.ts
```

Do not recreate any of these inside the plugin. If one of them is genuinely short of what this plugin
needs, widen the seam and its tests in a separate change, then come back.

### Step 1 — Scaffold the workspace package and manifest

Create the package, config, empty Node factory, dual-runtime client entry, and test setup. Add only the
dependencies actually imported. Ensure the config includes the agents requirement, capability grant,
overlay frame, and remote extension matching PNG/JPEG.

Build the loadable package without adding it to the desktop roster yet:

```sh
pnpm --filter @acorn/node build:plugin agent-attachment-image
```

Expected: the builder emits `acorn-plugin.json`, `dist/node.js`, and `dist/client.js`; parsing the
manifest succeeds; its grants contain only `agents.draftAttachments`; it requires agents; and the
overlay is reachable through the extension association.

### Step 2 — Implement and test the Node route adapter

Add shared route builders, request validation, capability lookup per request, exact raw-byte response,
and raw-byte replacement upload. Use an injected capability getter in tests. Do not touch attachment
storage directly.

```sh
pnpm --filter @acorn/plugin-agent-attachment-image test -- attachmentImageRoutes
```

Expected: all route cases in “Route tests” pass, including exact-byte equality and no path leakage.

### Step 3 — Implement the pure edit model

Add operation types, history transitions, caps, width resolution, coordinate conversion, output naming,
and pure raster replay helpers. Tests should use a recording fake 2D context rather than pixel-level
browser snapshots for domain behavior.

```sh
pnpm --filter @acorn/plugin-agent-attachment-image test -- model coordinates rasterize
```

Expected: deterministic operation order, undo/redo/reset, point conversion, caps, naming, and replay
tests pass with no DOM required.

### Step 4 — Implement the overlay editor

Mount the DOM editor only in the frame runtime. Implement source loading/decoding, memory limits,
responsive canvas sizing, pointer capture, text overlay, toolbar, shortcuts, live status, export, POST,
and typed close result. Inject browser primitives behind small functions so tests can control failures.

```sh
pnpm --filter @acorn/plugin-agent-attachment-image test -- ImageEditor
```

Expected: loading, pen, text, keyboard history, cancel, unchanged, encode failure, oversize export,
upload retry, result payload, and teardown cases pass.

### Step 5 — Implement the remote preview and owner handoff

Mount the remote tree only in the worker runtime. Render the compact preview, call the associated
overlay with current metadata, parse its result, and invoke `replace` with compare-and-swap ids. Test
prop changes and disposal while promises are pending.

```sh
pnpm --filter @acorn/plugin-agent-attachment-image test -- AttachmentPreview
pnpm --filter @acorn/plugin-agents test -- AttachmentSlot AgentComposer
```

Expected: cancel/unchanged do not invoke; applied invokes exactly once; stale ids are refused; original
ordering and removal remain owned by agents; the queued input contains the replacement id.

### Step 6 — Integrate and bundle

Add `agent-attachment-image` to `apps/desktop/scripts/build-bundled-plugins.mjs`. Add an integration
fixture with a tiny known image that draws a known stroke, commits it, and verifies the replacement
bytes—not just the new filename—reach the managed-agent driver resolution path.

```sh
pnpm --filter @acorn/node build:plugin agent-attachment-image
pnpm --filter @acorn/desktop test
```

Expected: desktop staging contains the new loaded package, boot accepts it, and the altered-pixel
integration passes.

### Step 7 — Document and close

Move shipped facts to the owning documentation:

- add the plugin to `docs/first-party-plugins.md` and `docs/plugin-map.md`;
- describe the visible attachment behavior and immutable replacement in `docs/managed-agents.md`;
- add build/test and manual smoke coverage to `docs/testing.md`.

The platform prerequisite is already owned by current documentation and its own future file was
deleted on 2026-09-04: `docs/plugins.md` § Asking the owner, § Companion overlays and § Binary bridge
calls, `docs/plugin-authoring.md` § Asking the host for something, `docs/managed-agents.md` § Draft
attachments, `docs/security.md` § Rung 0, `docs/frontend.md` § Node data access, and `docs/tui.md`
§ Rectangles for the terminal's answer.

Once this plugin ships, delete this file or reduce it to a pointer.

Run final gates:

```sh
pnpm lint
pnpm --filter @acorn/plugin-agent-attachment-image test
pnpm --filter @acorn/plugin-agents test
pnpm --filter @acorn/desktop test
pnpm test
```

Expected: every command exits 0. Use `pnpm test`, not `turbo run test`, for the full suite.

## Test plan

### Unit tests

- history: commit, undo, redo, redo invalidation, reset, caps, dot stroke;
- coordinates: corners, center, scale, zoom, clamping, zero rectangle refusal;
- width presets: tiny, normal, and 8,192-pixel images;
- output naming: extensions, multiple dots, existing `-annotated`, unsafe/empty base fallback;
- raster replay: base first, stable operation order, line settings, text line baseline;
- wire guards: missing, malformed, additive, wrong-MIME, and stale-id payloads; and
- route adapter: exact binary/header/error cases listed above.

### Component/lifecycle tests

- preview opens the associated overlay with the exact current attachment;
- two previews from one worker open their respective attachments;
- double press creates one invocation;
- cancel, unchanged, applied, malformed result, owner rejection, prop change, and unmount;
- editor load success/failure/retry and abort;
- pen pointer capture/move/up/cancel;
- text add/cancel/empty/multiline;
- undo/redo shortcuts and editable-target handling;
- Apply states and disabled controls;
- no-op apply, encoding null, oversize output, POST error/retry, and close payload; and
- cleanup of bitmap, URLs, events, animation frames, and pending requests.

### Integration tests

1. Attach a known 4×4 PNG, edit one known pixel region, commit, queue, and decode the resolved driver
   image to prove the stroke exists.
2. Attach a JPEG carrying EXIF rotation, place text, and prove exported orientation/dimensions match
   the editor view.
3. Cancel after edits and prove source hash and draft id are unchanged.
4. Remove source during editing and prove a late result cannot reinsert it.
5. Make POST succeed and owner commit fail; prove source remains and candidate is unreferenced.
6. Make old-source cleanup fail after commit; prove replacement still queues.
7. Call the plugin route with a referenced source and prove it is refused.
8. Attempt client access to `/v2/p/agents/*` and prove the bridge refuses before transport.
9. Disable the plugin and prove the default preview/removal/send behavior is unchanged.
10. Reopen after cancel and prove no operation history survives.

### Manual desktop checks

- Pen follows the pointer at all four corners at zoom-to-fit on a Retina display.
- Small/medium/large widths are useful on both a phone screenshot and a high-resolution photo.
- Text appears where placed and stays aligned after resizing the overlay.
- Focus begins inside the editor, stays trapped, and returns to the initiating preview.
- Escape cancels active text before dismissing the dialog.
- Light, dark, and each style pack keep controls readable without changing output colours.
- A source near 10 MiB and one near the decoded-pixel ceiling fail without freezing the shell.
- Node disconnect during load/upload yields a recoverable error.
- Switching tasks or disabling the plugin leaves no orphan overlay or permanently busy preview.
- A real managed-agent turn visibly contains the annotated image.

## Done criteria

- [ ] The package builds as a loaded Node/client plugin and is present in desktop bundled resources.
- [ ] Its manifest requires agents and requests only `agents.draftAttachments`.
- [ ] PNG/JPEG previews are editable; other MIME types retain the agents fallback.
- [ ] Pen, text, history, reset, cancel, and apply meet the interaction rules above.
- [ ] Image bytes never use JSON, base64, data URLs, remote props, or tree mutations.
- [ ] Apply creates an immutable candidate and the composer compare-and-swaps its id.
- [ ] The existing driver receives altered pixels in an automated integration test.
- [ ] Wrong-task, referenced, stale, oversize, decode-bomb, offline, and cleanup-failure cases are
  covered.
- [ ] Removing the plugin restores default attachment behavior without data migration.
- [ ] `pnpm lint`, focused package tests, desktop tests, and `pnpm test` pass.
- [ ] Shipped behavior is documented by its owners and this future file is retired.

## STOP conditions

Stop and report rather than improvising if:

- the platform implementation is not present after syncing;
- the shipped platform lacks slot-bound overlay input/result, owner action invocation, binary bodies,
  or the agents draft-attachment capability;
- opening an overlay is still bundle-bound rather than mounted-slot-bound;
- using the capability would require a filesystem path to cross into the plugin;
- the only apparent route is direct client access to `/v2/p/agents/*`;
- the agents capability permits referenced/sent attachments to be replaced;
- the loaded-plugin builder cannot emit `requires.plugins` or the companion overlay declaration;
- Canvas/JPEG decoding does not honor EXIF orientation consistently in the supported desktop runtime;
- the required editor would exceed current 10 MiB encoded or 40 MP decoded limits without a product
  decision to add resizing/quality controls; or
- implementation requires adding canvas/pointer semantics to the host-neutral closed kit.

## Refused alternatives

- **Compiled plugin:** unnecessarily expands trust and hides whether the loaded-plugin platform works.
- **Base64 JSON:** adds size and copies, and makes image content easier to leak into logs.
- **Direct agents routes:** violates cross-plugin namespace confinement.
- **In-place blob edits:** breaks content addressing, deduplication, and the evidence of sent turns.
- **Node-owned draft replacement:** the unsent draft is client state and cannot be transacted by Node.
- **Full-canvas undo snapshots:** unsafe memory growth at supported image dimensions.
- **A canvas kit node:** leaks pixel and pointer semantics into the TUI for a use case already served by
  an iframe rectangle.
- **GIF/WebP flattening:** silently destroys animation.
- **Always-PNG output:** can make annotated photographs exceed attachment limits.
- **Silent resizing or quality reduction:** changes user content without a visible product decision.
- **Persisting unfinished edits:** duplicates sensitive image content and adds recovery semantics that
  a lo-fi editor does not need.

## Maintenance notes

- If agents changes attachment byte/count ceilings, import or return those values through a contract;
  do not let the plugin's local precheck become the authority.
- If the closed kit later gains a safe bitmap-thumbnail node, the compact preview may adopt it without
  changing editor, route, or replacement contracts.
- If animated image editing is added, it is a separate renderer/export model and should not extend the
  raster operation model by special cases.
- If crop/resize is added, clarify whether operation coordinates remain in original or transformed
  space before writing code; that is a data-model decision.
- Reviewers should pay particular attention to buffer copies, bitmap/canvas lifetime, stale-result
  compare-and-swap behavior, and capability task/reference checks.
- The plugin has no migration. Adding a database later requires a concrete durable entity; preferences
  alone belong in namespaced plugin state.

## Verify before building

The seams below shipped on 2026-09-04 and their tests are named in Step 0. Everything here is still
worth re-reading before you start, because this file will outlive at least one of these facts:

- `agents:attachment` is still a remote, replace-mode point, and still declares `replace` in its
  `actions`. It sets no `selector` today, so if you want the settings picker and developer view to say
  what the arbitration is over, adding `selector: 'mediaType'` is part of your work.
- The agents owner still renders removal outside the replaceable preview and owns compare-and-swap of
  its local `AgentAttachment[]` draft.
- Attachment storage is still immutable, task-scoped, content-addressed, limited to 10 MiB per file,
  and garbage-collects unreferenced candidates.
- Queue validation still creates turn attachment references, and drivers still resolve ids only at
  dispatch.
- Loaded client bundles still run as a worker for remote trees and an iframe for frames, with one built
  bundle capable of selecting the runtime before mount.
- The frame CSP still prevents direct network access and the binary bridge uses the pinned node
  transport.
- Another plugin's route namespace remains denied.
- The desktop bundled-plugin roster is still `apps/desktop/scripts/build-bundled-plugins.mjs`. As of
  2026-09-04 `apps/node/scripts/build-plugin.mjs` still writes no `requires` block into a generated
  manifest, so extending it, with a builder test, is part of this work and not something the
  prerequisite covered.
- Read `PLUGIN_API_MAJOR` out of `packages/protocol/src/plugin/apiVersion.ts` rather than copying a
  number from any proposal. The seams this plugin uses were additive and did not bump it.
- One thing neither the prerequisite nor this plan has proven: whether the loaded-plugin builder's
  single client bundle survives a DOM-or-worker branch in one entry. Check it against a hybrid fixture
  before writing the plugin entry against it.
- The repository-wide lint baseline is green before attributing failures to this plugin.
