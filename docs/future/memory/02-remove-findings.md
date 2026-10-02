# Phase 2: remove Findings and the search index

Status: proposed, 2026-10-01. Start only after [phase 1](./01-direct-writes.md)'s two-week measurement
says direct writes are acceptable. This phase is mostly deletion, and it is the one-way door in the
programme.

## Goal

One memory system. The Findings plugin, everything that exists only to feed it, the memory review
experience, and the memory search index are gone. Memory reads and searches its files directly.

## What the owner gets at the end

- No **Review after archive** settings page, no archive-time model call, and no review notices.
- No **Review learnings**, **Review memory suggestions**, or **Findings: inspect task evidence**
  commands.
- No `findings_*` tools in an agent's tool list, which shortens every session's tool list by four.
- A Memory page that shows memories, without a review section above them.
- Faster archive, because Terminal no longer captures PTY tails and a diff before teardown.

## Starting point

Findings is an app-bundled loaded plugin in `plugins/findings`, with its own database at
`plugins/findings.sqlite` in the data root. Its only product consumer is memory review. The couplings
are listed below by owner.

## Requirements

1. The Findings package, its tests, its fixture, and its bundling entries are deleted.
2. No other package imports, names, or resolves a Findings capability or extension point.
3. The review-input capabilities in agents, terminal, and workflows are deleted. The public
   `plugin:terminal:completed` and `plugin:workflows:completed` events stay, because other consumers
   may subscribe to them. Check for any before deciding otherwise.
4. Core no longer awaits a review capture before archive teardown.
5. The memory plugin no longer has a SQLite database. Listing, reading, and searching scan the private
   folder and the task's project folder.
6. The memory plugin no longer reads `.acorn/memory` folders in worktrees or checkouts.
7. Recall counters are gone.
8. The existing `plugins/findings.sqlite` and `plugins/memory.sqlite` files are left on disk, unread.
   The release notes say they can be deleted by hand. Nothing deletes owner data automatically.
9. `pnpm lint` and `pnpm test` pass, and the route registry snapshot is updated.

## What to delete or change, by owner

### Findings

- `plugins/findings`, the whole package: delete.
- `apps/node/test/integration/plugins/findings.test.ts`: delete.
- `apps/node/test/__fixtures__/findings-producer`: delete.
- The `findings` entry in `apps/desktop/scripts/build-bundled-plugins.mjs`: delete.
- The `@acorn/plugin-findings` dependency in `apps/node/package.json` and `plugins/memory/package.json`: delete.

### Memory

- `plugins/memory/src/server/findingsReview.ts` and its test: delete.
- `plugins/memory/src/contract/findingsReview.ts`: delete.
- `plugins/memory/src/client/FindingsBundleReview.tsx` and its test: delete.
- `plugins/memory/src/client/proposalTarget.ts`: delete. It handles the `findings-bundle` and
  `findings-candidate` notice targets.
- The ready-bundle notice registration in `plugins/memory/src/client/index.ts`: delete.
- **Review learnings** and **Review memory suggestions** in `plugins/memory/src/client/commands.ts`: delete.
- The approval route and `memoryApproveFinding` in `plugins/memory/src/server/routes/knowledge.ts`:
  delete.
- The review section of `plugins/memory/src/client/MemoryCenter.tsx`, and of the Context pane's
  memory contribution in the retired Context pane memory component: delete.
- The index table, full-text table, reconciliation, and recall counters in
  `plugins/memory/src/server/memory.ts` and `plugins/memory/src/node/schema.ts`: replaced by a file
  scan. The plugin's migration folder goes with the schema.
- `plugins/memory/src/server/ftsSchema.test.ts`: delete.
- `memorySources`, which adds worktree and checkout folders: replaced by the two scope folders.

### Agents

- `plugins/agents/src/server/sessions/reviewInput.ts`: delete.
- `AGENTS_REVIEW_INPUT` in `plugins/agents/src/contract/lifecycle.ts`, and the `reviewInput` methods
  in `plugins/agents/src/server/sessions/lifecycle.ts` and
  `plugins/agents/src/server/sessions/sessionRepository.ts`: delete.

### Terminal

- `plugins/terminal/src/contract/reviewInput.ts` and `plugins/terminal/src/server/reviewSnapshots.ts`: delete.
- The `archive-review` hook, the PTY tail and diff capture, and the capability registration in
  `plugins/terminal/src/node/index.ts`: delete.

