# Phase 1: clone a Git URL in the background

Date: November 6, 2026. Status: landed, except the checkpoint. Depends on nothing.

## Completion note

November 6, 2026. The Node can clone an HTTPS, SSH, or `user@host:path` URL into a folder in the
background and add it as a project. [Clone a Git URL](../../workspaces-and-tasks/clone-runs.md) now
owns the contract: the URL checks, the routes, the hidden folder and rename, the queue, and the plugin
facet. The CLI command is in [Workspaces, projects, and tasks](../../cli/workspaces-projects-tasks.md).

What landed:

- `packages/node-core/src/server/projects/clone.ts`: `checkCloneUrl`, `startCloneRun`,
  `cloneRunState`, and `stopCloneRuns`, with tests that clone a local bare repository through the
  test-only `file` protocol.
- `POST /v1/core/projects/clone-runs` and `GET /v1/core/projects/clone-runs/:id?waitMs=`, both behind
  `requireDevice`. Task and service tokens get 403.
- `core.projects.clone(input)` and `core.projects.cloneRun(id, waitMs)`, in `PROJECT_WRITES`, the call
  modes, the published types (`ProjectCloneInput`, `ProjectCloneRun`, `ProjectCloneResult`), and the
  surface snapshot. A loaded plugin's call passes its ID as the holder, as `update` does. The
  `projects:write` trust line now says it can clone.
- `acorn project clone URL --into ABSOLUTE [--name FOLDER] [--workspace ID] [--request-id UUID]`. A
  failed clone exits 4 with `clone_failed`.
- The Node's shutdown drain stops running and queued clones (`CompiledProjectService.stopClones`),
  because git runs in its own process group and would outlive the Node.

Decisions and deviations:

- **No `trusted` field yet.** Nothing can store it until phase 2 adds the column, so phase 2 adds
  `trusted` to `ProjectCloneInput` and has the route pass `false`.
- **No `allowHttp`.** GitLab connections accept only `https` server addresses (`gitlabOrigin` in
  `plugins/gitlab/src/server/serverAddress.ts`), which settles phase 4's open question.
- **`fields` follow the row, not inside one write.** The run creates or fills the row, then writes
  `fields` through `updateProjectRef`, so the holder check isn't copied. Both happen before the run
  reports finished. A client that refetches in that moment can see the row without its provider ID
  for one invalidation, which is what today's importers already do.
- **A failure after the rename keeps the folder.** If the project can't be added, the error names the
  folder and says to add it or delete it. Deleting a real-named folder a row may already point at
  isn't worth the tidiness.
- **Protocol types go through `@acorn/protocol/api.ts`.** The protocol package is capped at 99 entry
  points and had 99, so the types and `cloneOutcome(wait)` live in
  `packages/protocol/src/transport/api/cloneRuns.ts`. The helper has no legacy fallback, because no
  older route exists.
- **The docs got their own page.** `projects.md` would have passed 200 lines, so the contract is in
  `docs/workspaces-and-tasks/clone-runs.md`, with a pointer from **Add a project**.
- **`git clone --quiet`**, so git's "Cloning into <hidden folder>" line stays out of error messages.
- **The route golden list also gained the two `archive-run` routes**, which an earlier commit added
  without regenerating it.

Verify before building, answered:

- `GIT_ALLOW_PROTOCOL` in `opts.env` wins. `brokerEnv` in `packages/node-core/src/server/core/proc.ts`
  returns `{ ...allowlistAndPassthrough, ...spec.env }`, so a value in the Node's environment can't
  widen it.
- A folder rename within one parent never crosses a filesystem and works on macOS, Linux, and
  Windows. The one difference is renaming onto an existing empty folder. POSIX replaces it, and
  Windows refuses. The run removes the empty folder with `rmdir` first, which also fails if something
  filled it meanwhile.

For later phases:

- The Node service's boot graph is 1,946,429 bytes against a 1,947,000-byte ceiling, so about 570
  bytes are left. The clone service, routes, and facet load `clone.ts` on first use. Keep new code
  out of the boot graph the same way, or ask before raising the ceiling.
- A URL clone is an ordinary trusted project until phase 2 lands. Don't advertise `project clone` on
  the public site before then. Site pages that cite the changed docs weren't touched for that reason.
- Phases 3 to 5 should update `clone-runs.md`, not the **Add a project** section, for clone contracts.
- `cloneRunState` caps `waitMs` at `CLONE_RUN_WAIT_MS`, 20 seconds, for the route and the facet alike.

## What's left

- **Checkpoint, skipped.** Cloning a public repository of a few hundred megabytes from the CLI
  against a remote Node needs `pnpm dev:remote` and a paired CLI, which this run didn't set up. The
  tests run a real `git clone` end to end through the service. Run the checkpoint by hand and record
  the time here.

## Risks still open

- **A Node that dies mid-clone** loses the run, and its hidden folder stays on disk, named
  `.<name>.acorn-clone-<cloneId>`. A clean shutdown stops the clone and deletes it. A boot sweep would
  need the parent folders stored somewhere. Leave it until someone hits it.
- **No progress percentage.** The run reports elapsed time only. `runProcess` now has `onStderr`, so
  parsing `git clone --progress` is possible if elapsed time proves not enough.
- **No cancel.** The 30-minute timeout bounds a mistaken clone. Add `DELETE` on the run if people ask.
