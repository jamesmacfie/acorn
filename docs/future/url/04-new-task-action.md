# Phase 04: new task action

## Follow-up completion note, October 8, 2026

The new-task dispatcher now checks both the selected Node and the exact registered desktop host
after each awaited project, existing-task, and item read. A request abandoned by a Node switch or
host remount returns a refusal without navigating, opening a dialog, or reporting into the newly
selected Node. Serial native delivery and navigation addresses are unchanged. A deferred-read test
covers all three boundaries, including a replacement host registered for the same Node.

GitHub promotion prepares from the full PR detail returned by `fromContentLink`, including its body.
It no longer creates a query client or fetches that PR again on modal mount and submit. The direct
PR action still uses its owning query client; both paths use the same Linear connection selection
and reference-link construction. The modal path reads integration and project mapping metadata
without a cache, so it may read that metadata again on confirmation. Those reads are read-only;
task creation remains behind the button. The desktop waits for both task and workspace queries
before mounting the keyed dialog, so initial branch and attachment choices include cold-query data.

Verification: focused address dispatch (11 tests), promotion modal (11, including async title and
branch prefill and the retained cancel/no-write test), actual GitHub promotion (11, including the
existing-task short circuit and seeded Linear reference), and desktop address-host readiness (2)
passed. Client-core, GitHub, and desktop scoped TypeScript lint, targeted oxlint, all 87 architecture
checks, and `git diff --check` passed. No full package or repository gates or release bundle were
run in this follow-up. The prior isolated desktop check and its live-PR limitation remain as noted
below; this follow-up did not repeat that UI session. If task or workspace queries fail without
cached data, the promotion dialog waits for those lists instead of guessing attachment/branch
choices; the existing query error handling remains responsible for recovery. Later phases need no
new contract beyond the link methods and settings destination noted below.

## Completion note, October 8, 2026

`new-task?url=` uses the content-link registry's claim and project path, then finds a source by its
provider ID. It waits for the selected Node's projects before resolving that path. A source's
`existingTask` checks the claim before loading PR details; an active task opens directly and enters
the client cache if the task list has not loaded. Otherwise
the source's `fromContentLink` loads the item, the desktop opens the project through its explicit
route and source path, and `PromoteToTaskModal` mounts only after the target project is in router
params. Source IDs, which the modal uses to retrieve a promotion, remain distinct from provider IDs.
An unrecognised URL, an untracked repository, and a source without link promotion have separate
refusals. **Add project** opens the Projects section of the Workspaces settings page.

GitHub fetches a pull's title and head branch through its promotion. The modal and the PR list
share Linear reference seeding from the pull body; the modal reads those details during preparation
and writes only after confirmation. GitHub still cannot attach a pull to another task because its
identity lives in the task's `pullNumber`, rather than in a task link. The optional link methods add
no requirement for other sources, and this phase adds no terminal dispatch behavior.

Verification: focused address dispatch (10 tests), promotion modal (10), GitHub promotion (9),
desktop address-host readiness (2), and GitHub's full package suite (272) passed. Client-core,
desktop, and GitHub scoped TypeScript lint and targeted oxlint passed. The architecture suite passed
all 87 checks after desktop staging generated Tauri schemas. The client-core package suite passed
2,522 tests and retained the known route-scope and CSS-shadow failures; an additional icon-census
timeout under concurrent native compilation passed on a focused rerun. The desktop package suite
passed 155 tests and retained 11 known stale plugin-disable snapshots. Its other 19 failures were
sandbox loopback or process-inspection errors; the four affected files passed all 22 tests on a
narrow host-permission rerun.

An isolated desktop session refused an unrecognised URL and showed the untracked GitHub PR notice
with **Add project** in its rendered snapshot. Its screenshot missed the transient toast, and the
WebDriver click expired before reaching that action; the focused dispatcher test verifies the action
target. The session had no connected GitHub repository, so the PR dialog and active-task paths were
verified in focused tests rather than a live PR. The session was stopped. Installed release-bundle
delivery remains with the coordinator after phase 02's host Rust build failures. Phase 06 should
document the `workspaces#projects` destination and the source promotion link methods; phase 05 can
continue to refuse action links in the terminal.

Date: October 8, 2026. Status: implemented. Dependencies: phase 02.
Read the [plan](./README.md), especially [the safety rules](./README.md#safety-rules).

## Deliverable

`acorn://<node>/new-task?url=<outside URL>` opens the promote dialog for the item that URL names. You
confirm, and Acorn creates or attaches the task. If the item already has an active task, the link
opens that task with no dialog.

## Steps

1. Resolve the URL with the content-link recognisers, the same way `open` does. The claim names a
   provider, an item, and a project.
2. Find the source whose `promotion` contract handles that provider. GitHub's is `githubPullPromotion`
   in `plugins/github/src/client/pullTasks.ts`. No plugin needs a new contribution.
3. Ask the promotion for an existing active task. If there is one, open it and stop. That is
   navigation, so it needs no confirmation.
4. Otherwise navigate to the project and open `PromoteToTaskModal` from
   `packages/client-core/src/features/integrations/PromoteToTaskModal.tsx` with the item. The modal is
   the confirmation. Nothing is created until the person presses its button.
5. Handle the three ways it can't proceed, each with its own notice:
   - No recogniser claims the URL.
   - A recogniser claims it, but the repository isn't a project in Acorn. Offer **Add project**, which
     opens the projects settings page.
   - The provider has no `promotion`.

## Acceptance

- A GitHub PR URL for a tracked repository opens the dialog with the PR's branch and title filled in.
- The same URL for a PR that already has an active task opens that task.
- A PR URL for an untracked repository shows the **Add project** notice. An unrecognised URL shows its
  own notice.
- Opening the link and closing the dialog creates nothing.
- The case-insensitive owner and name match in the GitHub recogniser holds for links built from a
  differently cased URL.
- Plugin, `client-core`, and desktop suites pass, plus `pnpm lint`.

## Verify before building

- How `PromoteToTaskModal` reads the project. It calls `useParams`, so it may need the navigation in
  step 4 to finish first.
- Whether the full PR path in `promotePullToTask`, which seeds Linear links, can serve the link
  instead of the thinner `githubPullPromotion`.
- Which other sources contribute a `promotion`, and whether their items have URLs a recogniser claims.
