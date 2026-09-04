# Agent attachment image editor: a third-party plugin

Status: proposal, 2026-09-04. Not started. Every platform seam it needs is shipped.

This is a brief for a plugin that lives **outside this repository**. It is not a workspace package, it
is not in `plugins/`, and it is not on the desktop's bundled roster. It is a directory somebody else
builds, publishes and installs, and the point of writing it that way is that it proves the loaded-plugin
platform can carry a real feature without acorn shipping it.

Everything below was checked against the tree on 2026-09-04. Where this file describes a platform
behaviour it is summarising a document that owns it; read the owner before you rely on the summary.

| What | Owned by |
| --- | --- |
| Asking a slot's owner to do something | `docs/plugins.md` § Asking the owner |
| Opening your own overlay from a tree | `docs/plugins.md` § Companion overlays |
| Moving bytes over the bridge | `docs/plugins.md` § Binary bridge calls |
| Draft attachments and how one is replaced | `docs/managed-agents.md` § Draft attachments |
| Writing a plugin by hand, and what a manifest says | `docs/plugin-authoring.md` |
| What the sandbox refuses | `docs/security.md` § Rung 0 |

## Outcome

A plugin with id `agent-attachment-image` and display name **Image markup**. It replaces the compact
preview for unsent PNG and JPEG agent attachments. Pressing the preview opens a small, MS Paint-like
editor where a person draws freehand strokes or adds text. Apply creates a new immutable attachment and
asks the agent composer to swap the source id for it. The existing enqueue and driver path then sends
the altered image to the agent.

Two runtimes, because the feature genuinely needs both:

- the composer preview is a **remote tree** built from acorn's own kit nodes, so it inherits the
  shell's focus, keyboard handling, ARIA and style pack; and
- the editor is a **sandboxed overlay iframe** containing a DOM canvas, because a canvas is exactly the
  case a rectangle exists for.

Image bytes cross only through the binary bridge and the agents-owned draft-attachment capability.

## What you are building against

### The four seams

```ts
// On the mount handed to a tree renderer. `solidTree` puts it on your component's props beside
// `bridge`. Both are stable for the mount's life.
host.invoke<TResult>(action: string, payload?: unknown): Promise<TResult>
host.openOverlay<TResult>(overlayId: string, input?: unknown): Promise<TResult | null>

// On the bridge, in a frame. Routed through the node this surface is pinned to.
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

// In an overlay frame: what the tree passed, and how to answer it.
bridge.context.input          // unknown, under 64 KiB, overlay surfaces only
bridge.ui.close(result)       // resolves the tree's openOverlay call

// The node capability, typed for you in acorn-plugin-types.
import type { DraftAttachment, DraftAttachmentsCapability } from 'acorn-plugin-types'
```

`DraftAttachmentsCapability` is written out in `acorn-plugin-types` rather than left as an opaque
`HostOwned` brand, precisely so a plugin outside this repository can call it without casting every
return value.

### The declarative half

- `agents:attachment` is a `remote`, `replace`-mode point declaring one action, `replace`.
- A `remote` extension descriptor may name `overlay: "<one of your own overlay frames>"`. That
  association is the grant and it is also a valid opener, so you do not need a command whose only
  purpose is to make the overlay reachable.
- Overlay input and result are each capped at 64 KiB and are JSON. Bytes go over a route.
- Binary bridge calls are capped at 12 MiB either way, above the agents store's 10 MiB per-attachment
  limit.
- `/v2/p/agents/*` is not reachable from your sandbox and never will be. The capability is the seam.

Build no fallback for any of these. Not base64 JSON, not a data URL, not direct agents-route access,
not a filesystem read. If a seam is missing on the node you are running against, the honest answer is
that the plugin does not work there.

## Package shape

You own the repository, the toolchain and the release. Acorn only ever sees the output directory.

```text
agent-attachment-image/            your repo
  package.json
  tsconfig.json
  vite.config.ts                   or your bundler of choice
  src/
    node/index.ts                  the NodePlugin
    node/routes.ts                 Request in, Response out
    node/routes.test.ts
    shared/routes.ts               route builders both halves import
    shared/wire.ts                 the overlay input and result shapes
    client/index.ts                one entry, two runtimes
    client/preview/AttachmentPreview.tsx
    client/editor/mountImageEditor.ts
    client/editor/editor.css
    client/editor/model.ts         history and tools, no DOM
    client/editor/coordinates.ts   pointer to image space
    client/editor/rasterize.ts     replay and encode
  dist/                            what you ship
    acorn-plugin.json
    node/index.js
    client.js
```

`dist/` is the package acorn installs. Its layout is a convention; only `acorn-plugin.json` is a fixed
name, and every other path in the package is wherever that manifest says it is.

