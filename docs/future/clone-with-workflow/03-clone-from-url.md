# Phase 3: the Clone from URL form

Date: November 6, 2026. Status: proposed. Depends on phases 1 and 2.

## Goal

Wherever you can add a folder, you can also paste a Git URL. The form asks where to put it, clones it
through phase 1, shows how long it has been running, and opens the new project when it finishes. The
project arrives untrusted, and the form says so.

## Starting point

- `packages/client-core/src/features/workspaces/AddProjectControls.tsx` draws the add controls for
  both the empty Node screen and Settings → Overview. It shows **Add folder…** or a typed path field,
  then one button per project importer, and mounts the chosen importer in a section below.
- Importers are contributions to `projectImporterRegistry` in
  `packages/client-core/src/host/registries/sources/projectImporters.ts`. An importer gets `onClose`
  and `onImported(projectIds)`, and the host refreshes, selects the reported project, and drops the
  importer when the active Node changes. A `requires` field hides an importer when the Node lacks a
  host capability.
- `pickNodeFolder` in `packages/client-core/src/features/workspaces/addProject.ts` opens the native
  picker only for the local Node. Elsewhere the importers use a typed field. `NodePathForm` is the
  typed field, and the terminal client draws its own version in `apps/tui/src/kit/asking/nodePathForm.tsx`.
- The GitHub importer keeps the last folder typed for **Clone** in a signal and clears it when the
  active Node changes (`plugins/github/src/client/GithubImporter.tsx`).

## Design

### A core importer

Client-core registers its own project importer, `git-url`, labelled **Clone from URL**, with a Git
glyph. Being an importer means the form reuses the host's section, its close and Node-switch handling,
and its "open the project that was produced" step, with no new layout code in `AddProjectControls`.
Its `requires` names the clone-run host capability, so a Node without phase 1 doesn't offer it.

The component is `packages/client-core/src/features/workspaces/CloneFromUrl.tsx` (new).

### The form

1. **Git URL.** A text field. The client trims it and runs the same shape check as the Node, so an
   obvious mistake shows before a request. The Node still checks, and its message wins.
2. **Parent folder.** Asked every time. On the local Node with a picker, a **Choose folder…** button
   fills it. Otherwise a typed field, which starts with the last parent typed on this Node and clears
   when the active Node changes, the same rule as the GitHub importer.
3. **Folder name.** Filled from the URL's last segment, without `.git`, and editable.
4. **Clone.** Starts the run and follows it with the phase 1 client helper.

While it runs, the form shows "Cloning <name>… 1m 12s" and disables its fields. Closing the form or
changing Node stops following but doesn't stop the clone. The project appears in the list when the
Node finishes it.

On success the form calls `onImported([projectId])` and shows "Cloned <name>. It's untrusted until you
trust it in its settings." On failure it shows the Node's message in an `Alert` and keeps the fields,
so a retry is one press.

Phase 5 adds a workflow picker under the folder name. Leave room for it, but don't add a slot until
phase 5 needs one.

### Workspaces

With workspaces on, the run omits `workspaceId`, the same as a folder add from these screens, so the
Node files the project under Default. The project can move afterwards in Settings → Overview.

### The terminal client

`AddProjectControls` is shared, and the terminal client draws kit primitives through its own kit. Check
that the form's fields are keyboard stops inside the importer section in a 24-row panel, because extra
rows can push controls out of reach.

## Steps

1. Write `CloneFromUrl.tsx` (new) and register it as the `git-url` importer, gated on the host
   capability.
2. Show the untrusted state in the project list and in the project's header, using phase 2's field.
3. Add component tests beside `packages/client-core/src/features/workspaces/AddProjectControls.test.tsx`.
4. Update [Projects and workspaces](../../workspaces-and-tasks/projects.md#add-a-project).

## Acceptance

- Component tests: the folder name follows the URL until edited, an invalid URL disables **Clone**, a
  Node change clears the typed parent and stops following, and a finished run reports its project ID.
- The importer is hidden against a Node without the clone routes.
- Checkpoint: from the desktop against the local Node, clone a public repository through **Clone from
  URL**, and confirm the project opens and shows **Untrusted**. Repeat against `pnpm dev:remote` with
  a typed parent folder. Repeat in the terminal client.

## Risks

- **The first-run wizard** pairs an importer with a code host connection by `id`
  (`plugins/onboarding/src/client/OnboardingWizard.tsx`). An importer with no connection may not show
  there, or may show oddly. Check it, and decide whether the wizard offers **Clone from URL** too.
- **Elapsed time isn't progress.** A clone stuck on a slow network looks the same as a big one. Phase
  1's risks cover when to add real progress.

## Verify before building

- How the host advertises a capability for a core route, so `requires` can name it. Read
  `packages/client-core/src/infra/node/hostCapabilities.ts`.
- That registering an importer from client-core, rather than from a plugin, passes the boundary
  checks in `tools/arch/boundaries.test.ts`.
