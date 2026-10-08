> Completion note, October 9, 2026: Implemented on `phase-1-plugin-and-worktrees`.
>
> Follow-up correction, October 9: Worktree rows now select by a stable SHA-256 identity of the
> canonical repository and checkout paths; cleanup still accepts only the mutable observation
> token. Source and task pane selections survive HEAD/status refresh, and clear when their entry
> or Node/project scope leaves. Both regions subscribe for their lifetime to selected-Node
> reconnect, worktree status, and local or forwarded Node task changes. Inventory read failures
> retain cached rows with a stale alert, while the first read shows loading and then an error.
> The task pane marks its own checkout and labels a selected different row “Other worktree.”
> Prune uses `--expire=now` after checking all affected registrations and verifies the selected
> registration is absent before reporting success.
>
> Follow-up checks: real Git fixtures 7/7, including fresh missing prune and stale observation
> refusal after HEAD moves; Solid pane model tests 2/2 for stable selection, Node switch, event
> invalidation, and subscription disposal; cache refresh test 1/1; plugin, Node, desktop, and
> terminal type checks passed; architecture boundary, doc path, and source field checks 60/60;
> terminal build/startup check passed at 729,573/730,000 B. Desktop `git-phase01-nav` reused the
> generated `tui-navigation` fixture: selected `fixture/terminal-failure`, committed its README
> edit as `a2968de`, refreshed, and observed the same selected URL with the new HEAD. Its task
> Git pane showed the main checkout badge and a separate “Other worktree” detail; inspected
> screenshot: `.acorn/agent-dev/git-phase01-nav/screenshots/phase01-other-worktree.png`.
> Terminal `git-phase01-tui` reused that fixture data at 80×24, with the checkout advanced by an
> empty fixture commit `51c8913`; refresh kept its selected detail and showed the new HEAD.
> At 80×24 the task Git pane's list marked `main` as the task checkout and its detail labelled
> `terminal-failure` “Other worktree.” Both isolated sessions were stopped. Reproduce by starting
> the desktop fixture with `--session git-phase01-nav --reuse --fixture tui-navigation --workspaces on`,
> then the terminal session with `--session git-phase01-tui --reuse --no-build --data-dir
> <desktop-session>/data --cols 80 --rows 24`; advance only the disposable linked checkout and
> use each host's Refresh action. The unchanged `docCitations.test.ts` 201-line failure and local
> dependency-link/test:focus prerequisites described below still apply.
>
> The compiled Git plugin is registered in Node, desktop, and terminal. Its project-scoped source
> lists Git's NUL-delimited worktree roster, bounded status and commit summaries, missing and locked
> registrations, and Acorn task owners. The task pane shows the recorded branch and checkout identity.
> Paired-device cleanup accepts an observation hash, rechecks the roster and owners under a
> repository-local guard, and refuses main, locked, dirty, unreadable, or owned worktrees. Prune
> checks every affected registration. The external worktree manager remains installed for phase 04.
>
> Project-folder tasks own their mapped checkout, and aliased project paths resolve to one canonical
> repository identity. The terminal host now installs the shared project lookup so the Git task pane
> appears for Git projects. The source and pane use the public plugin seams; core retains task archive.
> A cleanup response updates the cache only while its original Node and project remain selected;
> changing the selected worktree also leaves that detail's navigation and feedback alone.
> The terminal startup ceiling is 730,000 B after a measured 729,573 B build. Git modules remain
> outside the startup closure. The Node service ceiling is 3,187,000 B after a measured 3,185,838 B
> build, with the Git route loaded during plugin initialization. Architecture checks treat the word
> `git` as core VCS vocabulary but still reject explicit Git plugin package, route, and source ids
> in core packages.
>
> Checks on October 9: real Git fixture tests 5/5; architecture boundaries, doc paths, and source
> fields 60/60; terminal startup, source switching, and source filtering 13/13; plugin, Node, desktop,
> and terminal package type checks passed; oxlint on touched source passed; desktop staging and
> terminal production builds passed. Desktop acceptance used isolated sessions `git-phase01e` and
> `git-phase01-nav`: it showed worktree and task detail, opened the task and repository source,
> removed a clean unowned fixture worktree, and hid Git after switching to a non-Git project. The
> final inspected screenshot is `.acorn/agent-dev/git-phase01-nav/screenshots/git-worktrees-final.png`.
> Terminal acceptance used `git-phase01-tui` with the generated `tui-navigation` desktop fixture
> data: workspace switching, Git source and task pane navigation, keyboard row selection, clean
> worktree removal, and a visible refusal after an external edit to a second fixture worktree.
> Reproduce with `--fixture tui-navigation --workspaces on` in `dev:agent`, then start
> `apps/tui/scripts/agent/session.mjs --data-dir <desktop-session>/data --cols 120 --rows 40`;
> add a clean linked checkout under the fixture directory with `git worktree add`.
>
> Environment and unrelated checks: frozen offline install lacked the cached `drizzle-kit` tarball,
> and online install could not resolve the registry. Local dependency links were repaired from the
> parent checkout for verification. `pnpm test:focus` attempted to chmod the parent checkout's
> `node-pty` helper and failed with `EPERM`; direct focused Vitest passed without rebuilding it.
> `tools/arch/docCitations.test.ts` still fails because `docs/api-reference/plugin-routes.md` has
> 201 lines at both this branch and `HEAD`, above its 200-line limit. That file was not changed here.
> Later phases can reuse the Git plugin's typed inventory and guarded cleanup contract; they should
> keep task archive in core and preserve the external manager through phase 04 acceptance.

