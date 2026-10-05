# Phase 08: separate composer operations with explicit draft ownership

Review correction, October 6, 2026: **done**. A genuine frozen pnpm install completed under Node
24.21.0 without configuration or lockfile changes. Standard `pnpm lint` and architecture commands
passed. Isolated desktop and TUI fixtures created Acorn-managed interactive sessions with enabled
composers. Both retained drafts across task navigation, sent a turn with automatic context, and
retained a later draft. Native desktop control uploaded an isolated file. Live provider sends finished
before a deterministic concurrent-enqueue edit could be staged; the held component fixture proves
that race. The fixture has no replacement contributor or second Workflows view for the session, so
those paths remain covered by public component tests. See the
[review correction evidence](./evidence.md#phase-08-review-correction-2026-10-06).

Completion note, October 6, 2026: **done**. `composerState.ts` remains the sole mutable draft
owner per Node/session. `submitOperation.ts`, `attachmentOperations.ts`, and `contextOperations.ts`
now own the asynchronous work through a captured `ComposerOrigin`; the component retains local
presentation, focus, and effects. Submission acknowledges only submitted revisions, replacement
persists the new slot before old-row cleanup, and automatic capture keeps its shared single-flight
guard. A held automatic-capture test covers session and Node navigation. Focused composer tests,
all-package lint/type checks, agents/Node/TUI/desktop consumers, and architecture passed. The host
fixture showed the composer and task navigation on desktop and TUI at 120 by 40; its imported
session disabled sending and attachment controls. [Phase 08 evidence](./evidence.md#phase-08-composer-operations-2026-10-06)
records the exact limits, gates, artifacts, and module map. Phase 09 can use these owners without
changing draft scope or public contracts.

Date: 2026-10-04. Status: DONE. Risk: high; multiple surfaces share asynchronous draft state.
Prerequisite: accepted [phase 07](./07-tab-rail.md). Next: [phase 09](./09-workflow-activation.md).
Planning revision: `2ae55abb5`; inspect the accepted client state owners before extraction.

## Task and context

Make `plugins/agents/src/client/composer/AgentComposer.tsx` readable by moving submission, context
capture, and attachment operations into feature-owned modules. Its audited 776 lines combine these
operations with effects and rendering. The hard requirement is draft custody, not smaller files.

Multiple composers can show the same session. `composerDraftState(sessionId, nodeId)` in
`composerState.ts` is shared; local picker expansion and dismissed contexts are per view. Async
operations capture the originating session/Node/state so navigating cannot mutate the new view.
Sending acknowledges submitted revisions rather than clearing edits made while a request is held.

## Owners and invariants

- `AgentComposer.tsx`, `composerState.ts`, `agentComposerState.ts`, `composerDraftStorage.ts`.
- `automaticTaskContext.ts`, `replaceAttachment.ts`, `fileMentions.ts`, `AttachmentSlot.tsx`.
- `composerOwnership.test.tsx`, `composerState.test.tsx`, `AgentComposer.attach.test.tsx`, and
  `replaceAttachment.test.ts` beside those modules.
- [State scope](../../state-ownership/scope-rules.md), [managed agents](../../managed-agents.md),
  and the live managed-client submission/upload routes and wire types referenced by the component.

Preserve shared hydration/sending/uploading/capturing, view-local presentation, held draft releases,
single-flight automatic capture, per-revision acknowledgement, and consumed fork-context semantics.
Preserve the eight-attachment/25 MiB limits, partial upload success, replacement compare-and-swap,
and deletion only after the new attachment owns the slot. Keep focus on navigation, not stream updates.

## Implementation steps

1. Trace hydration, send, native picker, pasted upload, replacement, capture, and session-option update.
   Inventory the exact origin snapshot and completion guard for each await. Record which fields are
   shared by session/Node and which are local to the rendered view.
2. Extract a typed operation owner under the composer feature. Accept the shared draft state and
   captured origin plus narrow transport/context/picker ports. Do not create a fresh draft per
   component or expose mutable signal internals to unrelated features.
3. Separate submission assembly from transport where useful: prompt, file mentions, attachments,
   explicit/automatic context, policy, and source. Preserve payload omission/default behavior. The
   submit command owns in-flight state and acknowledges only the captured submitted revisions.
4. Move upload/replacement operations together with origin guards. Preserve successful uploads when
   siblings fail; update draft custody before deleting replaced server data. Cancellation/navigation
   cannot release a replacement guard owned by another surface or attach to the new session.
5. Move automatic/manual capture orchestration to its own cohesive owner if it otherwise obscures
   submission. Keep existing pure helpers and shared single-flight state. Local dismissal/filter
   choices stay with the view. Every effect runs under a disposed Solid owner.
6. Leave `AgentComposer.tsx` composing fields, slots, local presentation, focus, and operations. Avoid
   a generic command bus or a controller with the entire client host passed through.
7. Keep existing ownership tests through the public component/model boundary. Add only missing
   held-send/upload/capture cases needed to show origin custody and concurrent draft edits survive.
   Do not expose production internals solely to assert extraction details.
8. Inspect desktop and TUI with two surfaces for one session and with two Node/session origins.
   Submit while editing; navigate during picker/upload/capture; replace an attachment; return to a
   session; verify pending fork context is consumed once and focus stays with active typing.

## Verification

```sh
pnpm test:focus @acorn/plugin-agents src/client/composer/composerOwnership.test.tsx
pnpm test:focus @acorn/plugin-agents src/client/composer/AgentComposer.attach.test.tsx
pnpm test:focus @acorn/plugin-agents src/client/composer/composerState.test.tsx
pnpm test:focus @acorn/plugin-agents src/client/composer/replaceAttachment.test.ts
pnpm lint
pnpm test --filter=@acorn/plugin-agents --filter=@acorn/node --filter=@acorn/tui --filter=@acorn/desktop
pnpm --filter @acorn/arch-tests test
```

Use isolated sessions `trim-08` and `trim-08-tui` with the desktop/PTY drivers described in
[local development](../../local-development.md). Inspect screenshots and terminal output, including
120×40. Use fixture-controlled held operations for deterministic races; stop sessions after checks.

## Acceptance and handoff

- Shared draft state still has one owner per session/Node; every async completion targets its origin.
- Submission, attachments, and capture are understandable named operations with narrow typed inputs.
- Concurrent edits, multiple surfaces, fork context, limits, replacement safety, and focus pass existing
  proofs and real-host checks. No storage keys, wire contracts, or API major changes.
- Task/table/evidence describe the state ownership and module map for phase 09. Rollback restores
  component wiring and operation modules together; never clear persisted drafts as a workaround.

## Verify before building

Inspect live shared state and all ownership tests. Stop if the extraction would change draft scope,
acknowledgement, or attachment deletion order; redesign the seam to retain those guarantees.
