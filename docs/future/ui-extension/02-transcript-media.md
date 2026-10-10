# Phase 02: add transcript media viewers

Status: done, October 10, 2026. Branch `phase-02-transcript-media`, from `d70de4fd7`.

## Completion note

Another plugin can draw the body of a sent attachment's tile and of an artifact card. It reads the
bytes through a read-only Agents capability that checks the media belongs to the session and the
session to the task. The card keeps the filename, size, and download outside the slot, so they stay
reachable whoever draws the body. With every contributor absent, the transcript looks and behaves as
it did.

### What landed

- **Contract.** `plugins/agents/src/contract/transcriptMedia.ts` holds both point names,
  `TranscriptMediaProps`, `transcriptMediaType`, and the `agents.transcriptMedia` capability.
  `acorn-plugin-types` mirrors the capability as `TranscriptMediaCapability` and `TranscriptMedia`,
  the way it mirrors `editor.files`.
- **Points.** `agents:transcript-attachment` and `agents:artifact`, both `remote`, `replace`,
  `max: 1`, and no actions, registered in `plugins/agents/src/client/index.ts`. Props are
  `{ taskId, sessionId, media: { kind, id, filename, mediaType, byteSize? } }`. An artifact's
  `filename` is its title.
- **Capability.** `server/sessions/transcriptMedia.ts`, provided in `node/index.ts` beside
  `agents.draftAttachments`. It checks the session's task first. An artifact must have the named
  session. An attachment must belong to the task and be claimed by a turn of that session, which
  `AgentAttachmentStore.sentIn` answers with one join. Content over 12 MiB returns the descriptor
  with `bytes: null`. Every refusal is `null`. It reuses the stores' `get` and `read` and writes
  nothing.
- **Cards.** `AgentAttachmentCard` takes an optional `transcript: { taskId, sessionId }`. With it, the
  whole owner tile is the slot's default child, and a `MediaDownloadRow` appears under a contributed
  body. `AgentArtifactCard` puts its body in the slot and keeps its download row outside. The owner's
  picture moved into the default child in both cards, so a card a plugin draws fetches no thumbnail.
