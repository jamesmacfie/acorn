# Phase 1: Guardrails and the citation check

Date: October 3, 2026. Status: proposed, not started. Part of the
[documentation overhaul](./README.md).

Do this phase before any other. Phases 2 to 6 move sections around, and today nothing tells a
developer when a move breaks a source comment.

## The gap

`tools/arch/docPaths.test.ts` checks three things:

- Every repo-rooted path in backticks in a doc exists.
- Every relative link between docs resolves, including its `#fragment`.
- No doc names a retired directory.

It reads `docs/`, `README.md`, and `AGENTS.md`. It doesn't read source comments. Source cites the
docs about 3,000 times, and about 2,500 of those name a section with
`docs/<page>.md § Heading`. A rough check on October 3, 2026, matched about 390 of 540 distinct
section citations to a heading. Some of the rest are false alarms where the heading wraps onto the
next comment line. Others point at sections that were renamed or moved.

## Work

### Fix citations of docs that don't exist

These paths appear in source comments and point at no file. The count is the number of citations:

| Cited path, deleted or renamed | Count | Likely owner today |
| --- | --- | --- |
| `docs/terminal-and-agents.md` (deleted) | 33 | `docs/terminal.md` or `docs/managed-agents.md` |
| `docs/state.md` (deleted) | 15 | `docs/state-ownership.md` |
| `docs/third-party/README.md` (deleted) | 4 | `docs/plugin-authoring.md` |
| `docs/future/phased-review-steps/cloud-guardrails.md` (deleted) | 4 | Deleted programme, check Git history |
| `docs/protocol/v1/overview.md` (deleted) | 2 | `docs/api-reference.md` |
| `docs/future/node-first/platform-seam.md` (deleted) | 2 | `docs/frontend.md` |
| `docs/future/phased-review-steps/README.md` (deleted) | 1 | Deleted programme |
| `docs/future/phased-review-steps/phase-4-node-autonomy.md` (deleted) | 1 | Deleted programme |
| `docs/future/cron/targets.md` (deleted) | 1 | `docs/schedules.md` |
| `docs/future/icons.md` (deleted) | 1 | `docs/ui-design.md` |
| `docs/pg.md` (deleted) | 1 | `docs/database.md` |
| `docs/platform-support.md` (deleted) | 1 | `docs/shell.md` |
| `docs/plugin-setup.md` (deleted) | 1 | `docs/plugin-authoring.md` |
| `docs/vNext/data.md` (deleted) | 1 | `docs/data-layer.md` |

The "likely owner" column is a guess from the citing files. Read the cited claim and find the
section that owns it today before you change the comment. If nothing owns it and the comment still
explains the code, keep the explanation and drop the doc path.

To list the citing files, run:

```sh
git grep -n -F 'docs/terminal-and-agents.md' -- ':!docs' ':!references'
```

### Check source citations in the architecture suite

Add a test beside `docPaths.test.ts` that reads source files under `apps/`, `packages/`, `plugins/`,
`tools/`, and `scripts/`, and checks two things:

1. Every `docs/<path>.md` named in a comment exists.
2. Every `docs/<path>.md § Heading` names a heading or an explicit anchor in that file.

Match the heading as a prefix after you join wrapped comment lines. Reuse the `anchors()` helper in
`docPaths.test.ts` for heading slugs. Add an anti-vacuity floor, as the existing tests do, so a
broken pattern can't report a clean pass.

Land the test with an allowlist of the citations that fail today, then shrink the allowlist to zero
in this phase or the phase that owns the doc. The allowlist must only shrink.

### Leave a length report, not a length gate

Print the in-scope docs longer than 200 lines from the same suite as information, without failing.
Make it a hard limit once phase 6 lands.

## Done means

- No source comment names a missing doc file.
- The new test runs in `pnpm --filter @acorn/arch-tests test` and passes with its allowlist.
- The [overhaul README](./README.md) has fresh citation numbers from the new test.

## Verify before you start

- Confirm `tools/arch/docPaths.test.ts` still has the `anchors()` helper and the `GONE` markers.
- Re-run the missing-path list. Some citations might have been fixed since October 3, 2026.
