# Phase 0: hygiene

Status: shipped 2026-08-30. Waits on nothing.

## Goal

The repo tracks only what it means to. The dangling submodule entry, the package-manager cache, the
test-runner artifact, the stray screenshot, the superseded `plans/` convention, the three empty plugin
directories, and the orphan HTML plugin map are gone. The one test no runner collects is collected.

## Why this phase, and why now

Every later phase moves files with `git mv` and reads `git status` to confirm the move. A tree with a
gitlink that has no `.gitmodules` entry, a tracked file under an ignored directory, and directories
that are not packages makes that noise. Clearing it first is an hour of work and makes every later
diff readable.

## Scope

Commit the pending working tree first. On 2026-08-30 the tree had `docs/future/layout/` deleted but
not committed, `docs/future/terminal/` untracked, and `tools/arch/kitTable.test.ts` untracked. This
phase starts from a clean `git status`.

Then, in one commit:

1. Remove the `forge` gitlink: `git rm --cached forge`, delete the empty directory, drop `forge/**`
   from `.oxlintrc.json`, and fix root `README.md` line 110, which cites a `docs/smolforge/` that
   never existed.
2. Untrack `.pnpm-store`: `git rm --cached -r .pnpm-store` and add `.pnpm-store/` to `.gitignore`.
3. Untrack `test-results/migration-audit/index.html`. The directory is already ignored; the file
   predates the rule.
4. Delete `select-filter.png` at the root. Nothing references it.
5. Delete `docs/plugin-map.html`. Nothing references it, nothing generates it, and it has already
   diverged from `docs/plugin-map.md`.
6. Delete `plans/`. Its two records are dated 2026-08-07, both numbered 001, and their behaviour is
   owned by `docs/managed-agents.md` and `docs/integrations.md`. `docs/future/README.md` already
   says git history is the archive for shipped design.
7. Delete `plugins/profiles-aider/`, `plugins/profiles-claude/`, `plugins/profiles-codex/`. Each holds
   only gitignored `dist/` and `.turbo/` output; `git ls-files` returns nothing for them. The
   profiles live in `plugins/agents/src/main/profiles/`.
8. Delete `docs/next-review.md` after moving any item still open into the relevant
   `docs/future/` file. It is a personal checklist with zero inbound links.
9. Dedupe `pnpm-workspace.yaml`: `allowBuilds` and `onlyBuiltDependencies` list the same three
   packages. Keep the one the installed pnpm version reads.
10. Fix the dead test: add `src/**/*.test.ts` to the shell project's `include` in
    `apps/desktop/vitest.config.ts` so `apps/desktop/src/app/client/scopedEviction.test.ts` runs.
    Confirm with `vitest list` that the count rises from 76.

## Out of scope

Anything that moves a source file. Renaming `docs/` files (phase 1). The `.turbo/turbo-test$colon$unit.log`
files in every plugin are stale cache keys for a script that no longer exists; they are ignored and
not worth a step.

## Done when

- `git ls-files -s forge` returns nothing and `git status` is clean after `pnpm install`.
- `git ls-files .pnpm-store test-results select-filter.png plans docs/plugin-map.html` returns
  nothing.
- `ls plugins | wc -l` reports 19 directories plus the three shared files.
- `pnpm --filter @acorn/desktop test` collects `scopedEviction.test.ts`.
- `pnpm lint` and `pnpm test` are green.

## What shipped, and where it differed

Every step landed. Three things are worth knowing before phase 1.

Step 8's one surviving item went to `docs/testing.md`, not to a `docs/future/` file. Nine of
`next-review.md`'s ten items were already owned: smoke items 1, 2, and 23 to 25 cover the fresh
install, the second node, and the layout pass, and the checklist already says its first pass is owed;
[shell.md](../../shell.md) § Signing gates and the updater owes the DMG run on a clean machine;
[caching.md](../../caching.md) and [data-layer.md](../../data-layer.md) already refuse one blind
retention rule. The tenth, the Rollbar privacy allowlist against real payloads and the context and
Notes panes at their narrowest, is manual verification, and manual verification lives in the smoke
checklist. It is item 26.

Step 9 resolved by probe rather than by reading. A throwaway install under pnpm 11.0.0 with only
`onlyBuiltDependencies` set still refused to build esbuild, and with only `allowBuilds` set it built
quietly. `allowBuilds` is the key pnpm reads; the other was dead and is gone.

One step is not in the list above. The deleted `docs/next-review.md` and `docs/plugin-map.html` broke
`tools/arch/docPaths.test.ts`, which fails a backticked repo path that does not resolve unless the
same line carries a marker such as "deleted" or "moved to". Five lines named a deleted file: three in
this folder, one in `docs-migration.md`, one in `phase-7-docs-reference-sweep.md`, and the new
`testing.md` sentence. Those five lines were reworded. The checker was not touched, because phase 6
owns enforcement.

Step 10 worked as written: `src/**/*.test.ts` under the shell project collects
`scopedEviction.test.ts`, and it passes there without the Solid transform. The desktop count is 80,
up from 76.

## Verify before building

- `git ls-files -s forge` still shows mode `160000`.
- `git check-ignore -v .pnpm-store` reports not ignored.
- `grep -rn smolforge README.md` still hits line 110.
- `grep -rn "select-filter" --include=*.md --include=*.ts --include=*.tsx .` is still empty.
- `plugins/profiles-*` still have no `package.json`.
