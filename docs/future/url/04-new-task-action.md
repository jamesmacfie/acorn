# Phase 04: new task action

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: phase 02.
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