Two rules from `docs/plugin-authoring.md` decide your build:

- **The node half may import only relative paths and `node:` builtins**, unless you bundle it. An
  installed package has no `node_modules` beside it.
- **The client half is exactly one file.** A plugin origin serves one script.

You will want a bundler. The editor is a canvas with a Solid tree beside it, and hand-inlining the
handshake — which is the no-build profile's answer — buys you nothing here. With a bundler you get the
published SDK:

```sh
npm install acorn-plugin-sdk acorn-plugin-types solid-js
```

```ts
// vite.config.ts — the tree half compiles through Solid's universal renderer
solid({ solid: { generate: 'universal', moduleName: 'acorn-plugin-sdk/remote' } })
```

`acorn-plugin-sdk` is framework-free and dependency-free; bundling it into your one `client.js`
satisfies the single-file rule exactly as your own modules do. `acorn-plugin-types` is types only and
gives you a typed `ctx` with no runtime.

Do not add an image-editing dependency. Canvas 2D covers pen and text.

## The manifest

Hand-written, because you are not using acorn's in-repo builder. Point `$schema` at the published
schema and your editor validates it as you type.

```json
{
  "$schema": "https://acorn.sh/schemas/acorn-plugin.schema.json",
  "id": "agent-attachment-image",
  "name": "Image markup",
  "version": "0.1.0",
  "apiVersion": "10",
  "node": "./node/index.js",
  "client": "./client.js",
  "requires": { "plugins": [{ "id": "agents" }] },
  "permissions": {
    "api": [],
    "events": [],
    "node": { "core": [], "capabilities": ["agents.draftAttachments"] }
  },
  "contributions": {
    "frames": [
      { "target": "overlay", "id": "editor", "label": "Image markup" }
    ],
    "extensions": [
      {
        "id": "agent-image",
        "point": "agents:attachment",
        "label": "Image markup",
        "remote": "attachmentPreview",
        "matches": ["image/png", "image/jpeg"],
        "overlay": "editor"
      }
    ]
  }
}
```

Notes on the fields that matter here:

- `apiVersion` is a string, and `10` is the current major
  (`packages/protocol/src/plugin/apiVersion.ts`). Read it rather than trusting this file. A range such
  as `"10 || 11"` is legal if you intend to support both.
- `id` binds your route namespace, your renderer prefix and your SQLite filename, and it can never
  change. `name` in your `NodePlugin` must equal it.
- `requires.plugins` means your package does not load at all when agents is absent, and the roster row
  says which id was missing. It also means you initialize after agents, so the capability is registered
  by the time your `init` runs. It installs nothing — the owner installs both.
- `overlay: "editor"` is what makes that frame reachable. There is deliberately no command.
- Ask for no `api` scope. Task identity comes from the owner-scoped contribution and the capability
  does the authoritative ownership check. Ask for no filesystem, secrets, exec or network authority
  either; you need none of them, and the trust prompt shows the owner every one you request.

## Architecture and data flow

```text
AgentComposer draft holds source attachment A
  -> agents:attachment arbitration picks agent-attachment-image
  -> your remote AttachmentPreview draws the compact chip
  -> the reader presses Edit
  -> host.openOverlay('editor', metadata for A)
  -> your overlay frame GETs your own content route as bytes
  -> your node route calls agents.draftAttachments.read(A)
  -> the frame decodes A and records pen/text operations in memory
  -> Apply rasterizes base + operations and POSTs bytes to your replacement route
  -> your node route calls agents.draftAttachments.createReplacement(A, bytes)
  -> the agents store creates or deduplicates immutable attachment B
  -> the overlay closes with { kind: 'applied', ... }
  -> your preview calls host.invoke('replace', { expectedAttachmentId: A, replacementAttachmentId: B })
  -> AgentComposer compare-and-swaps A -> B, persists the draft, then cleans up A
  -> ordinary enqueue references B
  -> the existing driver resolution sends B's local image to the agent
```

Two ownership facts hold the whole design up. Your plugin never touches the draft array: it is client
state in the composer, and the composer is the only thing that can prove A still occupies that slot.
And your node half never claims a replacement has committed: it creates candidate B and stops.

## User experience

### Composer preview

For `image/png` and `image/jpeg`, replace the fallback attachment body with a kit preview showing the
image glyph, the filename, the rounded KiB size, an Edit affordance labelled `Edit <filename>`, and a
busy state while a result is being committed.

The agents plugin keeps the remove control, drawn outside the part you replace. You must not receive or
recreate attachment removal. That is what keeps the attachment removable when your plugin is disabled,
fails, or loses arbitration to another contributor.

The reference is a compact metadata chip, not a thumbnail. Match that density. Do not ask for an image
node in the closed kit as part of this work.

### Editor overlay

