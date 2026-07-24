# Implementation plan

## Plan contract

This plan was prepared against repository commit `98d6110` on 2026-07-11. It is an implementation handoff, not authorization to overwrite concurrent work.

Before each phase:

```bash
git status --short
git rev-parse HEAD
```

The planning worktree already contained unrelated public-API schema and migration work, including migration number `0023`. Reconcile the current migration journal and choose the next free migration number; do not copy a hard-coded number from this plan.

Each phase should be a reviewable commit where practical. Keep core pressure changes separate from the Chat plugin so the architectural boundary is visible.

## Target layout

```text
apps/desktop/src/
├── core/
│   ├── client/
│   │   ├── notifications/              # generalized typed targets
│   │   ├── registries/sources.ts       # workspace-native availability
│   │   └── ui/markdown/                # safe shared markdown/code rendering
│   ├── main/wsHub.ts                   # chat frame fan-out
│   ├── server/db/                      # schema + cascade obligations
│   └── shared/ws.ts                    # typed chat frames
└── plugins/chat/
    ├── index.ts
    ├── shared/
    │   ├── contracts.ts
    │   ├── errors.ts
    │   └── capabilities.ts
    ├── server/
    │   ├── index.ts
    │   ├── routes.ts
    │   ├── repository.ts
    │   ├── runService.ts
    │   ├── requestAssembler.ts
    │   ├── attachmentStore.ts
    │   ├── credentialService.ts
    │   └── providers/
    │       ├── registry.ts
    │       ├── openai.ts
    │       ├── anthropic.ts
    │       └── fake.ts
    └── client/
        ├── index.ts
        ├── ChatSource.tsx
        ├── api.ts
        ├── state.ts
        ├── stream.ts
        ├── components/
        └── chat.css
```

Prefer smaller feature-owned files over reproducing this tree mechanically. Pure status transitions, request assembly, provider normalization, and stream merging should remain independently testable.

## Phase 0: characterize existing contracts

### Goal

Protect current source navigation, notifications, WebSocket consumers, state persistence, and database startup before changing shared seams.

### Inspect

- `apps/desktop/src/core/client/registries/sources.ts`
- `apps/desktop/src/core/client/tabs/sources.ts`
- `apps/desktop/src/core/client/tabs/TabRail.tsx`
- `apps/desktop/src/core/client/App.tsx`
- `apps/desktop/src/core/client/notifications/notifications.ts`
- `apps/desktop/src/core/client/notifications/NotificationBell.tsx`
- `apps/desktop/src/core/shared/ws.ts`
- `apps/desktop/src/core/client/wsClient.ts`
- `apps/desktop/src/core/main/wsHub.ts`
- `apps/desktop/src/core/server/db/schema.ts`
- `apps/desktop/src/core/server/db/cascade.ts`
- `apps/desktop/src/plugins/github/client/shiki.ts`

### Implement

Add characterization tests for:

- existing integration-gated sources and workspace selection;
- current task notification navigation and preference behavior;
- unknown/additive WebSocket frames not breaking current consumers;
- persistence slice migration/default behavior;
- current Shiki token output used by GitHub.

### Stop condition

The existing behavior is covered sufficiently that shared-contract changes can prove they did not regress it.

## Phase 1: core extensibility pressure changes

### Goal

Make Chat possible without giving core chat-specific knowledge beyond general source, notification, Markdown, and transport contracts.

### Implement

1. Add `SourceViewContext` and optional `when` to the source registry. Preserve integration capability gating as one caller-side policy, not the source type itself.
2. Pass selected workspace identity/path into source components from the app composition layer.
3. Generalize notification ownership from required `taskId` to a discriminated target:

   ```ts
   type NotificationTarget =
     | { type: "task"; taskId: string }
     | { type: "chat-thread"; workspaceId: string; threadId: string };
   ```