### Workflows

- `plugins/workflows/src/contract/reviewInput.ts`: delete.
- `plugins/workflows/src/server/runs/read/reviewInput.ts`: delete, with its registration in
  `plugins/workflows/src/node/index.ts`.

### Core and clients

- `captureArchiveReviewInput` in `packages/node-core/src/server/routes/projects/worktree.ts`: delete.
- The `terminal.reviewInput.v1` and `workflows.reviewInput.v1` entries in
  `packages/plugin-types/src/contracts/capabilities.ts`: delete.
- The `findings-review` notice kind in
  `packages/client-core/src/features/notifications/kindContributions.ts`: delete.
- The Findings and bundle review entries in `apps/desktop/scripts/check-renderer-budget.mjs`: delete.
- `apps/node/test/integration/routeRegistry.snapshot.json`: regenerate.

Several client-core and node-core tests use `findings` as a sample plugin name, for example in the
trust, frame broker, manifest, and notice tests. Change only the ones that load the real package.
A sample name in a fixture is not a coupling.

## Out of scope

- The Memory page's library, change feed, history, and import. That is [phase 3](./03-memory-page-and-import.md).
- The `finding` note kind in `plugins/notes/src/server/notes.ts`. It is a kind of note, not a Findings
  record, and it stays.

## Steps and checkpoints

### 1. Replace the index with a scan

Change memory's list, get, and search to read files. Keep the tool contracts from phase 1 byte for
byte, so no agent notices.

**Checkpoint 1.** The phase 1 checkpoints 2 to 6 still pass. `memory_search` for a word that appears
only in a body finds that memory.

### 2. Cut memory loose from Findings

Delete the memory-side review code and the package dependency.

**Checkpoint 2.** With the Findings plugin disabled, the Memory page, the tools, the card, and
standing context all work. `pnpm --filter @acorn/plugin-memory test` passes.

### 3. Delete the producers

Delete the review-input capabilities and the archive capture in agents, terminal, workflows, and core.

**Checkpoint 3.** Archive a task with a running terminal and an agent session. Archive finishes, and the
Node log has no review capture lines. Restore the task.

### 4. Delete Findings

Delete the package, its bundling, its tests, and its fixture. Regenerate the route snapshot.

**Checkpoint 4.** `pnpm lint` and `pnpm test` pass. A packaged desktop build starts, and Settings >
Plugins has no Findings row. An agent session's tool list has no `findings_*` tools.

### 5. Update the documents

**Checkpoint 5.** `pnpm --filter @acorn/arch-tests test` passes the documentation path checks in
`tools/arch/docPaths.test.ts`, apart from the reds that fail in every worktree.

## Docs that change

- [Findings](../../findings.md): delete, and add a retired-folder note to [the docs index](../../README.md).
- [Notes and memory](../../notes-and-memory.md): remove every Findings reference, the review page, the
  approval route, the index, and reconciliation.
- [Agent tools](../../agent-tools.md) and [API reference](../../api-reference.md): remove the four
  `findings_*` tools and the Findings and approval routes.
- [Loaded-plugin migration](../../loaded-plugin-migration.md), [plugin map](../../plugin-map.md), and
  [first-party plugins](../../first-party-plugins.md): remove Findings.
- [Node-side extension points](../../plugins/node-side-extension-points.md) and
  [the node half](../../plugin-authoring/the-node-half.md): replace Findings as the worked example of a
  producer extension point.
- [Workflows](../../workflows.md), [schedules](../../schedules.md), [terminal](../../terminal.md),
  [notifications](../../notifications.md), [managed agents](../../managed-agents.md),
  [command palette and shortcuts](../../command-palette-and-shortcuts.md), [panes](../../panes.md),
  [frontend](../../frontend.md), [features](../../features.md), and [testing](../../testing.md):
  remove the review producers, notices, commands, and manual checks.

## Verify before building

- That no plugin other than Findings subscribes to `plugin:terminal:completed` or
  `plugin:workflows:completed`. If none does, decide whether the events stay as public events.
- That nothing outside Findings contributes to `findings:producer` or `findings:kind`.
- Which pending review candidates exist on the owner's machine, in case any are worth copying into
  memory by hand before the plugin goes.