- **Discovery and docs.** The `plugin_authoring` brief names both points, their key, their props, and
  the capability. [Transcript media viewers](../../managed-agents/attachments.md#transcript-media-viewers)
  owns the contract, and [remote points](../../plugins/remote-points.md) has two table rows.

### Decisions and deviations

- **The key drops parameters.** Artifacts store `text/plain; charset=utf-8`, so the key and
  `media.mediaType` are the lowercase type before `;`. An artifact with no media type is
  `application/octet-stream`. Attachments store the type the upload check settled on, so JSON and
  Markdown uploads arrive as `text/plain` or `text/markdown`, not `application/json`.
- **The queue keeps the plain tile.** A queued turn's attachment references can still be replaced by
  an edit, so only sent turns in the transcript open the point. Attachments of queued turns are still
  claimed by the session, so the capability would read them.
- **The tile is the default, not just its picture.** The attachment tile is a pressable card. Putting a
  contributor's interactive tree inside a button would be wrong, and switching the card between
  pressable and plain on occupancy would remount the slot. So the slot wraps the whole tile and the
  owner draws the name, size, and download row below a contributed body, as `AttachmentSlot` does with
  its remove control.
- **Bodies mount only where cards are drawn.** The transcript already draws only its window of cards,
  so no extra visibility gate was needed.
- **No committed loaded fixture.** As in phase 01, the automated tests use compiled contributors, and
  the loaded text and JSON viewer was a scratch plugin in `/tmp`. Its Node half called
  `agents.transcriptMedia` from its own `/media` route, and its tree read that route with
  `bridge.api.getBytes`, capped parsing at 64 KiB, and drew a kit `CodeBlock`. No companion overlay
  fixture, because no pixel viewer was tested.
- **`requires.plugins` isn't emitted by `build:plugin`.** The scratch plugin declared only the
  capability, which was enough. The docs keep the `requires` advice that `agents.draftAttachments`
  already gives.

### Verification

Run with Node 26.8.1.

- `transcriptMedia.test.ts`, 10 tests: wrong task, wrong session, an unsent draft, a sibling session's
  send, wrong kind, unknown IDs, a deleted row, missing content, the 12 MiB ceiling, media type
  normalization, and a read that changes no row or byte even after the caller scribbles on the result.
  Removing the `sentIn` check or the artifact session check fails a test.
- `AgentAttachmentCard.test.tsx`, 6 tests, and five new `AgentArtifactCard.test.tsx` tests: the owner
  fallback, a contributor's body with the download outside, no thumbnail fetch while a plugin draws, a
  tie drawing the owner's body, disabling the contributor, the queue's plain tile, a late answer for a
  replaced attachment, and a Node switch rereading the attachment. The lease tests in
  `agentMediaStore.test.tsx` pass unchanged.
- `pnpm test --filter=@acorn/plugin-agents`: 1,429 of 1,430 pass. The failure,
  `managedBridge.test.ts > folds a tool call only for a reader that asks`, fails the same way with
  this phase's agents and plugin-types changes removed.
- `@acorn/node-core`: 1,749 pass. `acorn-plugin-types`: 5 pass. `@acorn/tui`: only the two known
  `chrome.test.tsx` task-marker failures.
- `pnpm --filter @acorn/arch-tests test`: only the known `docPaths` failure, 15 links. The
  published-surface snapshot gains the two plugin-types names.
- `pnpm lint`: oxlint reports warnings only. Type checks fail only in the agents plugin's known files,
  and nothing in this phase's files fails in the agents or terminal type checks.
- **Desktop, `pnpm dev:agent`.** A scratch seeder added an imported session with a sent `data.json`
  and `notes.md` and a text artifact. The trust prompt listed **Use capability
  agents.transcriptMedia**. All three bodies drew through the loaded viewer, each with the owner's
  name, size, and **Download** row. After disabling the plugin and restarting the node, the tiles were
  the owner's pressable `data.json · 1 KiB` again and the artifact was the bare download row.
- **Terminal, `pnpm dev:tui:agent`.** The same seed and plugin. The trust prompt listed the
  capability, all three bodies drew in cells with the download rows outside, and after disabling, the
  owner's tiles and download row came back.

### What later phases need to know

- An owner whose default is a pressable card should make the whole card the slot's default and draw
  its essential controls beside a contributed body. Toggling a card's `onPress` on occupancy remounts
  the slot's children.
- A narrow attachment tile truncates its download label when a contributor draws, because the tile's
  column is only as wide as its content. It's cosmetic, and the row stays pressable.
- `pluginDisable.test.ts` in `@acorn/node` fails on an untouched checkout, because its golden lacks
  `workflows.invocation`, `agents.toolCaller`, and the workflow tools. This phase added only its own
  capability line. Regenerating with `UPDATE_PLUGIN_GOLDENS=1` fixes the rest.
- `managedBridge.test.ts > folds a tool call only for a reader that asks` fails on an untouched
  checkout too.
- For a point registered in code, the trust prompt still quotes the contributor's label, as in
  `Draw its own UI inside agents’s “Text viewer”`, as phase 01 recorded.

## Original plan

Planned October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 01. Editor viewers already supply the file-viewer precedent.

Let plugins render stored attachments in sent turns and agent-produced artifacts. Keep unsent draft
editing separate and preserve the owner's filename, size, and download affordances.

## Starting point and scope

`plugins/agents/src/client/sessions/AgentAttachmentCard.tsx` draws sent attachment tiles and images.
`plugins/agents/src/client/sessions/AgentArtifactCard.tsx` draws images or a download row.
`plugins/agents/src/client/sessions/agentMediaStore.ts` leases immutable media by Node, kind, and ID.
`plugins/agents/src/contract/draftAttachments.ts` is a declared-capability precedent, but it permits
draft replacement and cannot be reused for stored transcript content.
`plugins/agents/src/server/routes/managed.ts` checks media ownership before reads.

Read [attachments](../../managed-agents/attachments.md), [remote points](../../plugins/remote-points.md),
and [binary reads](../../plugins/frames.md#binary-bridge-calls).

## Contract

Agents owns `agents:transcript-attachment` and `agents:artifact`, each `remote`, `replace`, keyed by
lowercase media type. Use `application/octet-stream` for unknown types. The existing
`agents:attachment` point remains the unsent composer point.

Pass `{ taskId, sessionId, media: { kind, id, filename, mediaType, byteSize? } }`. Resolve attachment
metadata before selecting its renderer. Resolve and verify artifact/session ownership from the store;
do not infer it from title or a client-supplied session. The host binds the Node.

Add an Agents-owned read-only Node capability, proposed `agents.transcriptMedia`, with
`read({ taskId, sessionId, kind, id })`. Return verified descriptor and bytes, or `null` for missing,
wrong-owner, or inaccessible content. No delete, replacement, or arbitrary path method is included.
Honor archival ownership rules and the 12 MiB client byte cap; larger content retains owner download.

Loaded contributors declare the capability and Agents dependency, expose their own confined byte route,
and call `bridge.api.getBytes` on that route. A media ID is not access to `/v1/p/agents/`.
Use a declared companion overlay when a real pixel viewer needs expansion. Do not add inline frame
replacement or arbitrary HTML execution to the transcript in this phase.

## Steps

1. Add capability types beside Agents contracts and provide it in `plugins/agents/src/node/index.ts`.
   Use the stored ownership helpers and immutable content readers; keep one authoritative validation.
2. Declare both remote points in Agents client registration. Wrap only each preview body in `Slot`.
   Keep title, size, download, and missing-media recovery outside the replacement.
3. Keep built-in image or download views as fallback children. Mount custom bodies only inside the
   transcript's visible window or expanded card. Preserve media leases and release them on identity change.
4. Add a loaded text/JSON media viewer fixture with an own-route capability proxy. Parse only capped
   supported content and render kit nodes. Add a companion overlay fixture only if testing pixel expansion.
5. Recheck sent attachment presentation, image expansion, unknown media, oversized downloads, archived
   preview behavior, and the unchanged composer draft replacement path.

## Tests and acceptance

Follow `plugins/agents/src/client/sessions/AgentArtifactCard.test.tsx`,
`plugins/agents/src/client/sessions/agentMediaStore.test.tsx`, and
`plugins/agents/src/server/sessions/draftAttachments.test.ts` for component, lease, and capability tests.
Test wrong task/session/kind/ID, byte ceilings, deleted media, concurrent leases, contributor ties,
disable/reload, Node switch, and late capability results. Capability reads must not mutate media.

Run `pnpm lint`, `pnpm test --filter=@acorn/plugin-agents`, affected shared-contract suites and direct
consumers, `pnpm test --filter=@acorn/tui`, and `pnpm --filter @acorn/arch-tests test`; expect exit zero.
In both real hosts, show one sent attachment and one artifact with a loaded contributor, then disable
it and confirm fallback and download remain reachable. Terminal overlay refusal preserves static UI.

Complete when both viewer points work without granting the contributor writable draft or managed-session
access, and normal transcript media remains usable with every contributor absent.

## Verify before building

- Recheck attachment versus artifact ownership and how archived sessions resolve a task.
- Recheck the media lease lifetime and bridge byte limit.
- Stop if the read capability would need broad managed-agent access or mutate immutable stored bytes.