Host-owned modal chrome, plugin-owned body:

```text
┌ Image markup · screenshot.png ─────────────────────────────── × ┐
│ [Pen] [Text]   [● ● ● ● ● ●]   Width [S M L]  Undo Redo Reset  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│                    image canvas, fit to view                   │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│  PNG · 1920 × 1080                          [Cancel] [Apply]   │
└────────────────────────────────────────────────────────────────┘
```

First release: Pen and Text; black, white, red, yellow, green and blue; small, medium and large widths;
undo, redo, reset, cancel and apply; zoom-to-fit, with zoom in/out only if it stays contained; keyboard
shortcuts for history and dismissal. Initial state is Pen, red, medium.

Remember the last tool, colour and width in `bridge.state`, which is namespaced to your plugin and
capped at 1 MiB per value. Never persist the image or the operation history.

### Interaction rules

- Pointer down begins a stroke only when Pen is active.
- Pointer capture continues a stroke that leaves the canvas.
- Pointer up or cancel commits one stroke.
- A click with Text active places a textarea over the image at that image coordinate.
- `Cmd/Ctrl+Enter` or an explicit Add commits text. Escape cancels the text entry **before** it
  dismisses the overlay.
- `Cmd/Ctrl+Z` undoes; `Cmd/Ctrl+Shift+Z` and `Cmd/Ctrl+Y` redo.
- Reset asks for confirmation only when more than one operation exists; for a single one, Undo is
  enough and less interruptive.
- Apply with nothing committed behaves like Cancel and creates no attachment.
- Cancel, backdrop, the host's close control and navigation all discard the in-memory operations.
- Apply is disabled while loading, decoding, encoding or uploading.
- A failed upload keeps the operations so the reader can retry.

The overlay never closes because encoding or upload started. It closes only after the node has stored
the candidate.

## Scope

**In scope**: the package, its node route adapter, the remote preview, the overlay editor, the pure
edit model, tests, and a README your users read before installing.

**Out of scope**: PDF, GIF, WebP, SVG, HEIC, video or arbitrary preview; animated flattening; crop,
resize, rotate, selection, fill, shapes, layers, eraser, filters, eyedropper or clipboard paste; image
generation; editing an attachment after enqueue; writing to the worktree or the reader's source file; a
media library or a plugin database; a terminal canvas editor; anything that would need a change to
acorn's closed kit.

## The node half

A thin route adapter with no state:

```ts
import type { CapabilityIdOf, NodePlugin } from 'acorn-plugin-types'
import { createAttachmentImageFetch } from './routes'

// One line per capability, because acorn-plugin-types has no runtime: an `import { … }` that resolved
// to nothing would be a worse trap than a cast.
const AGENTS_DRAFT_ATTACHMENTS = 'agents.draftAttachments' as CapabilityIdOf<'agents.draftAttachments'>

export default {
  name: 'agent-attachment-image',
  init(ctx) {
    ctx.routes.fetch(
      createAttachmentImageFetch(() => ctx.capabilities.require(AGENTS_DRAFT_ATTACHMENTS)),
      { prefix: '', note: 'read and replace draft image attachments' },
    )
  },
} satisfies NodePlugin
```

Resolve the capability **per request**, as the getter above does. Plugin init order is undefined in
general; `requires.plugins` guarantees agents ran first, but a reload or a disable can still happen
underneath you, and a handle captured at init would then be stale. `require` throws when it is gone,
which your handler turns into a retryable dependency error.

`ctx.routes.fetch` takes a `(Request, PluginRequestContext) => Response`. Nothing in that signature
names a framework: bring your own router, bundle it, and hand over its `fetch`.

### Routes

Two endpoints, with builders in `shared/routes.ts` that both halves import so the spelling cannot
drift:

| Method | Path, relative to your namespace | Answers |
| --- | --- | --- |
| GET | `/draft-attachments/:attachmentId/content?taskId=…` | Raw bytes, with the source MIME, `Content-Length`, `Content-Disposition` and `Cache-Control: no-store`. |
| POST | `/draft-attachments/:attachmentId/replacements?taskId=…` | `{ attachment }` after the store has kept or deduplicated the candidate. |

The POST body is raw bytes; the media type and filename ride the headers `postBytes` sets. Do not wrap
them in JSON as well.

Validate the method, the path, and non-empty bounded task and attachment ids before you dispatch. Check
that the declared content length is within your ceiling where you have one. Then hand the bytes to the
capability and let it be authoritative on magic bytes, per-file size, the safe basename and the content
hash — your checks exist to fail fast, not to become a second source of truth.

Map a missing, wrong-task or already-sent source to one stable "not editable" error. Do not distinguish
them: telling a caller which one it was answers questions about attachments on tasks it cannot see. Map
an absent capability to a retryable dependency error. Pass structured errors through rather than
flattening everything to 500.