4. Route notification clicks through registered target handlers or an exhaustive core dispatcher. Preserve all task behavior and persisted-notification migration.
5. Extract GitHub’s Shiki theme/token support and the existing copy affordance into reusable core UI. GitHub imports the new core module; Chat does not import GitHub.
6. Extend shared WebSocket types and hub fan-out with additive chat event frames. Existing clients ignore frames they do not consume.

### Tests

- source visible/hidden by `when` and existing integration policy;
- source component receives the selected workspace and changes correctly;
- old task notice records migrate and navigate unchanged;
- chat target selects workspace/source/thread;
- Shiki characterization tests pass at their new owner;
- all existing WS hub/client tests pass.

### Stop condition

An always-available dummy workspace source can render, a typed chat-target notice can navigate, and no Chat domain package is required by core.

## Phase 2: schema, repository, and owned attachment store

### Goal

Establish canonical local authority before any live provider call.

### Implement

1. Add the six tables and indexes from [domain-model.md](domain-model.md), using the next free migration number and updating Drizzle metadata.
2. Extend application-level cascade deletion for workspaces, threads, messages, runs, connections, and attachment references. Match the repository’s current no-foreign-key policy unless that policy has changed globally.
3. Implement `ChatRepository` methods with explicit transactions for:
   - connection summaries;
   - thread CRUD/search/archive;
   - cursor-paged messages/parts;
   - idempotent turn creation;
   - run transitions and checkpoints;
   - attachment metadata/reference lifecycle.
4. Implement the dedicated content-addressed `ChatAttachmentStore`, temporary-file cleanup, compensation, and reconciliation.
5. Add workspace quota accounting and bounded type detection from [attachments-and-rendering.md](attachments-and-rendering.md).

### Tests

- schema/migration snapshot and `db:check`;
- every state transition and invalid transition;
- idempotency replay returns the original turn;
- cursor ordering is stable under same-millisecond writes;
- cross-workspace attachment reference rejection;
- filesystem/database failure injection and reconciliation;
- cascade deletion and shared-hash reference behavior;
- size/type/filename/traversal/symlink cases.

### Stop condition

The complete local conversation lifecycle works through repository tests with a fake byte stream and no provider SDK.

## Phase 3: provider and context boundaries

### Goal

Prove a provider-neutral request/stream model and leave a deliberate seam for future context.

### Dependencies

Add official `openai` and `@anthropic-ai/sdk` packages after checking their current supported Node versions against the repository runtime. Add runtime schemas only where untyped boundary data requires them; do not duplicate SDK types wholesale.

### Implement

1. Add the `ChatProviderAdapter`, model capability, canonical request, and normalized event contracts in [provider-and-context.md](provider-and-context.md).
2. Build a deterministic fake adapter supporting deltas, delays, cancellation, transient/auth/rate errors, and malformed/out-of-order test events.
3. Implement `ChatRequestAssembler` with `contextItems: []` in version one. It owns history budgeting, attachment authorization/materialization, and the input manifest.
4. Reuse the shipped app-wide core integration connections and model-provider registry; store only
   workspace/thread connection and model preferences in chat.
5. Extend the shipped OpenAI Responses and Anthropic Messages adapters with chat streaming and
   attachment behavior. Pin intentional SDK behavior: timeouts, retries, cancellation signal, user
   agent, and stream error mapping.
6. Implement a server-owned model catalog with capability flags and short-lived model discovery cache. Unknown historical model IDs remain displayable.

### Tests

- one provider conformance suite runs unchanged against fake/OpenAI/Anthropic adapters using mocked SDK transports;
- event normalization handles additive unknown provider events;
- cancellation closes iteration and stops deltas;
- authentication/rate/timeout/content errors map to canonical safe codes;
- history budgeting keeps newest complete turns, never half a turn;
- request manifest records included/omitted messages and empty context;
- no credential getter returns plaintext to route/client types.

### Stop condition

Both real adapters satisfy the same contract under mocked transport, while the fake adapter can drive all later integration tests without network or secrets.

