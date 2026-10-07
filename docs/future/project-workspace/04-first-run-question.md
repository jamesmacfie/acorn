# Phase 04: first-run question

## Completion note — October 7, 2026

Status: implemented on `phase-04-first-run-question`.

Review follow-up, October 7, 2026:

- Finish validates that the wizard still belongs to the active Node when the `onboarded` preference
  save succeeds. Its callback then closes the overlay and opens the first added project together.
  Closing unmounts the wizard, so a lifetime check after the callback suppressed navigation.
- A component test mounts the wizard inside a real Solid `Show`, unmounts it from `onClose`, and
  confirms Finish opens the first project's path. Separate checks cover Skip, a failed completion
  save, and a pending save followed by a Node switch or external disposal.
- The onboarding suite and touched TypeScript checks passed for this follow-up. The full repository
  gate remains for after all phases.

- The welcome step offers separate projects (the default) or grouped workspaces only when
  `core.workspaces` is unset. It waits for the Node to accept the preference before entering the add
  step, keeps a failed save visible for retry, and shows the fixed answer on return to Welcome.
- In separate mode, naming changes project names without a workspace picker, creation control, or
  workspace membership patch. Grouped naming retains its picker and workspace creation path.
- Skip before an answer still writes only `onboarded`. The overlay continues to publish its own
  visibility to the core empty screen and clears it on disposal or connection loss.
- The native folder action is offered only for the local Node. Async folder, preference, and naming
  completions are ignored after Node switches or disposal.
- The onboarding suite passed (26 tests), plugin API suite passed (14), architecture checks passed
  (87), the focused Node route suite passed (nine), touched TypeScript checks and oxlint passed,
  and the stock Node service measured 3,149,642 B against its 3,150,000 B ceiling.
- Isolated `--onboarding --vite` desktop sessions for both choices reached the add step after the
  preference write. Back showed the fixed answer without a selector. Screenshots were inspected,
  and both sessions were stopped. The driver cannot operate native folder dialogs, so a Node route
  integration test creates two folders after each saved answer and checks whether their workspace
  IDs are distinct or shared. The first sandboxed launch failed on loopback `EPERM`; the narrow
  unsandboxed rerun worked. One grouped screenshot was black during Vite startup, then a later
  screenshot showed the expected saved-answer screen.
- The full repository gate is reserved for after phase 06. Node backup timeouts, the client-core
  route and CSS ratchets, and desktop plugin-disable assertions remain unclassified there.
- Later phases should read the fixed Node preference through the protocol mode contract. The
  terminal client still needs its own setup question in phase 06.

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
