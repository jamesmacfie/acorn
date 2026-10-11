# 13: Formatter

> **Completion note, October 12, 2026.** oxfmt formats every TypeScript file, and `pnpm lint` runs
> `oxfmt --check`. The formatting commit is `477f40f1f31b6019776c45aae25831729b913d98`, listed in
> `.git-blame-ignore-revs`, and `git blame` skips it once `blame.ignoreRevsFile` is set. `pnpm lint`,
> the arch tests, and `pnpm test` pass on Node 26.8.1, on a tree whose TypeScript matches the
> formatting commit. `pnpm lint` fails on a file the formatter would change. An earlier full run, on
> the first formatter pass, had one red: `PreviewTaskPane.test.tsx` "binds same-ID task reads to the
> originating Node" timed out at one second under load. It passed alone four times.
> The rebase recipe in `docs/local-development/formatting.md` carried a scratch branch from before
> the formatting commit across it with no conflict to resolve by hand.
>
> What landed, in three commits:
>
> 1. "Phase 13: Parse the ref rule before formatting". The arch rule that keeps `ref` out of
>    contribution props matched lines, and assumed a parameter named `ref` never starts its line.
>    The formatter put `taskTracksRef`'s `ref` parameter on its own line, and the rule failed. The
>    rule parses each file with TypeScript and checks `ref` property signatures in a type or
>    interface named `...Props` or in a `Component<{ ... }>` argument. A planted member fails it on
>    either layout. It lands first so the formatting commit holds nothing else and stays green.
> 2. "Phase 13: Apply the formatter". 3,118 of 3,865 TypeScript files, 180,682 lines added and 65,541
>    removed. Nothing else is in it.
> 3. "Phase 13: Formatter". oxfmt 0.71.0 as an exact root dev dependency, `.oxfmtrc.json`, the
>    `format` script, `oxfmt --check` in `lint`, `.git-blame-ignore-revs`, and the docs: the scripts
>    table and lint section of `AGENTS.md`, `README.md`, `docs/testing/commands.md`,
>    `docs/testing/ci.md`, the CI workflow comment, and a new page,
>    `docs/local-development/formatting.md`, with the `blame.ignoreRevsFile` setting and a rebase
>    recipe. `docs/local-development.md` was at 199 of its 200 lines, so it gets one row linking there,
>    and `docs/README.md` lists the page.
>
> Decisions:
>
> - **oxfmt, not Prettier.** Both print the same layout here: at width 120 they differ by about 120
>   lines across the tree. Both need the same settings to match the code. oxfmt checks the
>   tree in about 0.2 seconds, and Prettier took about 22, which matters for a check in every
>   `pnpm lint`. oxfmt adds itself, `tinypool`, and one native binding per platform, the same shape
>   oxlint already has. Prettier has no dependencies, so it was close.
> - **Width 120.** At 100, the formatter changes 78,497 lines in 3,411 files. At 120, it changes
>   65,542 in 3,118. The code's comments already wrap at about 120 columns counting indent: 27% of
>   comment lines pass 100 and 1.1% pass 120. A formatter doesn't rewrap comments, so at 100 the
>   code and its comments would wrap at different widths.
> - **Trailing commas `all`, arrow parentheses `always`, quoted keys as needed.** These are the
>   defaults. Trailing commas `all` churns least (65,542 lines, against 66,695 for `es5` and 74,344 for
>   `none`). The code writes `(x) =>` 13,738 times and `x =>` 5,795 times.
> - **oxfmt 0.71.0, pinned exactly.** 0.72.0 was six days old, and `pnpm-workspace.yaml` asks for
>   seven. Both print the same tree. A 0.x release can change the layout, so a version bump is its
>   own commit with `pnpm format`.
> - **Tabs pinned off.** oxfmt reads any `.editorconfig` above the checkout. James's home folder has
>   one with `indent_style = tab`, which turned the first trial run into tabs. `.oxfmtrc.json` sets
>   `useTabs` and `tabWidth`, so every machine prints the same layout.
> - **Two passes.** One pass left 25 files that a second pass changed again: a method chain the first
>   pass split out of one long line, the second joins back onto one line. The formatting commit holds
>   the second pass, and a third changes nothing. `docs/local-development/formatting.md` tells a
>   reader to run `pnpm format` again if `pnpm lint` still lists a file.
> - **Embedded languages off.** By default oxfmt reformats GraphQL inside template literals, which
>   changed the query strings in `plugins/github/src/server/routes/mirror/prFetch.ts`. Off, no string
>   changes.
> - **TypeScript only, through `ignorePatterns`.** The config ignores everything, then re-includes
>   `.ts`, `.tsx`, `.mts`, and `.cts`. Bare `oxfmt`, `oxfmt <file>`, the lint check, and the editor
>   extension all see the same set. Migration SQL, which is hashed, the Drizzle snapshots, JSON, docs,
>   and the 96 JavaScript scripts keep their layout. `dist` folders are skipped because `.gitignore`
>   lists them. The one generated TypeScript file, `workspaceIconNames.ts`, is listed by name.
>   `iconNodes.ts` says "generated" in a comment but is hand-written, so it's formatted.
>
> How I checked that the formatting commit changes no behavior: a throwaway script parsed every file
> at the base and after formatting with TypeScript and compared the syntax trees. It ignored
> parentheses, trailing commas, empty statements, the `'key'` versus `key` spelling, the grouping of a
> `??`, `||`, or `&&` chain, and JSX whitespace that renders the same. All 3,865 files matched except
> one, where a `;` between two class methods became a line break.
>
> For later phases:
>
> - Run `pnpm format` before you commit, or `pnpm format <file>` on the files you touched. `pnpm lint`
>   fails on any TypeScript file the formatter would change.
> - A branch cut before the formatting commit follows the rebase recipe in
>   `docs/local-development/formatting.md`: rebase to the commit before it, rebase across it with
>   `-X theirs`, then `pnpm format`. Don't resolve layout conflicts by hand.
> - A rule that scans source by line can break when the formatter rewraps code. The `ref` rule was
>   the only one that did. Parse with TypeScript, as `tools/arch/boundaries.test.ts` does.
> - After formatting, 1,449 lines still pass 120 characters and 394 pass 200. 510 are comments and
>   most of the rest are long strings and template literals, which the formatter doesn't split.
>   Proposals 14 and 15 own those.

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
