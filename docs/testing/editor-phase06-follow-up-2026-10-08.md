# Editor phase 06 follow-up acceptance, October 8, 2026

This records the review fixes and connected local acceptance on macOS with Node 24.21.0.
It supplements the [initial phase 06 evidence](./editor-phase06-2026-10-08.md), which remains historical.
The coordinator owns integration, whole-branch review, and the unfiltered repository test gate.

## Reproduce the disposable fixture

Install frozen dependencies in this worktree. Use the patched runtime and host permissions for
native processes and loopback listeners. Run commands through `rtk`:

```sh
rtk sh -c 'PATH=/private/tmp/editor-coordinator-node-bin:$PATH pnpm install --frozen-lockfile'
rtk sh -c 'PATH=/private/tmp/editor-coordinator-node-bin:$PATH pnpm dev:agent -- --session phase06-followup-desktop-fixture --fixture tui-navigation'
rtk sh -c 'PATH=/private/tmp/editor-coordinator-node-bin:$PATH node scripts/fixtures/editor-phase06.mjs .acorn/agent-dev/phase06-followup-desktop-fixture/fixture/repo'
```

Wait for `ready` before driving a session. Stop it before staging another desktop or terminal build.
For a restart, pass `--reuse` **without** `--fixture`; the fixture flag reseeds the repository.
The fixture script rejects paths outside disposable `.acorn/agent-dev/<session>/fixture/repo` directories.
No user's application repository was changed.

The recipe adds 10,000 TSX paths in 100 folders, repeated basenames, ignored build/generated output,
26 MB of excluded text, and a valid 1024×1024, 24-bit BMP image of 3 MiB.
`file` recognized the BMP. The index includes a staged modified file and a three-stage `UU` conflict.
The seed supplies modified, deleted, renamed, and untracked paths. Verify these with `git status`
and `git ls-files --unmerged` in the disposable repository.

## Follow the owners

Editor owns task-confined search options, retained Node/task state, scope reset, and tree metadata.
The route validates the shared contract, resolves the authoritative task root, and runs bundled ripgrep.
Both filename passes and the text pass share one close-joined process lifetime with SIGTERM/SIGKILL.
The filename intersection preserves ignore defaults when positive globs would re-include ignored paths.
The text pass also receives the bounded globs, avoiding excluded large-text scans.

The host captures the live focused collection row before opening the palette. Its identity includes
the Node/task tree owner. Editor resolves its entry through that explicit Node and rejects late completion.
Each directory listing owns its ignore read token. Failed metadata clears the hidden set while preserving listings.
Reveal checks the Node and listing generation. The typed `TabPanel` viewport offset and callback retain
the actual result reading place through worker rendering, hiding, and remounting.

## Desktop checks

The driver opened **Review changed files**, then **Editor**. A captured **Find in folder** menu on `src`
kept the task and active file. `needle`, include `src/group-009/**`, and exclude `**/item-09*` produced
90 results before the recovery edit. Result activation selected the exact path at line 1, column 24.
Default **Show ignored files** displayed `build`; turning it off hid that folder without closing its tab.
**Reveal active file** showed ignored ancestors while the preference stayed off. **Collapse all folders**
removed descendant expansions. Inactive row menus retained their captured target.

Light and dark appearances were inspected at 680×600 and 1440×900. Search controls, filters, results,
tree menus, file status, and editor remained reachable. Artifacts are under
`.acorn/agent-dev/phase06-followup-desktop-fixture/screenshots/`:

- `phase06-followup-light-wide.png` and `phase06-followup-light-narrow.png` show **dark** appearance;
  their filenames came from the OS scheme, which differs from the app preference.
- `phase06-followup-actual-light-narrow.png` and `phase06-followup-light-wide-search.png` show light appearance.

Run the fixture driver with a ready session:

```sh
rtk sh -c 'PATH=/private/tmp/editor-coordinator-node-bin:$PATH node scripts/fixtures/editor-phase06-webdriver.mjs phase06-followup-desktop-fixture scroll-retention'
rtk sh -c 'PATH=/private/tmp/editor-coordinator-node-bin:$PATH node scripts/fixtures/editor-phase06-webdriver.mjs phase06-followup-desktop-fixture remount-retention'
```

The driver waits for real result rows, scrolls the enclosing viewport, and checks Files/Search and
Agent/Editor remount. A late remote-prop race discovered during the final run received a host regression
test that failed before the fix. Final viewport results and counts are recorded below.

## Connected rename and recovery

Rename `src/group-009/item-000.tsx` to `item-000-renamed.tsx` through the inactive tree row menu.
The inline field submits Enter through the fixture driver's `enter-rename` action.
Stop and restart with `--reuse`; the renamed path persisted.