No route deletes anything. If the composer refuses the candidate it cleans up; otherwise the agents
store's own sweep collects it.

## One bundle, two runtimes

Your manifest names one `client` file and acorn loads it two ways: in a Web Worker for the tree, in an
iframe for the overlay. Branch before you mount.

```ts
import { mountFrame, mountTree } from 'acorn-plugin-sdk'
import { solidTree } from 'acorn-plugin-sdk/remote'
import styles from './editor/editor.css?inline'
import { AttachmentPreview } from './preview/AttachmentPreview'
import { mountImageEditor } from './editor/mountImageEditor'

if (typeof document === 'undefined') {
  mountTree({ attachmentPreview: solidTree(AttachmentPreview) })
} else {
  mountFrame({ styles }, (bridge, root) => mountImageEditor(bridge, root))
}
```

Never call both. A frame's handshake carries no tree port and a worker has no DOM.

Keep the editor free of Solid. It is DOM and canvas lifecycle, and the tree half already pulls Solid's
universal renderer into the bundle; adding the DOM renderer beside it puts two Solid instances in one
file for no gain.

`styles` is your stylesheet inlined as a string, because a plugin origin serves one script and nothing
else. There is no second asset to fetch.

**Verify this branch early.** Nothing in acorn proves that one bundle survives it — the four loaded
plugins acorn ships are trees only. Build a two-line fixture that mounts a trivial tree and a trivial
frame from one file, install it, and confirm both draw before you write the real thing against the
assumption.

## Shared wire shapes

```ts
export type EditorInput = {
  taskId: string
  attachmentId: string
  filename: string
  mediaType: 'image/png' | 'image/jpeg'
  byteSize: number
}

export type EditorResult =
  | { kind: 'applied'; expectedAttachmentId: string; replacementAttachmentId: string }
  | { kind: 'unchanged' }
```

`null` is the host telling you the reader dismissed the overlay. It is not an `EditorResult`, and every
dismissal path produces it: Escape, the backdrop, the close button, another overlay opening, your own
tree unmounting, navigating away.

Parse both shapes with small hand-written guards. Ignore fields you do not consume; validate the ones
you do.

The frame should check that `bridge.context.target` is `overlay`, that its input parses, and that the
input's MIME matches what the GET actually returned. The tree must require the result's expected id to
equal the id in its current props before it invokes the owner action.

Never put image bytes, operation history or annotation text in the input or the result.

## The remote preview

`solidTree` hands your component the owner's props, plus `bridge` and `host`:

```tsx
type PreviewProps = {
  attachment: DraftAttachment
  taskId: string
  sessionId: string
  bridge: AcornBridge
  host: TreeMount['host']
}
```

Its flow:

1. read `{ attachment, taskId, sessionId }` from props;
2. draw a kit `Chip`/`Button` composition at the default attachment density;
3. on press, capture the current attachment id and set a local busy state;
4. `await host.openOverlay('editor', input)`;
5. on `null` or `unchanged`, clear busy and stop;
6. on `applied`, check both ids and `await host.invoke('replace', { expectedAttachmentId, replacementAttachmentId })`;
7. wait for the owner's answer rather than optimistically redrawing; and
8. clear busy and error state unless the mount was disposed.

Call `openOverlay` from the press handler. The host honours it only while focus is inside your tree,
and at most once a second, so a background timer cannot put a modal in front of the reader. Catch
`unsupported_host` and leave the static preview up: the terminal draws trees and has no iframe, and a
control that cannot work is worse than no control.

If props change while the overlay is open, treat your captured id as stale. Acorn dismisses an overlay
when its source slot unmounts, but correctness rests on the owner's compare-and-swap, not on that.

Disable repeated presses while one invocation is live. On failure, leave the original preview and offer
Edit again. Use an inline status where the kit allows one; use a toast only for a failure that lands
after the overlay closed and has no editor left to show it in.

The preview has no remove control, never calls a managed-agent route, and never sees bytes.

## Editor domain model

The source bitmap is immutable; alterations are a list of operations.

```ts
type ImagePoint = { x: number; y: number }

type StrokeOperation = { kind: 'stroke'; color: EditorColor; width: number; points: ImagePoint[] }
type TextOperation = { kind: 'text'; color: EditorColor; size: number; at: ImagePoint; text: string }
type EditOperation = StrokeOperation | TextOperation

type EditorHistory = { committed: EditOperation[]; undone: EditOperation[] }
```

- Committing clears `undone`; undo moves the last committed onto it; redo moves it back; reset empties
  both.
