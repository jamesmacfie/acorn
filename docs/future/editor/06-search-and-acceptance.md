# Phase 06: scope search and finish acceptance

> **Implementation note — October 8, 2026.** Editor search accepts a task-confined folder and
> validated include/exclude globs, retains task-scoped search state through hiding and remount, and
> fences stale requests and result navigation. A bounded ripgrep file-list pass applies glob
> precedence before the ordinary text search, preserving default hidden and Git-ignore behavior.
> This requires two ripgrep processes when filters are present. The Node owns both processes and
> terminates them on cancellation. Scope rename/trash requires an explicit reset.
>
> The tree shows Git-ignored entries by default, labels them accessibly, and can hide or temporarily
> reveal them without closing open documents. Git metadata is requested in bounded batches for
> listed directories through the public Git owner API. Collapse all clears descendant expansion.
> Search and tree commands use captured task context and shared typed kit targets. The Editor search
> bridge loads lazily; the Node static bundle is 3,145,174 bytes against a 3,150,000-byte ceiling.
>
> **Verification and limits.** See [dated phase 06 evidence](../../testing/editor-phase06-2026-10-08.md).
> Editor passed 194 tests (one skipped), Node app 273, Node core 1,636, plugin API 14, TUI 684
> (two skipped), desktop built suites 182 JS, 10 boot, and 65 Rust, architecture 87, and lint 37
> tasks. Client core passed 2,468 with two workspace-route/CSS-token failures also reproduced on
> untouched older parent `bf1143d08`. The desktop driver exercised scoped filtering, result
> navigation, ignored visibility/reveal, and collapse on a 10,000-path disposable fixture. Terminal
> Editor navigation, remote/platform/native-dialog checks, quantitative runtime bounds, and the
> connected six-phase restart flow remain unverified. The full unfiltered `pnpm test` gate is
> pending with the coordinator after integration.

Date: October 7, 2026. Status: implemented October 8, 2026; combined release acceptance pending.
Source baseline: `47f7431e72c9f239736ce63fb6774aed4f61180c`.
Dependency: [phase 05](./05-editing-controls.md).

This PRD adds folder search, include/exclude patterns, ignored-file visibility, and tree housekeeping.
It also defines combined acceptance for all six editor phases before their product release.

## Problem and outcome

Find in files searches the task root with case, whole-word, and regex options. There is no folder
scope or include/exclude input. The tree hardcodes `.git` and `node_modules` exclusion, while quick
open and ripgrep use Git ignore rules. A person needs to narrow a search and control tree clutter
without a project language service or global filesystem scan.

## Starting points and owners

Inspect these files and their tests:

- `plugins/editor/src/client/search/SearchPanel.tsx` and `searchClient.ts` own search controls,
  cancellation, and result navigation. Resolve these suffixes within the Editor search client folder.
- `plugins/editor/src/shared/search.ts`, `server/search.ts`, `server/searchProcess.ts`,
  `server/searchResults.ts`, and `server/routes/search.ts` own options, invocation, and bounded results.
- `plugins/editor/src/client/FileTree.tsx`, `editorTreeState.ts`, and `fileTreeReveal.ts` own tree
  expansion/reveal. `plugins/editor/src/server/editor.ts` owns listings and quick-open file enumeration.
- `plugins/editor/src/client/commands.ts` owns palette entry points.

Read [find in files](../../editor/find-in-files.md), [the editor pane](../../editor/editor-pane.md),
[the driver workflow](../../local-development/agent-drivers.md), and [testing](../../testing.md).
Keep [inline find](../find-in-file.md) independent of this project-search implementation.

## Required search behavior

Add **Find in folder** to a folder menu and its focused-target command. It opens the search sidebar
with the captured relative folder as the scope, preserving the current query and matching options.
Show that scope with **Clear folder scope**. Clearing it searches the task root. This action does not
open a file or change the Node/task selected by the invoking owner.

Under a collapsed **Search details** control, provide labeled **Files to include** and **Files to exclude**
inputs. Accept comma-separated ripgrep glob patterns. Examples include `*.tsx`, `src/**`, and
`**/generated/**`. Trim delimiter whitespace and ignore empty entries. Negative patterns are supported
only in the exclude input; do not introduce shell expansion or promise VS Code's distinct glob semantics.
State that a literal comma-bearing pattern is outside this first version's grammar.

Set limits of 20 patterns per input, 256 characters per pattern, and a 4 KiB total filter payload.
Validate limits on the Node and show an input error. Excludes win over includes. Default search
continues to honor ignore files and skip hidden files; this phase does not add a search-all-files toggle.

Changing scope or patterns aborts the previous request and starts a debounced replacement. The captured
Node/task/query/options/filter set identifies the response. Hiding the panel retains its query, filters,
results, and reading place for the task's pane model. Scope and filters do not leak across Nodes/tasks
and do not need restart persistence.

Preserve result counts, exact line/column navigation, loading/error/empty states, invalid-regex errors,
process cleanup, and the 2,000-match truncation contract. A missing scoped folder is an actionable
scope error, not an empty successful search. A rename/trash affecting the scope offers a clear/reset
action; do not silently redirect the query to another directory.

## Node search contract

Extend typed search options with an optional case-preserving relative folder and include/exclude
arrays. The task remains the authority for the root. Validate folder confinement on the Node before
spawning ripgrep. Reject an escaped symlink scope rather than searching outside the checkout.

Invoke the bundled ripgrep through its existing process owner with `--no-config`, bounded args, and
`--` before the query and search target. Pass patterns as separate arguments, never through a shell.
Search with the task root as the working directory so response paths remain relative to that root,
even when the target is a subfolder. Keep the installed ripgrep's glob precedence in tested argument
construction rather than reproducing matching in JavaScript.

