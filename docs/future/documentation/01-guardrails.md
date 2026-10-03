> **Completed 2026-10-03** by the "Phase 1 Guardrails" task.
>
> **What landed:** `tools/arch/docCitations.test.ts` reads every tracked source file under `apps/`,
> `packages/`, `plugins/`, `tools/`, and `scripts/`. It fails on any `docs/<page>.md` that doesn't
> exist, and on any `§ Heading` that doesn't start with a heading or anchor in the cited doc. It also
> prints the in-scope docs longer than 200 lines. All 64 comments that named a deleted doc now point
> at the section that owns the claim, or keep the explanation without the path.
>
> **Deviations:** The `anchors()` helper and `ROOT` moved out of `docPaths.test.ts` into
> `tools/arch/docAnchors.ts`, because importing one test file from another runs its tests twice. The
> source check ignores the `GONE` markers that `docPaths.test.ts` honors, so a comment that says "git
> history" next to a deleted doc path still fails. That follows "No source comment names a missing doc
> file". Citations of the deleted `docs/terminal-and-agents.md` split three ways, not two: terminal claims went
> to `docs/terminal.md`, worktree, branch, and archive claims went to `docs/workspaces-and-tasks.md`,
> and the read-on-view claim went to `docs/notifications.md`. I also documented the check in
> `docs/testing.md` and `docs/README.md`.
>
> **For later phases:** The allowlist is `tools/arch/docCitations.allowlist.txt`, one
> `<file>: docs/<page>.md § <cited text>` line per broken citation, 420 lines covering 206 distinct
> sections. The cited text is cut at the first `)`, `,`, `;`, or sentence-ending period and capped at
> 60 characters. When you fix a citation, delete its line: a line that starts passing fails the test.
> To list the citations for a doc you own, run `grep 'docs/tui.md' tools/arch/docCitations.allowlist.txt`.
> The heading has to be a prefix of the cited text, so an abbreviation such as `§ Starting a run` for
> "Starting a run from an item" fails. Write the full heading. The check reads tracked files only, so
> `git add` a new file before you trust a pass. Vitest 4 hides `console.info` output from passing tests
> when it detects an agent, so to see the length report and the counts, run
> `env -u CLAUDECODE npx vitest run docCitations` in `tools/arch`. Phase 6 should turn the length
> report into a gate. The whole check runs in under a second.

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
