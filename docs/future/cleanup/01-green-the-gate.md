# 01: Green the gate

> **Completion note, October 11, 2026.** `pnpm lint` and `pnpm --filter @acorn/arch-tests test`
> exit zero, and `pnpm test` passes on Node 26.8.1. `main` is not pushed, so requirement 7 and the CI
> acceptance stay open for the coordinator.
>
> What landed:
>
> - The agents runtime, its `runtime.test.ts` and `sessionWait.test.ts` fixtures, and the agents
>   testkit's `seedUnattendedPolicy` type `core` as `CompiledCoreServices`. The last two weren't
>   in the list above. They broke once the runtime's type changed.
> - The terminal kit accepts `widthKey` on `ListDetail` and `scrollKey` on `ListColumn` and ignores
>   both. The terminal list has a fixed width and keeps no scroll position.
> - `AgentPane.test.tsx` subagents carry `turnId: null`. The `workflowMapLifecycle.test.ts` profile
>   returns a real `HeadlessArgv`.
> - The 15 dead links are gone. The Git client screenshots weren't missing by accident: commit
>   `473320135` deleted them on October 9, so the reference table went too. Git history keeps the
>   images. The editor acceptance page went in the same commit, and no page took over its open
>   checks. So the editor links point at the
>   [phase six followup](../../testing/editor-phase06-follow-up-2026-10-08.md), which lists the
>   checks that couldn't run, or at the dated completion records.
> - The root `lint` script runs `turbo run lint --continue`.
>
> The test failures, and why each one was the stale side:
>
> - `EditorPane.test.tsx` opened the status menu with `button:last-child`. Since the October 8 icon
>   change, that selector finds **Copy absolute path** first. A helper finds **Details** by its label.
> - `chrome.test.tsx` counted markers without Git's uncommitted-changes dot, which the fixture task
>   carries. Every expected count goes up by one.
> - `managedBridge.test.ts` recorded a running tool under a turn it never started. Since October 8,
>   the read projection reports that tool as `unknown`. The fixture starts the turn.
> - `generate.test.ts` predates the agent step's `goal` input, added October 8.
> - `persistedState.conformance.test.ts` was missing the agents `composerExpansionSlice`. The agents
>   client testkit exports it.
> - The desktop `parity.snapshot.json` golden predates "Changes as a Git tab". It's regenerated.
>   `docs/panes.md` already matched.
> - Three Node integration tests broke on October 10, when plugins started registering a
>   deleted-task purge schedule and the testkit started providing a scheduler.
>   `httpLoaded.test.ts` and `databaseLoaded.test.ts` give their registries a scheduler that never
>   starts. `workflowActivation.test.ts` drops its second one.
> - The `pluginDisable.test.ts` golden was already green on this checkout.
>
> Four tests passed alone and failed under the full run, so each got a fix:
>
> - `mcpReviewProxy.test.ts`: the reconnect case reused the change flag the case before it leaves
>   on disk. Its fixture server then added a tool mid-read. It now uses a flag path that never exists.
> - client-core's `Markdown.test.tsx`: a test that ends synchronously can leave the highlighter
>   import running. At teardown, that import missed the mock and loaded the real module, and Vitest
>   reported an unhandled error. `afterEach` now awaits `vi.dynamicImportSettled()`.
> - client-core's `DiffPane.test.tsx` checked re-coloured segments after one fixed 150 ms pause.
>   Under load, re-tokenizing takes longer. The check waits for the result instead.
> - The `boundaries.test.ts` scan that parses every library file takes about a second alone and
>   more than five under load. It has a 30-second timeout.
>
> Decisions and deviations:
>
> - I skipped the optional pre-push hook. Unchecked commits piled up because `main` wasn't pushed,
>   and a hook doesn't change that. CI covers every push once `main` goes up.
> - Requirement 7 is not done. This task wasn't allowed to push.
>
> What later phases need to know:
>
> - Run the gate on a Node inside the root `engines` range. On Node 24.11.0, 33 more tests fail.
>   The loaded-plugin and worker tests refuse an unpatched runtime, and `instructionSnapshot.test.ts`
>   hits a Node 24.11 `rmSync` bug that leaves a dangling symlink in place. Put
>   `~/.nvm/versions/node/v26.8.1/bin` first on `PATH`, or install 24.18.1 or later.
> - A test that fails only under the full run is a real red. Run it alone to find the cause, then fix
>   it. Don't wave it through as a flake.
> - Run the process and loopback tests outside the agent sandbox. Inside it, they fail.

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