The file text, pattern case semantics, and filename handling follow ripgrep and the Node filesystem.
Display relevant limitations in the search help. Do not silently uppercase/lowercase canonical paths.

## Required tree behavior

Add **Collapse all folders** and **Reveal active file** to the tree toolbar/menu and the palette.
Collapse clears retained descendant expansion for the task, not just the visible parent rows. Reveal
opens only the needed ancestors, waits for listings/usable geometry, and scrolls the active row into
view. Preserve the current manual reveal behavior; automatic reveal on every tab switch is deferred.

Add a device preference **Show ignored files**, on by default to preserve the visible tree inventory.
When on, mute Git-ignored entries and identify their ignored status accessibly. When off, omit ignored
entries. Dotfiles are otherwise visible. Keep `.git` excluded as Git metadata and `node_modules`
excluded as the established large dependency folder; explain those fixed exclusions in the control help.

Resolve ignore metadata in bounded Node batches for requested directory entries, reusing a status/ignore
owner where available. Do not run `git check-ignore` per row or load every unopened folder. Use
filename-safe machine output. In non-Git checkouts or on ignore-read failure, keep usable listings
and expose the unavailable filtering state rather than hiding arbitrary files.

An already-open ignored file remains open when hidden in the tree. Explicit reveal can temporarily
show that path and its ancestors without changing the device preference. Clearing that reveal or
changing active file removes the temporary visibility. Creation/rename in a hidden ignored folder
likewise reveals the affected item long enough to show the mutation result.

## Boundaries and delivery sequence

Exclude replace across files, result export, project indexing, search-all-hidden/ignored modes,
arbitrary file-exclusion configuration, compact folder chains, and sticky tree ancestors.
Retain lazy loading, virtualization, stale-response rejection, and terminal keyboard navigation.

Implement the validated search contract and subprocess tests, then scope/filter UI, then tree controls
and ignore metadata. Update find-in-files, editor-pane, preference scope, and API reference docs.
Follow the shared kit and capability boundaries; do not build another search engine or menu system.

## Phase acceptance

Prove these behaviors with real temporary Git repositories and process tests:

- Search a folder, include `*.tsx`, exclude generated files, clear scope, and change filters while a
  request runs. Results stay task-root-relative and stale work cannot replace them.
- Pattern limits, option-like queries, paths with spaces/Unicode/leading dashes, invalid regex/globs,
  missing folders, and outside symlink scopes report the defined error without shell interpretation.
- Include/exclude precedence, ignored/hidden search defaults, exact UTF-16 columns, truncation, abort,
  timeout, and process termination preserve the documented behavior.
- Hide/show ignored entries, encounter a failed metadata read, reveal an ignored open file, rename an
  ignored folder, and collapse/reopen the tree. Focus, viewport placement, and retained paths remain valid.
- Desktop and terminal users can scope search, change patterns, navigate results, and use tree commands.
  An unrelated Node/task receives no requests after invocation context changes.

Run `pnpm lint`, full suites for `@acorn/plugin-editor`, `@acorn/client-core`, `@acorn/node-core`,
`@acorn/plugin-api`, `@acorn/tui`, any Git provider or protocol packages changed, and their consumers.
Run `pnpm --filter @acorn/arch-tests test`.

## Combined release acceptance

Run the full `pnpm test` gate after package checks pass. Use disposable local and remote checkouts,
including a Runn-like fixture with 10,000 files, repeated basenames, ignored build outputs, large text,
images, dirty drafts, and staged/unstaged/conflicted paths. Record fixture creation so another developer
can reproduce it. Do not modify a user's working application repository for acceptance.

Verify this connected desktop flow and its supported terminal projection:

1. Open a file through recent quick open and `path:line:column`; edit, wrap, indent, find, and save.
2. Change disk from another process while clean, then while dirty. Observe reload and conflict,
   compare, and deliberate resolution. Reconnect and reopen a cached file.
3. Create, rename a dirty open file, rename its parent folder, and trash a saved file. Verify no old
   path is recreated. Exercise unsupported trash and a failed mutation without losing text.
4. Observe Git file/tab marks and folder summaries; disable the provider and keep opening files.
5. Scope/filter search, follow a result, navigate back/forward, bulk close, and reopen a file.
6. Restart with renamed tabs and recovered dirty text. Switch Nodes/tasks and archive a scope;
   verify correct state isolation and cleanup.

Use [isolated drivers](../../local-development/agent-drivers.md), inspect screenshots at narrow/wide
widths and light/dark appearances, and check terminal 80-by-24 and 120-by-40 layouts. Verify keyboard
menu entry and focus restoration with a real keyboard/native driver where WebDriver cannot reproduce
them. Stop both sessions. Record unsupported host checks explicitly rather than marking them passed.

Report task status/search request counts, Git subprocess counts, file-open latency, loaded tree rows,
and retained history/recency bounds for the large fixture. Compare with the pre-change baseline on the
same machine. Resolve any per-row process/read behavior or loss of viewport bounds before release.

Complete the programme only when all six phases meet their acceptance, shipped owner docs describe
their contracts, and remaining platform limits are stated. Update PRD status and link dated evidence;
do not use this document as a substitute for failed runtime checks.

## Verify before building

- Recheck the bundled ripgrep version, glob precedence, route validation, and cancellation lifetime.
- Inspect tree exclusion behavior, reveal generations, and shared ignore/status ownership.
- Confirm phase 02 menus and phase 04 history consume scoped search navigation consistently.
- Audit combined tests for observable outcomes rather than source-shape or engine-implementation duplication.