- A stroke with fewer than two distinct points is a dot, not an empty operation.
- Empty or whitespace-only text is never committed.
- Cap text at 2,000 scalar values, committed operations at 1,000, and points at 20,000 per stroke. When
  a cap is hit, say so rather than silently truncating what gets exported.

Do not implement undo as `ImageData` snapshots. At the 40 MP decoded ceiling one RGBA snapshot is about
160 MiB before history or browser overhead.

The six colours are closed literals, never CSS from state. Widths resolve to image-space pixels from
the shorter side:

```ts
small  = clamp(round(shortSide * 0.002), 2, 12)
medium = clamp(round(shortSide * 0.005), 4, 32)
large  = clamp(round(shortSide * 0.012), 8, 72)
```

Store the resolved width on each operation, so changing the active preset does not rewrite history.

## Loading, and the memory ceiling

Fetch with an `AbortController`, build a `Blob` from the authoritative MIME the GET returned, and decode
with `createImageBitmap`. Revoke object URLs and close the bitmap on unmount.

Refuse, before allocating the working canvas, when a dimension is zero, either dimension exceeds 8,192
pixels, or `width * height` exceeds 40,000,000. Keep those as named constants beside their tests. The
10 MiB encoded limit does not stop a heavily compressed image from asking for an unsafe decoded
allocation.

`createImageBitmap` should bake JPEG orientation into the decoded pixels, so use `bitmap.width` and
`bitmap.height` as canonical and let the export inherit it. Add a fixture with non-default EXIF
orientation and prove it. If your runtime does not honour orientation consistently, stop and add an
explicit decoder rather than shipping an editor that rotates people's images.

Keep one source-sized render canvas. A second is acceptable during export but must not persist.

## Coordinates and pointer input

Every operation is in image space:

```ts
x = clamp((clientX - rect.left) * imageWidth / rect.width, 0, imageWidth)
y = clamp((clientY - rect.top) * imageHeight / rect.height, 0, imageHeight)
```

Correct under zoom as long as `rect` is the displayed canvas. Test four corners, the centre,
non-integer scaling, a letterboxed layout, and out-of-bounds clamping.

For Pen: Pointer Events only, never separate mouse and touch paths; `setPointerCapture` after a valid
down; one active pointer; round caps and joins; ignore pressure so a stylus and a trackpad export the
same thing; coalesce moves to one render per animation frame; skip a point closer than
`max(0.5, width / 8)` image pixels to the last. Render the active stroke without committing it. Pointer
cancel discards it. Unmount releases capture and cancels scheduled frames.

For Text, position a normal textarea over the canvas using the inverse mapping. Keep the text in DOM
state until commit. Rasterize with a documented font stack, explicit size, baseline and line height.
Wrap only if your wrapping is deterministic and tested; otherwise honour explicit newlines and do not
wrap at all.

## Rasterize and export

`rasterize` is deterministic for a given bitmap, dimensions and operation list: reset the transform,
clear, draw the base at decoded dimensions, replay operations in order, then encode.

- PNG in, PNG out, via `canvas.toBlob('image/png')`.
- JPEG in, JPEG out, via `canvas.toBlob('image/jpeg', 0.92)`.
- Never `toDataURL`.
- Never silently resize, change format or drop quality to fit a limit. Refuse and keep the editor open.
- Name the output `<base>-annotated.png` or `.jpg`, stripping an existing trailing `-annotated` first
  so repeated edits do not accumulate suffixes.
- A `null` from `toBlob` is a visible encoding failure, not an empty upload.

You do not need to compare your bytes to the source. The store deduplicates by content hash, so an edit
that changed nothing comes back as the source's own id — close with `unchanged` and do not invoke the
owner action.

## Apply

```ts
type ApplyState =
  | { kind: 'idle' }
  | { kind: 'encoding' }
  | { kind: 'uploading'; bytes: number }
  | { kind: 'closing' }
  | { kind: 'failed'; message: string }
```

1. Refuse a second apply.
2. Finish or cancel the active text edit, according to what the reader actually did.
3. Render and encode the base plus committed operations.
4. Reject locally if the bytes exceed the known maximum.
5. `postBytes` to your replacement route.
6. Validate the returned attachment: same task, sane metadata.
7. If its id equals the source id, close `{ kind: 'unchanged' }`.
8. Otherwise close with both ids.
9. Your preview invokes `replace` and waits for the composer's answer.

The editor cannot know whether the commit succeeded, because it is gone by then. If the owner rejects,
the preview reports it and the original stays. The candidate is cleaned up by the composer or collected
later as unreferenced.

Never delete the source from your route. The composer persists the replacement in the durable draft
before it cleans up the source, and a cleanup failure is not a failed replacement.

## Concurrency and failure

