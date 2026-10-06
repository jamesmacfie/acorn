# Phase 04: explanations and first release

Date: October 7, 2026. Status: planned; implementation not started.
Depends on [phase 03](./03-stashes.md).
Read the [full implementation context](./README.md), especially
[AI explanations](./README.md#ai-explanations),
[replacement](./README.md#replacing-the-external-plugin), and
[verification](./README.md#verification-strategy).

## Deliverable

The first Git client release supports worktrees, recent commit history, stash management, and
explicit commit/stash explanations on desktop and terminal. It can replace the external plugin
without removing any Git data or task records.

## Steps

1. Add explicit explanation routes using Node model services, validated backend/model picks,
   bounded metadata and patch context, and named omissions. Include captured untracked stash
   content where it fits the budget. Keep repository text separate from model instructions.
2. Reuse the shared model/backend picker and generation default. Add generating, cancel,
   unavailable model, provider failure, empty result, retry, and late-response handling. Retain
   results by revision/model without rewriting commit metadata or task transcripts.
3. Exercise all first-release flows in isolated desktop and terminal sessions. Measure initial
   history load, page growth, diff requests, cache bounds, and cleanup on Node/task changes. Fix
   failures in the owning slice before calling the release accepted.
4. Test replacement using the public plugin management flow. Disable or uninstall the verified
   external `worktree-manager` registration without purging data after the built-in replacement
   passes acceptance. Retain its source checkout and unrelated activation/layout preferences.
   Describe **Git > Worktrees** navigation and per-Node replacement in the shipped docs.
5. Update feature references, public contract docs, plugin map, documentation index, relevant
   goldens, and dated host evidence. Record the first-release boundary; leave phases 05–08 planned.

## Acceptance

- Model service tests verify correct backend/model selection, bounded input, omission reporting,
  cancellation, and provider errors without paid calls in ordinary tests.
- Both hosts show explicit generation and model choice, cancellation, retry, and selection/Node
  changes without late output appearing under another revision.
- Replacement passes with no external installation, an installed external plugin, a remote Node,
  and built-in Git disabled. No task, repository, worktree, stash, or plugin data is purged.
- Run affected package/consumer suites, `pnpm lint`, architecture gates, and full `pnpm test`.
  Attach real desktop/terminal evidence for the first release; mocks alone do not complete it.

## Verify before building

- Recheck model cancellation propagation through the transport and backend implementation.
- Verify plugin identity, non-purging removal, running-versus-installed state, and remote-Node
  authorization in the selected release baseline.
