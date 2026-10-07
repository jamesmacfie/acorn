# Phase 06: terminal client

## Completion note — October 8, 2026

Status: implemented on `phase-06-terminal-client`.

- Terminal setup asks the grouping question only when `core.workspaces` is unset and the Node has no
  projects. It defaults to separate projects, waits for a successful preference write, and keeps
  errors visible for retry. Separate mode skips workspace selection and creates projects without a
  workspace ID. Grouped mode retains the workspace step.
- The shell opens setup after a successful empty projects read, including after the last project is
  deleted. Pending and failed reads do not count as empty. Setup saves, project creation, task
  creation, and expected close check the Node and component lifetime before changing navigation.
  Successful close navigation runs with the close callback so its own unmount cannot cancel it.
- Topbar, pickers, commands, keybinding descriptions, palette, and Settings use the active Node's
  wording. Settings reuses the shared presentation projection. Node switching remounts the terminal
  shell under that Node's query cache and clears the previous Node's transient selection and dialogs.
  Stable command IDs and preference keys remain unchanged. The paired project workspace needs no
  change to `chosenWorkspace` persistence.
- The focused setup and Settings tests passed (14). The terminal suite passed 67 files and 671 tests,
  with 12 skips; its boot file failed on sandbox loopback `EPERM`. The narrow unsandboxed boot rerun
  passed all 10 tests. TUI and client-core typechecks passed. Changed-source oxlint had one warning
  on an unchanged spread in `Shell.tsx`. The architecture suite passed 86 of 87 checks; its path
  check still reports three missing generated Tauri schema files cited by the security plan.
- Real isolated TUI sessions showed **Project: repo** in separate mode, **Default > repo** in grouped
  mode, and their respective project and workspace pickers and setup steps. An empty profile opened
  on the default **Keep each project separate** question. After accepting it, a disposable folder
  was added and the topbar showed **Project: pw-tui-added**. A second empty profile accepted
  **Group projects into workspaces** and advanced to **Choose a workspace**. The 80 by 24 and
  120 by 40 snapshots were inspected. All sessions were stopped. The stock Node build passed its
  size gate at 3,149,554 of 3,150,000 bytes; the TUI startup closure passed at 717,661 of
  720,000 bytes.

The coordinator should run the combined gate after generating the desktop's Tauri schema files.

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