| Event | Required behaviour |
| --- | --- |
| Source removed while the editor is open | The slot unmounting dismisses the overlay. A late result still fails the owner's compare-and-swap and cannot reinsert the image. |
| The turn is sent while the editor is open | The capability refuses to replace a now-referenced attachment, and the owner refuses a stale swap. Sent evidence is unchanged. |
| Props change during editing | The result carries the captured expected id; only an exact match commits. |
| Node offline during GET | A retryable load failure. Never a blank editable canvas. |
| Node offline during POST | Keep the operations and allow retry. |
| Upload succeeds, then the client crashes | The candidate is unreferenced and the existing sweep removes it. The source id survives in the persisted draft. |
| Owner commit fails | The original remains. The preview reports it; the candidate is cleaned up. |
| Source cleanup fails after commit | The replacement is committed and sendable. The sweep gets the source later. |
| Your plugin is disabled | The agents fallback chip returns. The attachment and the draft are untouched. |
| Another matching preview plugin exists | Existing `replace` arbitration applies, and the reader picks. Do not try to win. |
| Reopen after Cancel or Apply | A fresh iframe with empty history. Acorn keys the overlay on the invocation, so this is free — but do not rely on module state surviving or not surviving. |
| Host with no overlays | `unsupported_host`. Render no Edit control; the static preview stays usable. |

## Accessibility

- The preview control's accessible name includes the filename, and it exposes busy and disabled state.
- Host chrome owns the dialog semantics, focus trap, close button and focus return.
- The toolbar uses real buttons with pressed state for the active tool, colour and width.
- Colour controls carry text names. Colour alone is never the label.
- The canvas has a concise accessible label with instructions associated by description.
- The positioned textarea is an ordinary labelled form control.
- Loading, encoding, upload failure and success go through a polite live region.
- Controls meet acorn's hit-target and focus-ring conventions in every style pack.
- Exported colours are fixed image values. Theme tokens style your chrome only.
- At narrow sizes the toolbar wraps and the canvas stays the one fitting region.
- Use kit components and props in the tree, never raw acorn CSS class names. Your frame's CSS may use
  the tokens the bridge pushes.

## Security and privacy

- Request the draft-attachment capability and nothing else.
- Keep client calls inside `/v2/p/agent-attachment-image/*`. The capability is your only cross-plugin
  data seam, and the bridge refuses another plugin's namespace before it reads a body.
- Treat the task id, attachment id, filename, MIME, dimensions and overlay result as untrusted at every
  boundary, including the one between your own two runtimes.
- Let the agents store be authoritative on magic bytes and on task and reference checks.
- Never return or log a local attachment path. You are never given one.
- Never log image bytes, operation lists, annotation text or full filenames. A text annotation is a
  person's content and must not reach an error message, a toast detail or a log line.
- If you log at all, log the MIME family, byte counts, decoded dimensions, a duration and a stable
  error code.
- No audit verb. This is a local transformation of an unsent draft, comparable to editing the prompt
  before sending. The queued turn is the durable record of what the agent received.
- Revoke object URLs, abort fetches, cancel animation frames, close the `ImageBitmap` and remove
  listeners on every exit path.
- Never recover an unapplied image from local storage. That would put image content in a second, less
  governed store.

## Implementation steps

### Step 0 — Read the seams, and run their tests

If you have this repository checked out, the tests are the specification and they run in seconds:

| What you need | Where it lives | Its tests |
| --- | --- | --- |
| `host.invoke` and a point's `actions` | `client-core/host/tree/hostRequests.ts`, `Slot.tsx`, `RemoteTree.tsx` | `RemoteTree.grants.test.tsx`, `hostRequests.test.ts` |
| `host.openOverlay` and the descriptor's `overlay` | `client-core/host/frames/overlays.ts`, `PluginOverlay.tsx` | `overlays.test.ts`, `RemoteTree.grants.test.tsx` |
| What `solidTree` hands your component | `client-core/host/frames/remoteSolid.ts` | `remoteSolid.test.tsx` |
| `getBytes` / `postBytes` | `client-core/host/frames/{broker,frameServices}.ts` | `broker.test.ts` § byte requests |
| `agents.draftAttachments` | `plugins/agents/src/contract/draftAttachments.ts` | `server/sessions/draftAttachments.test.ts` |

If you do not, the `plugin_authoring` agent tool answers with this contract plus the connected node's
*current* manifest vocabulary, action verbs and bridge messages, read off that node's own schemas. That
is the only way to be sure an answer is not from memory.

### Step 1 — Scaffold and prove the manifest

Create the package, the manifest above, an empty node factory and a client entry that mounts a trivial
tree and a trivial frame. Install it as a local folder and restart the node:

```http
POST /v2/core/plugins/install
{ "source": { "path": "/absolute/path/to/dist" } }
```

