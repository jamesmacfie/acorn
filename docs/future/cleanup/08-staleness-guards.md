# 08: Staleness guards

> **Completion note, October 12, 2026.** No client source file declares a counter whose only job is to
> drop a stale result. `latestSignal()` sits beside `latestOnly` in
> `packages/client-core/src/kit/lib/state/`, with its own test, and `@acorn/plugin-api/client` exports
> both. `pnpm lint`, the arch tests, the `@acorn/tui` build and its startup graph check, and the
> suites for `@acorn/client-core`, `@acorn/plugin-api`, `@acorn/tui`, `@acorn/desktop` (TypeScript and
> Rust), and the agents, database, docker, editor, git, http, linear, notes, preview, rollbar,
> terminal, and workflows plugins pass on Node 26.8.1.
>
> What landed:
>
> - `latestSignal()` returns `{ signal, next(), abort() }`. `next()` aborts the previous
>   `AbortSignal` and hands back a fresh one, and `abort()` cancels without starting another, for a
>   reset or an unmount. A flow checks `signal.aborted` after each await, and the same signal can go
>   to `fetch`. Phase 07's local helper in `editorController.ts` is gone, and its five call sites use
>   the shared one unchanged.
> - `latestOnly` is built on `latestSignal`, so it holds no counter either.
> - About 60 guards converted across client-core, the desktop shell, the terminal client, and 13
>   plugins. Where a guard paired a counter with an `AbortController`, one signal replaces both. Where
>   the counter was a store's lifetime, bumped on a clear and only read by others (the agents session
>   store, the Docker client scope, the diff segment loader, the telemetry emitter, the workflows run
>   reader), readers capture `.signal` and the clear calls `next()`.
> - `PooledFile.markersGeneration` is `markersRead: LatestSignal`. `WorkflowDraftAddress.generation`
>   is `signal`. The composer's `captureRevision()` and `captureCurrent(revision)` are
>   `startCapture()` and `captureCurrent(started)`. The Git launch request's `generation` only marked
>   a request opened through the shared signal, so it's `tracked?: true`.
> - Per-key guards (the diff pane's per-file gap reads and the editor tree's per-directory ignore
>   reads) hold one signal or controller per key.
> - `@acorn/client-core/kit/lib/latestSignal` is a narrow export, so the terminal's `main.tsx` and the
>   desktop's `webviewTransport.ts` don't load the `kit/lib` barrel. The terminal startup closure
>   grows by 170 bytes, to 695,695 of its 700,000-byte ceiling. It was 695,525 before this change.
> - `docs/conventions.md` § Solid and state names both helpers and the rule for counters that stay.
>   `docs/shell/webviews.md` describes eviction as aborting the key's owner signal.
> - Eleven tests mocked `@acorn/plugin-api/client` with a fixed object. Each mock takes the real
>   `latestSignal` from the original module.
>
> Decisions and deviations:
>
> - **`latestOnly` only where the shape fits.** It wraps one load and one commit, with no error path.
>   Most single reads also set an error or clear a busy flag in `catch` and `finally`, and wrapping
>   those in `latestOnly` meant folding the error into the result. Those use `latestSignal`, which
>   reads more plainly. No call site met `latestOnly`'s exact shape apart from `taskStatus.ts`, which
>   already used it.
> - **Tree code uses a plain `AbortController`.** The database, http, linear, and rollbar `tree/`
>   folders run in the sandbox and can only import the published SDK surface (`ui/sdk`, `ui/tree`).
>   Adding `latestSignal` there grows the loaded-plugin contract, so each lifetime is an
>   `AbortController` that's aborted and replaced. The database panel has a three-line local
>   `nextSelection()` for its seven call sites.
> - **Counters that carry data stay.** `nativePages.ts` sends its counter to the native layer as the
>   update's `generation`, so it's renamed `presentationGeneration`. `distribution.ts` stamps each
>   node observation with `requestedGeneration`, and nothing compares it. Revisions sent to the Node
>   (`FileDiagnostics`, the composer's text and context revisions, `documentCustody`, note recovery),
>   the run pane's step ordering, `sessionSources` versions, and the terminal key registry's cache key
>   stay too.
> - **Server code is out.** `preferenceGeneration` in `node-core/src/server/telemetry/collector.ts`
>   and `#generation` in `plugins/agents/src/server/mcpReviewProxy.ts` are staleness guards, but
>   server code can't import a client-core helper, and the MCP proxy gates tool approval. A Node-side
>   helper is a separate change.
> - **One approval joins a lifetime instead of starting one.** The instruction review panel's approval
>   used to take a new controller without aborting the review read before it. It takes the current
>   signal, which keeps that behavior.
>
> For later phases: a new async guard in client code uses `latestOnly` or `latestSignal`, never a
> counter. Proposal 12 can look at `distribution.ts`, where `requestedGeneration` is bumped on forget
> and reset but never compared, and at whether `NodePluginObservation.generation` has a reader. The
> terminal startup closure has 4,305 bytes of headroom.

This proposal replaces hand-rolled generation counters with the shared helper the repository
already has, plus one more helper for multi-step flows.

Date: October 11, 2026. Status: proposed. Depends on:
[07: EditorPane controller](./07-editor-pane-controller.md). Part of the
[cleanup programme](./README.md).

## Problem

Client code often starts an async read and must drop its result if a newer read has started. 54
source files guard this by hand, with a counter such as `let generation = 0` that each call
increments and each result compares. The counts by package are 19 in client-core, 10 in git, six in
agents, five each in workflows and editor, and the rest in ones and twos.

Client-core already has the helper for the simple case. `latestOnly` in
`packages/client-core/src/kit/lib/state/latestOnly.ts` takes a load and a commit, and commits only
the newest result. `@acorn/plugin-api` exports it to plugins. One file uses it:
`packages/client-core/src/features/tasks/taskStatus.ts`.

Hand-rolled counters repeat the same three lines with small variations, and a missed comparison is a
silent stale write. `plugins/editor/src/client/EditorPane.tsx` alone holds seven.

## Goal

A reader who sees a staleness guard recognizes it by name. Each guard has a test in one place.

## Requirements

1. Convert every single-read guard, where one load is followed by one commit, to `latestOnly`.
2. For multi-step flows that check staleness between several awaits, add one helper beside
   `latestOnly`. It should return a token or an `AbortSignal` that reports whether the flow is still
   the newest, and it needs its own test.
3. Leave a counter in place only where it carries real data, such as a revision sent to the Node, and
   name it for what it holds.
4. Export the multi-step helper through `@acorn/plugin-api` if plugins use it.

## Out of scope

Server-side sequence numbers, such as event sequences and revisions, aren't staleness guards.

## Acceptance

- No source file declares a `generation` or `epoch` counter used only to drop stale results.
- Each touched package's suite passes.
