# Phase 3: the Clone from URL form

Date: November 6, 2026. Status: landed, except the checkpoint. Depends on phases 1 and 2.

## Completion note

November 6, 2026. You can paste a Git URL wherever you can add a folder, and the Node clones it as an
untrusted project. [Clone a Git URL](../../workspaces-and-tasks/clone-runs.md#clone-from-url) owns the
form's contract. [Projects and workspaces](../../workspaces-and-tasks/projects.md) points at it from
**Add a project** and describes the **Untrusted** marks.

What landed:

- `CloneFromUrl.tsx`, core's own project importer `git-url`, labelled **Clone from URL** with the
  `folder-git-2` glyph. `AddProjectControls.tsx` registers it, so it sits beside **Add folder…** and
  the code host importers on the empty Node screen and in Settings → Overview.
- `cloneRun.ts` in client-core's workspaces feature: `createCloneRun()` starts a run, follows it with
  `cloneOutcome`, ticks the elapsed time, and stops following when its owner is disposed.
  `lastCloneParent(nodeId)` remembers the last parent folder for the Node it was typed on.
- The terminal client's setup screen has **Clone from URL…** on its project step, which opens a clone
  step built on the same `cloneRun.ts`.
- `checkCloneUrl`, `cloneFolderProblem`, and `CLONE_PROTOCOLS` moved from node-core's `clone.ts` to
  `@acorn/protocol/api.ts` (`transport/api/cloneRuns.ts`), with their tests, so the form and the Node
  run one check. `projectCloneRunsRoute` and `projectCloneRunRoute` sit beside them.
- An **Untrusted** badge on the project's row in Settings → Overview and in the header of the
  project's settings page.
- Component tests in `CloneFromUrl.test.tsx`, through the real importer registry and host. A
  terminal client test in `Setup.test.tsx` clones through the setup screen and reaches every control
  at 80 by 24.
- The site page `/docs/using/workspaces-and-projects/` gained a **Clone from URL** bullet and is
  marked checked.

Decisions and deviations:

- **No `requires`, so an older Node still shows the importer.** The host advertises no core routes.
  `hostCapabilities.ts` answers only desktop, plugin, loaded plugin, and seam questions, and
  [versioning](../../api-reference/versioning.md) says there's no feature handshake. Adding one for a
  90-day window wasn't worth it. A Node from before phase 1 answers **Clone** with 404, and the form
  says "This Node can't clone from a URL. Update it, then try again." That's a mixed-version path
  until February 4, 2027. The acceptance item "hidden against a Node without the clone routes" is not
  met as written.
- **The terminal client doesn't share `AddProjectControls`.** It has its own setup screen
  (`apps/tui/src/chrome/Setup.tsx`) with a typed folder field and no importers. The clone step went
  there. That screen passes the workspace it has chosen, as its folder add does. The desktop omits
  `workspaceId`, as the doc asked.
- **The parent folder is a typed field on every Node.** On the local Node, **Choose folder…** sits
  beside it and fills it, so the chosen path stays visible and editable.
- **The parent is remembered per Node, not cleared.** The host drops the importer when the Node
  changes, so the field clears. Reopening on another Node starts empty, and going back to the first
  Node offers its parent again. That matches the README's "remembers the last one typed for each Node".
- **Elapsed time is the client's own,** counted from the press, so it ticks every second. The Node's
  `elapsedMs` arrives only every 20 seconds.
- **The first-run wizard doesn't offer it.** The wizard offers an importer only when a code host
  provider has the same `id`, and `git-url` has none. The empty Node screen after the wizard does.
- **client-core's entrypoint cap went from 218 to 219** in `tools/arch/boundaries.test.ts`, for
  `./features/workspaces/cloneRun.ts`. Exporting it from the workspaces barrel instead put the clone
  module in the desktop's startup graph, 2,514 bytes, because the barrel loads at startup.
- **The frame route table names the clone run route** in `host/frames/scopes.ts`, mapped to no scope,
  because the Node takes only a device token there.

Verify before building, answered:

- The host has no capability for a core route. See the first deviation.
- Registering an importer from client-core passes `tools/arch/boundaries.test.ts`. The only change
  the arch tests needed was the entrypoint cap.

Bundle sizes, measured against a build of `ebfb2cc1a`:

- The Node service boot graph is unchanged at 1,948,430 bytes. It's still 1,430 bytes over the
  1,947,000-byte ceiling. Phase 2's note said 1,948,408. A build of `ebfb2cc1a` measures 1,948,430.
- The desktop renderer's startup scripts are 1,012,803 bytes, 131 over base and under the
  1,030,000-byte ceiling. The extra bytes are the route table entry and the two badges.
- The terminal client's startup closure is unchanged at 805,368 bytes.
- No stylesheet changed, so the phone's style budget is unchanged.

For later phases:

- Phase 5's workflow picker goes under **Folder name** in `CloneFromUrl.tsx` and in the terminal
  client's clone step. `CloneRequest` in `cloneRun.ts` is where its field joins the request.
- Phase 4's importers can use `createCloneRun` for their own progress line, and `checkCloneUrl` from
  the protocol.
- `pnpm dev:agent` builds the Node service, and that build fails the boot budget. A desktop walk needs
  the ceiling raised first.

## What's left

- **Checkpoint, skipped.** The desktop walk against the local Node and `pnpm dev:remote` didn't run,
  because `pnpm dev:agent` stops when the Node build fails its boot budget. The ceiling is the
  coordinator's to raise. The component tests drive the form through the real host with a fake Node.
  The terminal client test drives the setup screen at 80 by 24. Phase 1's tests run a real
  `git clone`. Once the ceiling is raised, clone a public repository through **Clone from URL** on
  the desktop, against `pnpm dev:remote` with a typed parent, and in the terminal client. Confirm the
  project opens and shows **Untrusted**, and record the date here.

## Risks still open

- **Elapsed time isn't progress.** A clone stuck on a slow network looks the same as a big one. Phase
  1's risks cover when to add real progress.
- **The site's terminal snapshots** (`hero-terminal`, `terminal-small`) cite `Setup.tsx`. They weren't
  recaptured. The setup screen's project step has one more button, which shows only if a snapshot
  captures that step.
