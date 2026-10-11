# 13: Formatter

This proposal adds one code formatter, applies it in a single mechanical commit, and checks it in
`pnpm lint`. It ends the two code densities the repository has grown.

Date: October 11, 2026. Status: proposed. Depends on: [01: green the gate](./01-green-the-gate.md).
Part of the [cleanup programme](./README.md).

## Problem

The repository has no formatter. `AGENTS.md` keeps `oxlint` to dead code and the `node:` prefix on
purpose, so nothing settles layout either. Two styles have grown side by side:

- The core packages are 21% to 31% comment lines, written as narrative, with short code lines.
- Many newer plugin modules are 9% to 15% comment lines, and pack logic into long lines.

Across 431,963 non-blank TypeScript lines in `apps/`, `packages/`, and `plugins/`, 12.4% run past
100 characters, 4.1% past 120, 1.8% past 140, and 0.9% past 160. 361 source files hold at least one
line over 200 characters. The densest modules include:

- `packages/client-core/src/features/dashboards/studio/inspectors.tsx`, with 67 lines over 160.
- `packages/dashboards-core/src/plan.ts`, with 58.
- `plugins/git/src/server/changes/dependencyReview.ts`, with 40.

A reader can't skim a 300-character line, and a review diff of one shows a single changed line where
five things changed.

A formatter isn't the kind of style linter `AGENTS.md` rules out. It doesn't argue. It rewrites,
and the argument ends.

## Goal

Every TypeScript file has one layout, produced by a tool, and `pnpm lint` fails on a file that
doesn't match it.

## Requirements

1. Evaluate `oxfmt`, the formatter from the same project as `oxlint`, and Prettier. Prefer the one
   that matches the codebase's style with the least configuration: no semicolons, single quotes,
   two-space indents, and the trailing-comma use the code already has. Weigh the dependency cost as
   `AGENTS.md` asks.
2. On a branch, measure the churn at print widths 100 and 120, and pick one. 120 rewraps about 4% of
   lines.
3. Exclude generated files, such as `packages/protocol/src/appearance/workspaceIconNames.ts`, the
   Drizzle migration snapshots, and every `dist` folder.
4. Apply the formatter in one commit that contains nothing else. List that commit in
   `.git-blame-ignore-revs` (new file), and document `git config blame.ignoreRevsFile` in
   `docs/local-development.md`.
5. Add the formatter's check mode to the root `lint` script, so CI enforces it.
6. Update the lint section of `AGENTS.md` to name the formatter and the command that fixes a file.

## Timing

The commit touches most files in the repository. Land it when no long-lived branch is open, and
rebase any short one onto it by re-running the formatter, not by resolving conflicts by hand.

## Out of scope

Rewriting dense modules for a reader is
[14: dense modules](./14-dense-modules.md). A formatter wraps a long line, but it can't split a
19-field type or name an intermediate value.

## Acceptance

- `pnpm lint` fails on an unformatted file and passes on the formatted tree.
- `git blame` on a formatted file skips the formatting commit once the ignore file is configured.
- `pnpm test` passes on the formatting commit.
