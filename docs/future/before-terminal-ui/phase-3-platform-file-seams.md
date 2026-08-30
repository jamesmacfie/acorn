# Phase 3: picking and saving files go through the platform seam

Status: not started. Waits on nothing.

## Goal

The platform seam gains two verbs — pick files, save a file — and the agents plugin uses them. The
hidden `<input type="file">` in the composer and the repo's only two download anchors are gone, and
an attachment or an export works the same way on any host that implements the verbs.

## Why this phase, and why now

Attach and download are the two agents behaviours that genuinely need the platform, and today both
reach it through the DOM because the seam is short two verbs. The composer holds an
`HTMLInputElement` whose only purpose is `.click()`; the artifact card and the transcript export
build `document.createElement('a')` anchors around a Blob. Neither has any DOM in its actual data
flow — the composer reads bytes and posts them to the node, the downloads receive bytes and want
them on disk — so the DOM here is pure dialog plumbing, and dialog plumbing is exactly what the
platform seam exists for. The groove is well worn: `pickFolder` already runs dialog-in-shell over a
Tauri command, with a probe-only seam group because calling it would open a dialog.

## Scope

In:

- **`pickFiles(opts): Promise<PickedFile[]>`** where a `PickedFile` is `{ name, type, bytes }`. The
  desktop shell opens the multi-select dialog (the dialog plugin is already in the Rust tree for
  `pick_folder`), reads each chosen file, and returns bytes. Options carry the accept list the
  composer's input declares today.
- **`saveFile({ bytes, suggestedName, mimeType }): Promise<boolean>`** — the save dialog plus the
  write, in the shell; `false` on cancel.
- The plumbing each verb owes, which is one pass for both: a Rust command in
  `apps/desktop/src-tauri/src/commands.rs`, a bridge entry in `apps/desktop/src/shell/bridge.ts`,
  a type and accessor in `packages/client-core/src/infra/platform/index.ts`, a seam group in
  `packages/client-core/src/infra/platform/contract.ts` (probe-only, like `folderPicker`, for the
  same reason: resolving by call would open a dialog), the contract test, and re-exports through
  `packages/plugin-api/src/client.ts`.
- Call sites: `plugins/agents/src/client/composer/AgentComposer.tsx` replaces the hidden input, the
  ref, and the Attach button's `.click()` with `pickFiles`; the attach flow from there is unchanged
  (`addFiles` caps, then uploads bytes to the node).
  `plugins/agents/src/client/sessions/AgentEventCard.tsx` and
  `plugins/agents/src/client/sessions/agentPaneModel.ts` replace their Blob-anchor rituals with one
  `saveFile` call each; the shared filename-sanitising regex both already use becomes one helper.

Out: the drag-and-paste path — `MentionTextarea`'s `onFiles` already hands the composer `File`
objects through a kit prop and keeps working on any DOM host. Also out: a TUI implementation; the
terminal host implements the verbs when it exists (a path prompt read client-side for pick, a path
written for save), and until then the seam group is absent there, which the probe reports honestly.

## Design detail

**Bytes cross the seam, not paths.** The alternative — a picker returning paths plus a node route
that reads them — was refused ([refused.md](./refused.md)) because it breaks on the deployment this
product is built around: the client and the node are not always the same machine, and the file being
attached is on the person's machine, not the node's. Bytes keep the flow client-local-file → bytes →
existing upload route, with no protocol change and no node filesystem reads on the client's behalf.
The composer already enforces an 8-attachment, 25 MiB cap before upload, so the byte arrays crossing
the bridge stay bounded.

**`saveFile` swallows the web fallback.** The Blob-anchor trick does not disappear from the world,
it moves inside the seam's web implementation, where a future browser host can keep using it. Call
sites stop knowing it exists.

**Where the dialog opens from.** Both verbs are shell dialogs, so they follow `pickFolder`'s
custody: the renderer asks, the shell owns the dialog and the filesystem touch. The renderer never
receives a path from `saveFile`, only success.

## Code touched

- `apps/desktop/src-tauri/src/commands.rs`, `apps/desktop/src-tauri/src/lib.rs` (handler
  registration)
- `apps/desktop/src/shell/bridge.ts`
- `packages/client-core/src/infra/platform/index.ts`, `packages/client-core/src/infra/platform/contract.ts`
- `packages/plugin-api/src/client.ts`
- `plugins/agents/src/client/composer/AgentComposer.tsx`
- `plugins/agents/src/client/sessions/AgentEventCard.tsx`,
  `plugins/agents/src/client/sessions/agentPaneModel.ts`

## Tests

- The platform contract test grows the two groups, keeping the "absent is a supported state" shape
  the contract already tests for preview and webviews.
- A composer test drives attach through a stubbed `pickFiles` and asserts the upload call receives
  the bytes; an export test drives `saveFile` and asserts content and suggested name.
- The Rust suite covers the two commands the way it covers `pick_folder`.

## Docs owed

- The document that owns the platform seam's verb list gains the two verbs (see
  [docs-migration.md](./docs-migration.md)).
- `docs/managed-agents.md`, if it narrates the attachment flow, stops mentioning a file input.

## Doors left open

1. A streaming shape for large files if the caps ever rise; today's bounded byte arrays make
   structured-clone across the bridge fine.
2. `pickFiles` returning paths *as well* for hosts where the caller legitimately wants one (the TUI
   editor handoff wants a path, not bytes) — a second member on the same group, added when that
   caller exists.

## Done when

- `plugins/agents/src/client` contains no `<input`, no `HTMLInputElement`, and no
  `document.createElement` (grep, non-test files).
- Attach and export work end to end on the desktop: pick two files, see them uploaded; export a
  transcript, find the file where the dialog saved it.
- Contract tests, the Rust suite, and `pnpm lint` are green.

## Verify before building

- The seam still has only `FolderPicker` as a dialog verb (`platform/index.ts`), and
  `contract.ts`'s `folderPicker` group is still probe-only with empty members — the pattern to copy.
- `pick_folder` is still the dialog command in `commands.rs`, confirming the dialog plugin is in the
  Rust dependency tree.
- The composer's `addFiles` still reads bytes client-side and posts them through
  `managedClient.ts`'s upload; the two download sites still hold the only `createElement('a')`
  calls in the repo (grep).
- `MentionTextarea` still exposes `onFiles`, so paste and drop need no change.
