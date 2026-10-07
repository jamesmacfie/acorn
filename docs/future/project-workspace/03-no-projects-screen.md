# Phase 03: no-projects screen

## Completion note — October 7, 2026

Status: implemented on `phase-03-no-projects-screen`.

- The desktop now replaces its rail and source body with a core **Add a project** screen after a
  successful empty projects read, while keeping the topbar, Settings, and overlay host mounted. A
  pending or failed read does not trigger it. The onboarding plugin publishes only its visible state
  through a core-owned seam, which clears on unmount and connection loss. Node changes reset its
  wizard latch.
- Settings Overview and the empty screen share folder, absolute-path, and importer controls. Both
  omit `workspaceId`, leaving off-mode pairing and grouped Default selection to the Node. Local
  folder picks are checked against the active Node. Remote Nodes use an absolute path on the Node;
  every importer stays listed, while GitHub refuses its picker action for a remote Node. Import
  completion uses reported project IDs against the refreshed list and opens one actual result on
  the default source. The app owns the navigation callback across an empty-to-nonempty query
  transition. It discards late completions after a Node switch, unrelated navigation, Settings
  opening, or app disposal.
- Focused client-core tests for the gate, shared controls, and Settings passed (seven tests);
  onboarding tests passed (16), scoped TypeScript checks for client-core, desktop, and onboarding
  passed, changed-source oxlint passed, and architecture checks passed (87). The stock service build
  stayed within its size limit during desktop staging. The focused desktop plugin-disable suite
  still reports 11 contribution-list expectation failures; this phase did not establish their
  baseline or change those lists. The follow-up passed six real-query add lifecycle tests, two gate
  tests, two Settings consumer tests, TypeScript checks for client-core, desktop, plugin-api, and
  GitHub, changed-source oxlint, and the 87 architecture checks. The full repository gate remains
  for the coordinator after all phases.
- Isolated `--vite` desktop sessions in both modes showed the prompt after deleting the seeded last
  project and closing onboarding. Screenshots were inspected and sessions stopped. A third launch
  with the onboarding contribution temporarily omitted showed the prompt directly; the temporary
  roster edit was restored. In a further isolated `--vite` session, a temporary client capability
  fixture exposed the absolute-path form on the local test Node. Submitting a disposable directory
  through that form created a project and navigated to its returned project URL; the fixture was
  restored. The driver cannot operate a native folder dialog. Real TanStack query tests exercise
  folder and importer completion after refetch or event cache updates unmount the empty screen,
  and late completions after Node switches or unrelated navigation.
- Later phases should keep the visibility signal owned by core, use the shared add controls when
  offering project creation, and preserve the undefined loading state of `createWorkspacesMode`.

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: [phase 01](./01-node-switch.md).
Read the [plan](./README.md) first, especially [decision](./README.md#decisions) 6.

## Deliverable

When the active Node has no projects and the first-run wizard isn't open, the desktop shows a
full-screen prompt to add a project. It works in both modes. Adding a project from it lands you on
that project.

## Steps

1. Add `NoProjects.tsx` in `packages/client-core/src/features/workspaces/`. Give it:
   - A level 1 heading and one line that says what a project is: a folder on this Node's machine.
   - **Add folder…** when `canPickFolder()` from `packages/client-core/src/infra/platform` is true.
   - One action for each entry in `projectImporterContributions()`, such as GitHub.
2. Reuse the add controls from `WorkspaceProjectAssignments.tsx` rather than writing new ones. If they
   can't be reused as they are, extract the shared part into one component both places use.
3. Pass no workspace when adding. The Node's rule from phase 01 puts the project in its own workspace
   while off, or in Default while on.
4. After a project is added, navigate to `projectPath(id)` with the default source selected, as
   `pickProject` does in `apps/desktop/src/client/App.tsx:498`.
5. In `App.tsx`, render `NoProjects` in place of the shell body when the projects query has loaded
   with an empty list and the onboarding overlay isn't open. Keep the topbar, so Node switching and
   Settings stay reachable.
6. Read the onboarding overlay's open state through a seam the plugin already exposes, or add one.
   Don't import the plugin from core. See [verify before building](#verify-before-building).
7. Update `docs/workspaces-and-tasks/projects.md` § Add a project, and the shell description in
   `docs/ui-design/shell-hierarchy.md`.

## Acceptance

- A jsdom test covers the gate: the screen shows with zero projects and the wizard closed, and hides
  while the projects query loads, while the wizard is open, and once a project exists.
- In `pnpm dev:agent -- --session pw-empty --workspaces off`, delete the seeded project. The screen
  appears. Add a folder, and you land on the new project.
- Repeat with `--workspaces on`. The new project lands in Default.
- With the onboarding plugin turned off, a Node with no projects shows the screen.
- `pnpm lint`, `pnpm test --filter=@acorn/client-core`, and `pnpm --filter @acorn/desktop test` pass.

## Verify before building

- What the desktop shows today with zero projects after onboarding, so you know what you're
  replacing.
- How core can tell that the onboarding overlay is open without importing the plugin. Look at how
  the overlay is mounted from `plugins/onboarding/src/client/OnboardingOverlay.tsx`.
- Whether the screen needs a path field for a remote Node with no folder picker, as the terminal
  setup asks for an absolute path (`apps/tui/src/chrome/Setup.tsx`).
