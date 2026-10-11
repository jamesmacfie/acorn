# 15: Comment cleanup

This proposal fixes or removes source comments that are wrong, and trims the ones that tell history
instead of reasons. It also adds a rule and a check, so the problem doesn't come back.

Date: October 11, 2026. Status: proposed. Depends on: [13: formatter](./13-formatter.md), so the
cleanup diff isn't mixed with layout changes. Part of the [cleanup programme](./README.md).

## Problem

Source files outside tests hold about 50,000 comment lines in 17,000 blocks. Client-core holds
14,900 of those lines, node-core 6,900, the terminal client 6,600, agents 5,000, and protocol 2,900.

Most long comments are worth keeping. In a random sample of eight blocks of eight lines or more, six
explained a constraint the code can't show, such as why a select keeps the native element or why a
budget counts the smallest files first. The problem is a habit layered on top, spread thinly
across the codebase. No file has more than eight flagged blocks, so this is a pass over every
package, not a fix to a few files.

These comments are wrong, and a script finds them:

- 178 comments cite a source path that no longer exists. For example, three in
  `apps/node/src/entries/standalone.ts` cite `service/runtime.ts`, and `apps/node/src/composition/runtime.ts`
  cites `server/standalone.ts`.
- 27 comment blocks name a function or type that exists nowhere in the code. `paletteRows` appears
  in eight files, alongside `createPanelData`, `normalizePanel`, `pushRight`, `pushDown`,
  `trapOverlayFocus`, and `scanLinearRefs`.

These are wrong in ways only reading finds:

- The header of `packages/node-core/src/server/pluginHost/state.ts` says nothing short of a restart
  can change which plugins run, but the same interface has `reload()`. It also quotes a sentence
  from `docs/plugins.md` that the page no longer contains.
- `packages/dashboards-core/src/plan.ts` and `packages/node-core/src/server/dashboards/run.ts` say a
  problem's `message` is kept for older clients. `PublishedDashboardPanel.tsx` still draws it for
  every problem that isn't a source failure.
- Comments call current behavior "legacy": the omitted `after` in a workflow step, which
  `docs/workflows.md` documents as the format, in `plugins/workflows/src/client/editor/draft.ts` and
  `plugins/workflows/src/server/definitions/builtinDefinitions.ts`. The same goes for the normal
  task creation path in `packages/node-core/src/server/worktrees/taskBranch.ts`.
- `apps/desktop/src/client/App.tsx` describes a "top bar + three panes" layout with PullList and
  PullDetail.

These go stale, and a pattern scan finds them:

| Pattern | Blocks | Lines |
| --- | --- | --- |
| History: "used to", "moved from", "previously", "no longer" | 473 | 2,931 |
| Phase or programme names | 65 | 588 |
| Quoted measurements | 86 | 630 |
| Dates | 40 | 421 |
| Blocks of eight lines or more | 1,258 | 14,365 |

Another 2,339 blocks cite a doc. `tools/arch/docCitations.test.ts` keeps those accurate, so they
aren't wrong, but each one ties the code to a doc heading.

`AGENTS.md` says nothing about comments. The history and phase comments read like an agent
explaining its own change in the code, so they keep arriving.

## The bar

Keep a comment that explains why, or names a constraint, trap, or invariant the code can't show.

Cut a comment that:

- restates the code
- tells history: what the code used to do, where it moved from, or what it replaced
- names a phase, a programme, a review finding, or a date
- quotes a measurement nobody can rerun from the comment
- points at a file path where a symbol name would do

Fix or delete anything wrong. Shorten a long block to its reason. Keep a doc citation only where the
doc owns the contract the code implements.

## Requirements

1. Add a short "Comments" section to `AGENTS.md` with the bar above. Keep it to five lines or so,
   and link `docs/writing-docs.md` for citing docs.
2. Extend `tools/arch/docCitations.test.ts`, or add a sibling test, to check that a repository path
   in a source comment exists. Use the same "deleted" and "moved to" markers the doc path check
   accepts. Don't add a check for missing identifiers, because library names make it noisy.
3. Fix the 178 stale paths and the 27 blocks naming missing identifiers. Prefer naming the symbol
   to naming its file.
4. Work through the packages largest first, one commit per package: client-core, node-core, the
   terminal client, agents, protocol, then the rest. Apply the bar to every comment block.
5. Change comments only. If a comment turns out to describe a bug, record the bug separately and
   keep the comment accurate.
6. Leave files that another branch has open until that branch lands, to avoid conflicts.

## Out of scope

Doc pages are [16: docs cleanup](./16-docs-cleanup.md). Comments on files that other proposals
delete or rewrite go with those proposals.

## Acceptance

- The comment path check passes with no allowlist.
- A rerun of the pattern scan shows no history, phase, or date comments, except dated measurements
  that name a way to rerun them.
- `pnpm lint` and `pnpm --filter @acorn/arch-tests test` pass after each package's commit.