# Phase 01: plugin and worktrees

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: none.
Read the [full implementation context](./README.md), especially
[source ownership](./README.md#source-baseline-and-ownership),
[the two surfaces](./README.md#two-surfaces), and
[mutation contracts](./README.md#mutation-contracts). It owns the decisions for this phase.

## Deliverable

A person opens **Git > Worktrees** for the selected project, inspects a registered worktree and its
task ownership, opens its task, and safely removes an eligible unowned worktree. A separate Git task
pane shows that task's checkout identity and links to the repository source. Both hosts support it.

## Steps

1. Recheck the baseline and external worktree plugin. Record differences in roster, ownership,
   status reads, path normalization, archive behavior, and cleanup policy before adapting code.
2. Create the compiled `git` plugin package, thin Node/client entrypoints, shared typed wire
   contracts, and focused repository/worktree modules. Register it in Node, desktop, and terminal
   rosters and app dependencies through the public plugin API. Keep the external plugin installed
   until phase 04 acceptance.
3. Register the project-scoped Git source with host list/detail regions and routes. Register a
   task Git pane with a host-owned model/layout. Use the kit for navigation and item lists. Hide or
   explain the source on non-Git projects without changing other source selection.
4. Resolve mapped project roots on the Node and read the NUL-delimited Git worktree roster. Return
   branch/HEAD, main/locked/prunable state, last commit, bounded changed-file summaries, task
   ownership, errors, and observation identity. Canonicalize path identity and deduplicate aliased
   projects; preserve missing registrations as readable rows.
5. Implement paired-device cleanup with a fresh roster and ownership check. Offer archive/open
   navigation for task-owned worktrees. Refuse main, locked, dirty, or newly owned worktrees. Check
   every affected record before repository-wide prune; report Git refusal without treating it as
   a successful removal.
6. Add Node-qualified query keys, explicit refresh, reconnect/event invalidation, and cancellation
   on route or Node changes. Render empty, stale, truncated, missing-checkout, and failure states.
7. Update roster/route/facade goldens only where the contribution changes their expected surface.
   Add the owning feature documentation when this slice ships.

## Acceptance

- Real repository tests cover main, branchless/detached, locked, missing, dirty, and clean worktrees;
  task ownership; two project aliases; unusual path characters; and ownership changing after read.
- A paired device can clean up an eligible worktree. Task credentials and arbitrary paths are
  refused. Cleanup cannot remove task-owned or main checkout data.
- Desktop and terminal demonstrate project switching, navigation, task opening, failure feedback,
  keyboard menus, and cleanup in a disposable fixture.
- Run the [verification gates](./README.md#verification-strategy) for the plugin, its three app
  consumers, public API changes, and architecture. Record dated results before phase 02.

## Verify before building

- Recheck source/pane registration shapes and the terminal UI facade against the chosen baseline.
- Confirm cleanup and archive semantics with core rather than importing its private worktree code.
- Confirm Node runtime and task setup readiness before running fixture-dependent tests.
