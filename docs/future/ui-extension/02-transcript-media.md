# Phase 02: add transcript media viewers

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
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