Open `src/group-009/item-082.tsx`, make its file read-only and parent directory unwritable, then use
`edit-fixture 'export const item82 = recoveryAfterRestart;'`. The Editor displayed EACCES, **Retry save**,
and **Save failed**, while disk retained the original text. Stop and reuse the same isolated session.
Editor reopened the exact tab with **Recovered draft** and the retained text. **Compare** showed disk
and draft. Restore the parent to mode 0755 and file to 0644. Arm and confirm **Overwrite disk** within
10 seconds. The driver observed **Saved**, and disk contained `export const item82 = recoveryAfterRestart;`.
Launcher logs include `/private/tmp/phase06-desktop-recovery.log`; the recovery used the existing document
custody and guarded write owner, without a new test-only seam.

## Terminal checks and key trace

Start `pnpm dev:tui:agent -- --session phase06-followup-tui --fixture tui-navigation`, add the same recipe
under `.acorn/agent-dev/tui/phase06-followup-tui/fixture/repo`, stop, and reuse without the fixture flag.
Drive with `pnpm dev:tui:agent:ui -- --session phase06-followup-tui press KEY`, `type TEXT`, `snapshot`,
and `resize 120 40`. Allow rendering to settle between keys and snapshots.

At 80×24, from the seeded task caret, `Tab Right Right Right Right j j j j` reached the `src` tree row.
`Ctrl+k`, type `Find in focused folder`, then Enter opened Search with `src` scope and no file activation.
Typing `needle` remained in the input after palette dismissal. This exposed and fixed a real pending-focus
lifetime: autofocus must wait until its owner is reachable after the command scope closes.

From the search field, Tab enters the option controls. Down walks case, word, regex, scope clear, and
**Search details**. Enter opens details; Down enters include, and Down again enters exclude.
The include/exclude values above produced 90 results. From include, four Downs and Enter activated
the first result (`src/group-009/item-087.tsx`). The tab and exact status path appeared in the same task.
The terminal's documented editor rectangle delegates editing to `$EDITOR`; its read-only graphical text
view is not implemented. Phase 06 does not replace that contract.

At 120×40, the live screen resized to 120 columns, displayed the scope, both filters, and results,
and kept the activated file. From the hit, Shift+Tab and four Ups reached **Clear folder scope**;
Enter cleared the scope while retaining both filters and 90 results.
Left returned to Files. From a tree row, Shift+Tab reached **New**, Up reached **Show ignored files**,
and Enter hid `build`. Up and Enter invoked **Reveal active file** and restored the active README caret.
Back at 80×24, two Ups and Right expanded `src`; Shift+Tab, three Ups, and Enter invoked **Collapse all**.
Only root rows remained. The same controls were exercised at both dimensions.

Key logs and ANSI output are in `.acorn/agent-dev/tui/phase06-followup-tui/logs/`.
Saved snapshots include `phase06-filter-result-120.txt`, `phase06-reveal-120.txt`, and `phase06-collapse-80.txt`.
The prior generic flow timeout is not counted as Editor acceptance. Both isolated sessions were stopped.

## Quantitative checks

Run `scripts/fixtures/editor-phase06-benchmark.ts` through `pnpm exec tsx` with the disposable root.
It observes actual child-process launches and runs each case three times sequentially on this machine.
The baseline reproduces the first Phase 06 two-pass owner, including its whole-root text scan.
The recovery-edited fixture had 89 selected files when measured:

| Owner | Durations, ms | Median, ms | Ripgrep processes/request | Files |
| --- | --- | --- | --- | --- |
| First Phase 06 whole-root text scan | 3175, 3252, 3256 | 3252 | 2, 2, 2 | 89 |
| Follow-up filtered owner | 38, 40, 40 | 40 | 3, 3, 3 | 89 |
| Unfiltered follow-up owner | 35, 37, 37 | 37 | 1, 1, 1 | 2000 cap |

This compares the owner on the same root and machine, not complete app startup or a different branch build.
No overflow or timeout occurred. Each case made three owner requests. The excluded large file explains
the baseline's extra scan work. A positive glob can still cause ripgrep to read explicitly selected ignored
paths; the default filename intersection prevents those matches from entering results.

The desktop fixture driver observes Editor requests at the real helper WebSocket boundary and records
route names and metadata counts, without request contents. The observation is retired with `stop-requests`.
File activation waits for both the selected status path and that file's CodeMirror text; three uncached
activations took 187, 197, and 198 ms. Earlier stale-content measurements were discarded.

## Verification and limits

Package results are recorded after the final fixes. No unfiltered `pnpm test` runs in this task.
The test audit retains distinct process, regex, debounce, focus capture, ignore-read, reveal, viewport,
and terminal-key regressions. It adds no production export used only by tests.

The [phase 01–05 completion notes](./editor-delivery-2026-10-08.md) provide the earlier guarded-save,
trash, conflict, navigation/history, formatter, terminal-editor handoff, and Git projection evidence.
This follow-up reran the connected rename/restart/recovery path and phase 06 controls; it does not
claim every earlier native/platform check was repeated.
Remote Nodes, Windows/Linux native hosts, native dialogs/menus, and child webviews were unavailable
to this isolated driver. These checks remain platform limits. Supported local Editor acceptance is
complete once the final viewport and package results below are recorded. Integration and the final
unfiltered gate remain assigned to the coordinator.
