# Phase 06: terminal client

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: [phase 01](./01-node-switch.md),
[phase 04](./04-first-run-question.md), and [phase 05](./05-wording.md).
Read the [plan](./README.md) first, especially [decisions](./README.md#decisions) 2, 6, and 7.

## Deliverable

The terminal client matches the desktop. Its setup asks the grouping question, its topbar says
"project" while workspaces are off, and a Node with no projects opens setup.

## Steps

1. In `apps/tui/src/chrome/Setup.tsx`, replace the first `workspace` step:
   - When the preference is unset, ask the same question as the desktop wizard, with the same two
     choices and the same default, and write the preference.
   - While off, skip the workspace step and create the project with no workspace.
   - While on, keep the workspace step as it is.
2. Change the default first step in `apps/tui/src/chrome/Shell.tsx:98`, which starts setup at
   `workspace`, so it follows step 1.
3. Use the phase 05 helper for every user-facing string in `apps/tui/src/chrome/`. That includes the
   topbar (`Topbar.tsx`), the shell model's labels (`model.ts`), the palette, and the workspace chooser.
4. With zero projects, open setup at its first step, the terminal equivalent of the phase 03 screen.
   Check what happens today first.
5. Update `docs/tui/chrome.md`, and the terminal client section of `docs/ui-design/shell-hierarchy.md`
   if the topbar line changes.

## Acceptance

- `pnpm dev:tui:agent -- --session pw-tui-off --workspaces off`: a snapshot of the topbar says
  "project", and setup has no workspace step.
- `pnpm dev:tui:agent -- --session pw-tui-on --workspaces on`: setup and the topbar read as they do
  today.
- A session whose Node has no projects opens setup.
- The terminal client's tests and goldens pass. Update goldens only for intended wording changes.
- `pnpm lint` and the terminal client's suite pass.

## Verify before building

- Whether the terminal client's worker tests need the patched Node runtime on `PATH`.
- What the terminal client shows today when the Node has no projects.
- Whether `chosenWorkspace` in `apps/tui/src/chrome/state.ts` and its restore need any change. One
  project per workspace should make them work unchanged.