## Phase 4: routes, run orchestration, and streaming

### Goal

Run a durable conversation independently of the renderer lifecycle.

### Implement

1. Register one authenticated `/api/chat` plugin router with the endpoints in [api-and-streaming.md](api-and-streaming.md).
2. Keep routes thin: validate, authorize, call service, map typed result/error.
3. Implement `ChatRunService`:
   - enforce concurrency before acceptance;
   - transactionally create user message, assistant placeholder, and run;
   - start async provider consumption owned by the server;
   - checkpoint aggregate text at roughly 250 ms or 2 KiB, whichever comes first;
   - publish coalesced typed frames;
   - commit final content/state before terminal broadcast;
   - handle idempotent cancellation and startup interruption recovery.
4. Add chat subscriptions to the existing authenticated WebSocket. Do not create a second socket.
5. Implement structured safe logging and correlation IDs.

### Tests

- route authentication, CSRF, validation, authorization, pagination, and error shapes;
- accepted turn continues after simulated renderer unsubscribe;
- final WS event occurs after durable commit;
- sequence gap/reconnect fetch reconstructs exact content without duplication;
- cancellation at queued/streaming/terminal phases;
- active-run uniqueness under concurrent requests;
- crash startup marks non-terminal runs interrupted;
- logs contain no keys, message text, or attachment names.

### Stop condition

An API-level fake-provider test can upload, create a thread/turn, observe streaming, disconnect/reconnect, cancel, and read final durable state.

## Phase 5: client data layer and basic chat source

### Goal

Deliver the complete text-chat loop with local history before rich attachments/rendering.

### Implement

1. Register the Chat source and plugin client/server entrypoints.
2. Add typed API functions and query keys from [api-and-streaming.md](api-and-streaming.md).
3. Implement stream merging by run sequence, durable checkpoint reconciliation, and invalidation on terminal events.
4. Add the thread sidebar, create/rename/archive/delete/search, header/model selector, timeline, composer, send/stop, error/empty/setup states.
5. Add per-workspace/thread draft state to the versioned client slice registry.
6. Implement scroll anchoring, older-message pagination, and animation-frame stream batching.

### Tests

- client stream reducer: duplicates, gaps, checkpoint overlap, terminal frames;
- composer keyboard and IME behavior;
- draft preservation on rejected send and workspace/thread switching;
- model disappearance/capability state;
- scroll follow vs user-scrolled state;
- thread actions and empty-thread cleanup;
- accessible names/focus order for primary controls.

### Stop condition

Using the fake provider, a user can manage threads, select a model, stream/cancel/retry text turns, reload during a run, and recover exact state.

## Phase 6: safe Markdown, code, and attachments

### Goal

Add rich display and portable multimodal input without weakening trust boundaries.

### Dependencies

Use `unified`, `remark-parse`, and `remark-gfm` for syntax only. Do not install raw-HTML rendering. Add a streaming multipart parser only after a compatibility test proves hard limit enforcement without whole-body buffering.

### Implement

1. Build the controlled Markdown-to-Solid renderer from [attachments-and-rendering.md](attachments-and-rendering.md).
2. Add safe URL policy, remote-image blocking, bounded tables/nesting, inline/fenced code, Shiki fallback, and copy actions.
3. Add file picker, drag/drop, paste, upload queue/progress/retry/removal, and capability gating.
4. Render local images and file cards through authorized attachment routes with safe headers.
5. Materialize portable attachment inputs in both provider adapters without provider-persistent file authority.
6. Add orphan/temp cleanup and quota UI.

### Tests

- Markdown XSS/link scheme/raw HTML/remote image corpus;
- malformed and unfinished streaming Markdown;
- code copy fidelity and highlighter failure;
- picker/drop/paste/upload/retry/remove flows;
- attachment capability gating per model;
- spoofed MIME, oversize mid-stream, invalid UTF-8, extreme image metadata;
- cross-workspace download and message-reference denial;
- adapter payload mapping for every portable type.

