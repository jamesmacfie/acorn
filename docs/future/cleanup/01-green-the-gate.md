# 01: Green the gate

This proposal gets `pnpm lint`, the architecture tests, and `pnpm test` passing on `main`, and gets
CI running on every push again. Every other cleanup proposal depends on it, because a refactor can't
prove it changed nothing against a gate that's already red.

Date: October 11, 2026. Status: proposed. Depends on: nothing. Part of the
[cleanup programme](./README.md).

## Problem

Local `main` is 276 commits ahead of `origin/main`. Those commits ran from October 7 to October 11,
2026, and added about 100,500 lines. `.github/workflows/ci.yml` runs on pushes to `main`, so CI
hasn't checked any of them.

On the investigation baseline, `npx turbo run lint --continue` fails in five packages: `@acorn/node`,
`@acorn/desktop`, `@acorn/tui`, `@acorn/plugin-agents`, and `@acorn/plugin-workflows`. The errors
come from five causes:

1. `plugins/agents/src/server/sessions/runtimeEngine.ts` types its `core` option and field as
   `CoreServices`, at lines 138 and 209. `runtime.ts` lines 393, 426, and 900, and `runtimeEngine.ts`
   lines 997 and 999, call `checkoutAdmission` and `secretPublication`. Only `CompiledCoreServices`
   declares those. This has been broken since commit `4ffd647cc` on October 9, and it accounts for
   the errors in node, desktop, and agents.
2. `plugins/git/src/client/RevisionView.tsx` line 48 passes `widthKey` to `ListDetail` and
   `scrollKey` to `ListColumn`. The desktop kit in
   `packages/client-core/src/kit/components/layout/ListDetail.tsx` accepts both. The terminal kit in
   `apps/tui/src/kit/grouping/columns.tsx` declares neither, so the terminal client's program fails.
3. `plugins/agents/src/client/sessions/AgentPane.test.tsx` lines 93 and 112 build subagents without
   the required `turnId`.
4. `plugins/agents/src/server/sessions/runtime.test.ts` line 506 sets `secretPublication` on a
   `CoreServices` literal.
5. `plugins/workflows/src/server/dispatch/workflowMapLifecycle.test.ts` line 222 assigns `() => null`
   where a `HeadlessArgv` factory belongs.

`pnpm --filter @acorn/arch-tests test` fails in `docPaths.test.ts` with 15 dead links. Seven point
into the deleted `docs/future/editor/` folder, from `docs/README.md`, `docs/future/README.md`, two
pages in `docs/future/tui-review/`, and `docs/testing/editor-delivery-2026-10-08.md`. Eight point
at screenshots in `docs/future/git-client/screenshots/` that were never committed. The same 15 were
red on October 10.

The root `lint` script is `oxlint && turbo run lint`. Turbo stops at the first failing package, so a
red package hides every red behind it.

These test failures were recorded on October 10 as predating the work in flight, and nobody has
fixed them since:

- `plugins/editor/src/client/EditorPane.test.tsx`: four cases around the file status menu. The
  **Word wrap** item is missing.
- `apps/tui/src/chrome/chrome.test.tsx`: two task marker cases.
- `plugins/agents/src/server/routes/managedBridge.test.ts`: one tool-fold paging case.
- `apps/node/test/integration/pluginSystem/pluginDisable.test.ts`: a stale golden.
- `plugins/workflows/src/server/authoring/generate.test.ts`: one step-kind fallback case.
- `apps/desktop/test/integration/persistedState.conformance.test.ts`: a slice count.

A gate that's always red teaches people and agents to ignore it. A real regression then looks like
an old failure.

## Goal

`pnpm lint`, `pnpm --filter @acorn/arch-tests test`, and `pnpm test` pass on `main`. `main` is
pushed, CI passes on it, and CI checks every later push.

## Requirements

1. Type the agents runtime's `core` as `CompiledCoreServices`. Agents is a compiled plugin, and
   `@acorn/plugin-api/node` already exports the type. Fix the `runtime.test.ts` fixture to match.
2. Make `RevisionView.tsx` compile on both hosts. Add `widthKey` to the terminal kit's `ListDetail`
   and `scrollKey` to its `ListColumn`, so pane code stays host-neutral. A terminal implementation
   may accept and ignore them.
3. Add `turnId` to the two `AgentPane.test.tsx` subagents, and give `workflowMapLifecycle.test.ts`
   a factory that returns a `HeadlessArgv`.
4. Fix the 15 dead links. Point the editor links at the page that owns the open acceptance. Either
   commit the eight Git client screenshots or remove the table that links them.
5. Change the root `lint` script to `oxlint && turbo run lint --continue`, so one run reports every
   failing package.
6. Run the full `pnpm test`. Fix each failure, or regenerate a golden where the golden is the stale
   side. Don't skip a test to get green.
7. Push `main` and confirm both CI jobs pass.

## Out of scope

The structural causes behind some of these failures, such as two hand-written client boots, belong
to [03: one client boot](./03-one-client-boot.md). This proposal fixes the symptoms so the gate can
guard that work.

## Optional: a pre-push check

Add a `pre-push` hook that runs `pnpm lint` and the arch tests, through a tracked hooks folder and
`git config core.hooksPath`. It costs about a minute per push, against five days of unchecked
commits. Document the opt-in in `docs/local-development.md` rather than installing it silently.

## Acceptance

- `pnpm lint` exits zero.
- `pnpm --filter @acorn/arch-tests test` exits zero.
- `pnpm test` exits zero, run outside the agent sandbox, which blocks the process and loopback
  tests.
- The CI run for the pushed `main` commit is green on the Linux and macOS jobs.
