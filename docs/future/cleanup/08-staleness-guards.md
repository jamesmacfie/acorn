# 08: Staleness guards

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
