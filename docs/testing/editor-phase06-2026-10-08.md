# Editor phase 06 acceptance, October 8, 2026

This records phase 06 checks in an isolated macOS worktree. The connected six-phase release gate remains pending after integration.

## Reproduce the fixture

Use Node 24.21.0. From a clean worktree, install frozen dependencies. The isolated launchers seed Git repositories under `.acorn/agent-dev/`; the following commands add 10,000 repeated-basename TSX paths, ignored build and generated outputs, a large text file, and a 1 MiB image. The seed already has modified and deleted tracked files. No application checkout was modified.

```sh
PATH=/private/tmp/editor-coordinator-node-bin:$PATH pnpm install --frozen-lockfile
PATH=/private/tmp/editor-coordinator-node-bin:$PATH pnpm dev:tui:agent -- --session phase06-tui --fixture tui-navigation
PATH=/private/tmp/editor-coordinator-node-bin:$PATH node scripts/fixtures/editor-phase06.mjs .acorn/agent-dev/tui/phase06-tui/fixture/repo
PATH=/private/tmp/editor-coordinator-node-bin:$PATH pnpm dev:tui:agent:ui -- --session phase06-tui stop
PATH=/private/tmp/editor-coordinator-node-bin:$PATH pnpm dev:agent -- --session phase06-desktop --fixture tui-navigation
PATH=/private/tmp/editor-coordinator-node-bin:$PATH node scripts/fixtures/editor-phase06.mjs .acorn/agent-dev/phase06-desktop/fixture/repo
PATH=/private/tmp/editor-coordinator-node-bin:$PATH pnpm dev:agent:ui -- --session phase06-desktop stop
```

Wait for each launcher to print `ready` before driving it or adding paths. Stop the TUI before desktop staging. The fixture script only accepts an explicit path, so point it at a disposable seeded repository.

## Observed behavior

The desktop driver opened **Review changed files** and **Editor**. The tree listed the ignored `build` folder with an accessible ignored label. The `src` folder menu opened **Find in folder**; the sidebar showed `src` as scope without changing the selected task or opening a file. Searching `needle` returned the 2,000-match cap. **Files to include** set to `src/group-000/**` reduced the count to 100, and **Files to exclude** set to `**/item-00?.tsx` reduced it to 90. Opening `src/group-000/item-093.tsx` landed at line 1, column 24. The root-relative include pattern is deliberate, including when the search target is `src`.

Turning **Show ignored files** off removed `build` from the tree while leaving an open `build/output.tsx` tab intact. **Reveal active file** temporarily showed `build` and `build/output.tsx` with ignored labels while the preference stayed off. Expanding `src` and `src/group-000`, then using **Collapse all folders**, returned the tree to root rows. The screenshot is `.acorn/agent-dev/phase06-desktop/screenshots/phase06-search.png`; it shows the scoped result and exact status position at the host's 1440×900 dark appearance.

The TUI built and launched at 80×24 against the same fixture recipe. Resizing to 120×40 and taking a snapshot worked, but the visible pane remained 80 columns wide. The generic `navigation` flow stopped on its **Refresh changes** assertion while Changes was still loading; a later snapshot showed that control and 10,025 changes. The TUI driver did not reach phase 06 Editor controls, so terminal visual acceptance remains open. The report is `.acorn/agent-dev/tui/phase06-tui/reports/navigation-2026-10-08T04-12-11.353Z.json`.

The 10,000-path search returned within the desktop driver's next snapshot. The driver did not provide isolated request counts, Git subprocess counts, file-open latency, mounted row counts, or retained metadata measurements. Server tests verify one bounded `git check-ignore` batch per requested directory and two ripgrep processes for a filtered search; those are code-path bounds, not runtime measurements. No same-machine pre-change performance baseline was recorded. Remote Nodes, other platforms, native menus and dialogs, a light desktop appearance, and a full connected restart/recovery flow were not exercised in this phase session. Earlier phase evidence is retained in the dated completion notes of [phases 01–05](./editor-delivery-2026-10-08.md); those checks are not counted as rerun here.

## Package checks

The host-permission Editor suite passed 194 tests with one skip. Node app passed 273. Node core passed 1,636; plugin API passed 14; TUI passed 684 with two skips. Desktop staging and build passed; its built JS suite passed 182, boot 10, and Rust 65 after refreshing its activation golden. Architecture passed 87. Lint passed 37 tasks. The client-core suite passed 2,468 and failed its workspace-route classification and CSS token-ratchet tests. Those two failures were reproduced earlier on untouched parent `bf1143d08`; this phase also observed them in its own branch. This does not establish the state of current main.

The Editor server tests cover bundled ripgrep glob precedence, option-like queries and paths, UTF-16 columns, limits, symlink escape, invalid inputs, abort, timeout, and process termination. Client tests cover retained task state, stale requests, ignored visibility, and collapse/reveal. The unfiltered `pnpm test` gate is assigned to the coordinator after integration and was not run in this worktree.
