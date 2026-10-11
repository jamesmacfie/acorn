# 15: Comment cleanup

> **Completion note, October 12, 2026.** Comments in every package meet the bar below, and
> `tools/arch/commentPaths.test.ts` passes with no allowlist. The diff touches 1,443 files and
> removes about 1,840 comment lines net. Many more lines were rewritten from history into the
> constraint they explained. `pnpm lint` and `pnpm --filter @acorn/arch-tests test` pass on
> Node 26.8.1, and so does `pnpm test` apart from two cases that failed under load and passed alone:
> the `telemetry and log` cases in client-core's `src/host/frames/sdk.test.ts`, which fail about one
> run in ten on the base commit too, and the `PreviewTaskPane.test.tsx` case that proposal 13 saw time
> out at one second. Both suites passed in full on a rerun.
>
> What landed:
>
> - **The rule.** `AGENTS.md` has a "Comments" section with the bar, a pointer to `docs/writing-docs.md`
>   for doc citations, and the new check's name.
> - **The path check.** `tools/arch/commentPaths.test.ts` parses every TypeScript and JavaScript
>   file with TypeScript, reads its comments, and resolves each path that has a folder and an
>   extension. A path resolves from the root or the file's folder, as `<package-folder>/<path in the
>   package or its src/>`, as the tail of a tracked file, or inside `node_modules`. It skips `docs/`
>   paths (the citation check owns them), dot-folder paths such as `.acorn/config.toml`, `dist/`
>   paths, and lines with a "gone" marker. `GONE` moved into `docAnchors.ts`, so the doc path check
>   and this one share the list. `docs/testing/architecture-rules.md` and `docs/conventions.md`
>   describe it.
> - **The citation check reads a wrapped `§`.** `docCitations.test.ts` skipped a citation whose `§`
>   started the line after the path. About ten comments were like that, and most named headings that
>   don't exist. The check now reads them.
> - **Every stale path and missing name is fixed.** The path scan found 347, not 178, because it also
>   reads tests and resolves relative paths strictly. All are fixed, most by naming the symbol. The
>   missing-identifier scan found about 90 names, most of them library APIs (OpenTUI, Shiki, Yoga,
>   TanStack Query). The repo names it found are gone: `paletteRows` in eight files, `createPanelData`,
>   `normalizePanel`, `pushRight`, `pushDown`, `trapOverlayFocus`, `scanLinearRefs`, and others.
> - **The four named wrong comments.** `pluginHost/state.ts` names `reload()` and drops the quote
>   `docs/plugins.md` no longer has. `plan.ts` and `dashboards/run.ts` call `message` the Node's own
>   sentence, which a client draws when it doesn't word the failure itself. The workflow "legacy"
>   `after` and the `taskBranch.ts` "legacy" path read as current behavior. `App.tsx` describes the
>   shell it draws.
> - **Wrong comments the reading found.** Many counts were wrong ("six seams" for eight, "nine
>   built-in kinds" for 11, "One member" for four). Electron and OpenTUI leftovers described a shell
>   and a painter that are gone. Comments claimed callers that don't exist, such as save-to-repo as the
>   one caller of `writeWorkflowToml`. A dozen doc comments sat above the wrong declaration, and each
>   moved to the one it describes. Eleven doc comments had a doubled `/**` opener.
>
> The pattern scan, before and after, across all source including tests:
>
> | Pattern | Blocks before | Blocks after |
> | --- | --- | --- |
> | History | 760 | 291 |
> | Phase or programme | 156 | 11 |
> | Date | 74 | 3 |
> | Measurement | 113 | 88 |
> | Eight lines or more | 1,444 | 1,302 |
>
> What's left is deliberate. The history hits use "no longer", "old", or "previous" for state at run
> time, "used to" in the sense of "used for", "legacy" for a real external format (legacy terminal key
> encodings, Sentry's legacy DSN secret), or describe mixed-version code that proposal 11 owns. The
> phase hits are DOM capture phases, the startup restore's phases, and a telemetry attribute. The
> dates are an example timestamp in a parser comment. The measurement regex mostly matches "measured"
> about layout and heights. The long blocks that remain are constraint, not narrative.
>
> Decisions and deviations:
>
> - **Comments only, proven mechanically.** A script reprinted each changed file with TypeScript's
>   printer and comments removed, and compared it with `HEAD`. It reports no difference in any file
>   but the three arch tests. Rust diffs touch only `//` lines. No directive comment (`@ts-`,
>   `@vite-ignore`, JSDoc types in `.mjs`) changed.
> - **Tests are in scope.** The proposal counted comments outside tests. The check reads tests too,
>   because a test comment that names a moved file misleads the same way.
> - **No identifier check**, as the proposal says. Bare file names (`Panel.tsx`) aren't checked either:
>   without a folder they can't be told from a library's file.
> - **Files changed on `main` since this branch started were left alone,** apart from two one-line
>   path fixes the check needed: `plugins/git/src/client/paneContribution.ts` and
>   `plugins/sentry-telemetry/src/server/stack.ts`. `main`'s changes to those files predate the
>   formatting commit, so merging `main` means resolving them by hand anyway. Take `main`'s text and
>   keep "`paneModel` in client-core" in the first. The long blocks in `host/tree/Slot.tsx` and
>   `workerHost.ts` were not reviewed for the same reason.
> - **One commit per package**, in the proposal's order: client-core, node-core, the terminal client,
>   agents, protocol, then the rest. The check, the rule, and this note come last, because the check
>   fails until every package is clean.
>
> Bugs and gaps that comments revealed. Nothing here changed code:
>
> - Preview-browser page rules are stored and served but never applied. `matchesUrlPattern` in
>   `packages/protocol/src/integrations/browserRules.ts` has no caller outside its test, and nothing in
>   `apps/desktop` calls custody's `previewRules`. It looks lost in the move from Electron to Tauri.
> - A task check's manifest `timeout` is parsed but not applied. `registerManifestTaskChecks` drops it,
>   and `runOne` in `pluginHost/taskChecks.ts` always uses `CHECK_TIMEOUT_MS`.
> - After a local Node restart, the terminal client's `nodeRestartLocal` sends no `onNodeReplaced`
>   push, unlike the desktop.
> - In the terminal client's `chrome.test.tsx`, opening the `pr` pane leaves a key registration
>   behind. The test works around it by running last.
> - `ChangesPane.test.tsx` builds its stand-in model with `modelConnections`, but the real model reads
>   `modelBackends`. It passes only because `modelPick` is null.
> - A row from a panel bound to another Node opens through the active Node's task cache
>   (`openPane` in `host/chrome/actions.ts`, `openTask` in `frameServices.ts`), so it reports
>   "not found" instead of switching Nodes.
> - The end-to-end plugin registration coverage that `extensionPoints/plugin.test.ts` relied on was
>   the deleted desktop e2e suite. Nothing else renders the real plugin entrypoints' registration.
> - `docs/plugin-authoring/the-manifest.md` says the API major is 3. It's 4. That's for proposal 16.
> - Two `HostOwned<'…'>` type strings in `plugin-types` name owners that no longer exist
>   (`contracts/storage.ts`, `contracts/capabilities.ts`). They're code, so they stayed.
> - `apps/node/.plugin-build/database-RPMjjD/database.js` is a build artifact that is tracked in git.
>
> For proposal 12, unused code that comments revealed: `pinsOptions` and the `/v1/p/github/pins`
> routes, `reviewNotesKey` in the git plugin, `StartRequest.prefill` in workflows, `homeClient` in
> `infra/node/fleet.ts`, `panelMeasure` and `pruneMapping` in dashboards-core, `startServer` in
> `transport/listener.ts`, and the `bold`, `dim`, `underline`, and `inverse` fields `textStyle` returns
> in the terminal kit. For proposal 11, the workflow step-name branch for definitions without
> `formatVersion` looks unreachable.
>
> For later phases: a comment that names a file has to resolve, so a move or rename now fails the arch
> tests until the comments follow. Name the symbol instead, and the comment survives the move.

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
