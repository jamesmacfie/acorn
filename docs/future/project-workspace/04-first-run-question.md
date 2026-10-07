# Phase 04: first-run question

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: [phase 02](./02-desktop-chrome.md).
Read the [plan](./README.md) first, especially [decisions](./README.md#decisions) 1 and 2.

## Deliverable

The first-run wizard asks whether you want to group projects into workspaces. Your answer sets the
mode before the first project exists. While off, the wizard doesn't ask which workspace a project
goes in.

## Steps

1. In `plugins/onboarding/src/client/OnboardingWizard.tsx`, add the question to the welcome step, or
   as its own step right after it. Offer two choices:
   - **Keep each project separate.** This is the default choice. Write `core.workspaces` as `off`.
   - **Group projects into workspaces.** Write `core.workspaces` as `on`.
2. Ask only when the preference is unset. The wizard can open again on a Node whose projects were all
   deleted before onboarding finished. If the preference is already set, skip the question, because
   the mode is fixed.
3. Write the preference when the person moves past the question, before the add-projects step. Use
   the same preference write the wizard uses for `onboarded`.
4. While off, the naming step shows only the name field for each project, with no workspace picker
   and no **New workspace…** option.
5. While on, the naming step stays as it is today.
6. If the person skips the wizard before answering, write nothing. Phase 01's fallback sets the mode
   when the first project is created.
7. Update the notes at the top of `plugins/onboarding/src/client/gate.ts` if the gate changes, and
   `docs/workspaces-and-tasks/projects.md` § The first-run wizard.

## Acceptance

- Wizard tests cover:
  - Each answer writing its value.
  - The question skipped when the preference is set.
  - The naming step with and without the workspace picker.
  - Skip writing nothing.
- `pnpm dev:agent -- --session pw-wiz-off --onboarding`: choose **Keep each project separate**, add
  two folders, and each one gets its own workspace.
- `pnpm dev:agent -- --session pw-wiz-on --onboarding`: choose **Group projects into workspaces**, add
  two folders, and both land in the workspaces you pick, as today.
- `pnpm lint` and the onboarding plugin's suite pass.

## Verify before building

- How the wizard writes preferences today, and whether that write completes before
  `createProject` runs in the next step.
- The known first-launch issue with fresh `--onboarding` sessions, where the wizard may not show
  until a reload. Rule it out before you blame the new step.