Settings → Plugins → *Local folder* does the same thing with a file picker when the target node is this
machine, and it symlinks rather than copies, so you edit in place and the next boot runs what you
edited. An agent writing this package cannot call that route; it asks with the `plugin_request` agent
tool and the owner approves. Asking with `dev: true` auto-trusts your later bundles, which turns the
loop into edit-and-reload.

Expected: the roster row is green, the trust prompt names only `agents.draftAttachments`, and both the
tree and the frame draw. If the roster row is red it names the offending manifest field paths and
whether the failure was at load, init or ready.

### Step 2 — The node route adapter

Route builders, request validation, per-request capability lookup, exact bytes out, raw bytes in. Test
with an injected fake capability. Never touch attachment storage directly — you cannot, and the seam
exists so you do not try.

Cover: GET returns exact bytes and headers; GET for a missing, wrong-task or referenced attachment is
refused without bytes; POST forwards the route's source id, task id, filename, MIME and exact bytes;
PNG and JPEG both succeed; spoofed, unsupported and oversize input surface as structured errors; an
absent capability is explicit and retryable; no error echoes bytes, a filename or annotation text; and
no response contains a filesystem path.

### Step 3 — The pure edit model

Operation types, history transitions, caps, width resolution, coordinate conversion, output naming and
raster replay. Use a recording fake 2D context rather than pixel snapshots for domain behaviour. None
of this needs a DOM, and keeping it that way is what makes it testable at all.

### Step 4 — The overlay editor

Mount it only in the frame runtime. Loading, decoding, the memory ceiling, responsive sizing, pointer
capture, the text overlay, the toolbar, shortcuts, live status, export, POST, and the typed close
result. Put browser primitives behind small injected functions so tests can make them fail.

### Step 5 — The remote preview and the handoff

Mount it only in the worker runtime. Draw the compact preview, open the overlay with current metadata,
parse the result, invoke `replace` with both ids. Test prop changes and disposal while a promise is
still pending.

Expected: cancel and unchanged invoke nothing; applied invokes exactly once; a stale id is refused;
ordering and removal stay the composer's; the queued turn carries the replacement id.

### Step 6 — Prove the pixels reach the agent

The acceptance test is not "the editor rendered". Attach a known small PNG, draw a stroke over known
pixels, Apply, queue the turn, and decode what the driver resolved. The stroke has to be in those
bytes. Do the same for a JPEG with EXIF rotation and assert the exported orientation matches what the
editor displayed.

### Step 7 — Ship

Write the README your users read before they approve the trust prompt: what it does, what it asks for,
and what it never sees. Publish the package. If you later want it in acorn itself, that is a separate
conversation about the bundled roster, not something this brief covers.

## Test plan

**Unit.** History: commit, undo, redo, redo invalidation, reset, caps, dot stroke. Coordinates: corners,
centre, scale, zoom, clamping, a zero rectangle. Widths: a tiny image, a normal one, an 8,192-pixel one.
Naming: extensions, multiple dots, an existing `-annotated`, an empty or unsafe base. Raster replay:
base first, stable order, line settings, text baseline. Wire guards: missing, malformed, additive,
wrong-MIME and stale-id payloads. Routes: the cases in step 2.

**Lifecycle.** The preview opens the overlay with the exact current attachment; two previews from one
worker open their own attachments and not each other's; a double press makes one invocation; cancel,
unchanged, applied, malformed result, owner rejection, prop change and unmount; editor load success,
failure, retry and abort; pen capture, move, up and cancel; text add, cancel, empty and multiline;
history shortcuts and editable-target handling; apply states and disabled controls; no-op apply, a null
encode, an oversize export, a POST error and retry; cleanup of the bitmap, URLs, listeners, frames and
pending requests.

**Integration.** The two pixel proofs from step 6, plus: cancel after edits leaves the draft and the
source hash unchanged; removing the source during editing means a late result cannot reinsert it; a
successful POST with a failed owner commit leaves the source and an unreferenced candidate; a failed
source cleanup after commit still queues the replacement; your route refuses a referenced source; the
bridge refuses `/v2/p/agents/*` before the transport; disabling your plugin leaves the default preview,
removal and send unchanged; reopening after cancel carries no history.

**Manual.** Pen follows the pointer at all four corners at zoom-to-fit on a Retina display. The three
widths are useful on both a phone screenshot and a high-resolution photo. Text lands where placed and
stays aligned when the overlay resizes. Focus starts in the editor, stays trapped and returns to the
preview. Escape cancels active text before dismissing. Light, dark and every style pack keep controls
readable without changing exported colours. A 10 MiB source and a near-40 MP source both fail or
succeed with clear feedback and no freeze. Disconnecting the node mid-load and mid-upload is
recoverable. Switching tasks or disabling the plugin leaves no orphan overlay and no stuck preview. And
a real agent turn visibly contains the annotated image.