### Stop condition

All supported attachment types can be selected, validated, stored, replayed, safely displayed, and mapped through both adapters; hostile fixtures cannot create active DOM or unauthorized reads.

## Phase 7: notifications, recovery, and operational hardening

### Goal

Complete background behavior and make failure states diagnosable and private.

### Implement

1. Track exact chat attention: document focus plus selected workspace/source/thread.
2. On unattended completion, persist a typed chat notification, show allowed toast/OS notice, and set rail/thread unread state.
3. Mark notices read only when their exact thread is attended.
4. Add provider setup/update/remove/test UI, privacy copy, key suffix/status, and model-refresh recovery.
5. Add startup recovery, attachment reconciler diagnostics, safe log events, and operational counters from [security-and-operations.md](security-and-operations.md).
6. Put the source and turn creation behind a reversible local feature flag for staged rollout.

### Tests

- focused exact thread: no completion notice;
- focused other thread/source/workspace: notice;
- blurred app: notice;
- cancelled run: no default notice; failed run: error notice policy;
- notification click selects exact target and marks it read;
- privacy mode suppresses thread title/preview;
- restart recovery and object reconciliation;
- disabling the flag preserves and does not corrupt history.

### Stop condition

Background completion, navigation, privacy, restart, and failure-mode behavior match the specifications and are covered by deterministic tests.

## Phase 8: end-to-end and release verification

### Automated gates

Run from the repository root, adapting only if package scripts have changed:

```bash
pnpm lint
pnpm test
pnpm build
pnpm --filter @acorn/desktop db:check
pnpm --filter @acorn/desktop test:e2e
```

Add an offline deterministic E2E provider mode. Live provider smoke tests are opt-in, secret-gated, low-cost, and never part of the default test suite.

### Manual packaged-app matrix

Verify at minimum:

- macOS packaged build, app focused/blurred, another workspace/source/thread selected;
- provider setup success and invalid/revoked keys;
- long streaming response while scrolling and switching surfaces;
- reload/restart mid-stream;
- cancel before first token and after partial content;
- each attachment source: picker, drop, paste;
- keyboard-only and screen-reader pass;
- narrow and wide windows, reduced motion, light/dark themes;
- offline, stalled network, rate limit, provider outage;
- delete/archive/connection removal and retained-history behavior;
- storage quota and low-disk failure.

### Release artifacts

- user-facing provider/privacy/attachment documentation;
- schema migration and rollback/forward-compatibility note;
- feature-flag enable/disable procedure;
- known provider/model capability limitations;
- support guide keyed by canonical error code and correlation ID;
- dependency/license review for both SDKs and Markdown/upload packages.

## Out of scope for version one

- automatic repository/task/file context;
- tools, function calling, shell execution, browsing, or agents;
- provider-hosted conversation authority;
- persistent provider file uploads;
- response editing or destructive regeneration;
- conversation branching UI;
- automatic model-generated titles or summaries;
- remote Markdown images/link previews;
- audio/video attachment support;
- cross-workspace/shared chat history.

The schema and boundaries accommodate these where appropriate, but no placeholder should secretly perform them.

## Definition of done

The feature is complete only when:

- Chat is a workspace-native left-rail source and survives navigation/restart;
- local SQLite/object storage is the canonical, workspace-isolated history;
- OpenAI and Anthropic operate through one conformance-tested adapter boundary;
- text and portable attachments stream, cancel, retry, recover, copy, and render safely;
- model selection is capability-aware and historically traceable;
- the renderer never receives provider keys or raw provider HTML;
- completion notices use exact surface attention and typed navigation;
- failures are durable, user-actionable, and privacy-safe to diagnose;
- all automated gates and packaged-app matrix checks pass;
- future providers and explicit context sources can be added without rewriting persistence, UI messages, or run orchestration.