## Done criteria

- [ ] The package installs as a loaded plugin and its trust prompt names only `agents.draftAttachments`.
- [ ] It does not load when agents is absent, and the roster row says why.
- [ ] PNG and JPEG previews are editable; every other type keeps the agents fallback.
- [ ] Pen, text, history, reset, cancel and apply meet the interaction rules.
- [ ] Image bytes never travel as JSON, base64, a data URL, a tree prop or a tree mutation.
- [ ] Apply creates an immutable candidate and the composer compare-and-swaps the id.
- [ ] An automated test proves the altered pixels reach the driver.
- [ ] Wrong-task, referenced, stale, oversize, decode-bomb, offline and cleanup-failure paths are all
      covered.
- [ ] Uninstalling restores the default attachment behaviour with no migration.

## Stop and ask rather than improvising if

- the node you are targeting lacks slot-bound overlay input and result, owner-action invocation, binary
  bodies, or the agents draft-attachment capability;
- `solidTree` does not hand your component a `host`, which would mean the node predates 2026-09-04;
- opening an overlay turns out to be bundle-bound rather than bound to the mounted slot;
- using the capability would require a filesystem path to cross into your plugin;
- the only apparent route is direct client access to `/v2/p/agents/*`;
- the capability lets you replace a referenced or sent attachment;
- your bundler cannot produce one client file that serves both runtimes;
- canvas or JPEG decoding does not honour EXIF orientation consistently in the runtime you support; or
- the editor would need to exceed the 10 MiB encoded or 40 MP decoded limits without a product decision
  about resizing or quality controls.

## Refused alternatives

- **Making it a compiled or bundled first-party plugin.** It expands trust and hides whether the
  loaded-plugin platform can actually carry a feature this shape. That is the thing being tested.
- **Base64 over JSON.** Size, allocation, decode work, and image content that is easier to leak into a
  log, in exchange for nothing.
- **Calling the agents routes directly.** Cross-plugin namespace confinement is a security boundary.
- **Editing the stored blob in place.** Content addressing, deduplication, draft recovery and the record
  of what was sent all depend on stored bytes never changing.
- **Letting the node replace the draft.** The unsent draft is client state and the node cannot transact
  with it.
- **Full-canvas undo snapshots.** Unsafe memory growth at the dimensions this permits.
- **A canvas node in the closed kit.** It would leak pixel and pointer semantics into the terminal host
  for a case an iframe already serves.
- **Flattening GIF or WebP.** A file that may be animated must not silently become one frame.
- **Always exporting PNG.** An annotated photograph can then exceed the attachment ceiling.
- **Silent resizing or quality reduction.** That changes a person's content without a visible decision.
- **Persisting unfinished edits.** It duplicates sensitive image content and adds recovery semantics a
  small editor does not need.

## Maintenance notes

- If agents changes its byte or count ceilings, read them through a contract rather than letting your
  local precheck become the authority.
- If the closed kit ever gains a safe bitmap-thumbnail node, the preview can adopt it without touching
  the editor, the routes or the replacement contract.
- Animated editing, if it ever happens, is a different renderer and export model. Do not extend the
  raster operation list with special cases for it.
- Crop and resize are a data-model decision before they are a feature: settle whether operation
  coordinates stay in original or transformed space before writing any of it.
- Reviewers should look hardest at buffer copies, bitmap and canvas lifetime, stale-result handling, and
  the capability's task and reference checks.
- You own no tables. If you ever need one, it needs a concrete durable entity first; preferences belong
  in namespaced plugin state.

## Recheck before you start

This file will outlive at least one of these facts.

- `PLUGIN_API_MAJOR` is `'10'` (`packages/protocol/src/plugin/apiVersion.ts`). Read it; do not copy the
  number from here. The seams this plugin uses were additive and did not bump it.
- `agents:attachment` is still `remote`, `replace` mode, and still declares `replace` in its `actions`.
  It sets no `selector`, so the settings picker and developer view cannot yet say what the arbitration
  is over. Adding `selector: 'mediaType'` would be a change to the agents plugin, not to yours.
- The composer still draws removal outside the replaceable preview and still owns the compare-and-swap
  of its local draft.
- Attachment storage is still immutable, task-scoped, content-addressed, capped at 10 MiB per file, and
  still collects unreferenced rows after 24 hours.
- Enqueue still creates the turn's attachment references, and drivers still resolve ids at dispatch, so
  swapping the id before enqueue is still sufficient.
- A loaded client bundle still runs as a worker for a tree and an iframe for a frame.
- The frame CSP still forbids direct network access, and the binary bridge still rides the pinned node
  transport.
- Another plugin's route namespace is still denied at the broker, before the transport is called.
