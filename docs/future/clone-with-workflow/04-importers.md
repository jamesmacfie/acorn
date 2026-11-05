# Phase 4: the importers clone through core

Date: November 6, 2026. Status: landed, except the checkpoint. Depends on phase 1.

## Completion note

November 6, 2026. The GitHub, GitLab, and Bitbucket importers no longer run `git clone` themselves.
Each hands its clone to phase 1's service, and its screen follows the run. [Clone a Git
URL](../../workspaces-and-tasks/clone-runs.md#importer-clones) owns the contract.
[GitHub integration](../../github-integration.md#importing-projects), [Projects and
workspaces](../../workspaces-and-tasks/projects.md#add-a-project), and the GitLab and Bitbucket
integration pages point at it.

What landed:

- The three import routes keep their mirror lookup, their path grammar check, and the placeholder
  lookup, then call `core.projects.clone` with the URL, `parentDir`, the folder name, and
  `fillProjectId`. GitHub passes `fields: { githubRepoId }` and GitLab passes
  `fields: { repositoryExternalId }`. A **Clone** item answers `{ ok: true, action: 'clone', cloneId }`.
  A **Link folder** item is unchanged. The parent folder check and `gitOrThrow` left the plugins, so
  no plugin calls `gitOrThrow(['clone'` any more. The routes now take `Pick<CoreServices, 'projects'>`.
- `cloneId?: string` on `GithubImportResult`, `GitlabImportResult`, and `BitbucketImportResult`.
- Each screen follows a clone with `cloneOutcome` from `@acorn/protocol/api.ts`, against the Node it
  was started on. The row's description says **Cloning…** or **Cloned**, and a failure shows as the
  row's error. **Clone** is disabled on a row while it clones, and other rows stay usable, so several
  clones run at once. A finished clone invalidates the lists and calls `onImported([projectId])`.
  Closing the importer aborts the reads, and the clones carry on.
- `apps/node/test/integration/plugins/importerClones.test.ts` mounts the three real routes on real
  core services. Git's `insteadOf`, passed through the `GIT_*` allowlist, sends each `https` address to
  a local bare repository. For each provider it fills a placeholder and checks the provider and ID on
  the row, then clones again and checks that the second checkout gets its own row.
- GitLab and Bitbucket gained a `./testkit` entry point for that test, and GitHub's testkit exports
  `githubImport`.

Decisions and deviations:

- **The integration test is its own file**, not part of `codeHosts.test.ts`. That file boots a loaded
  fixture plugin. This one mounts the built-in routes, and it has to add `file` to `CLONE_PROTOCOLS`
  with a module mock, which shouldn't leak into the code host tests.
- **The test checks the provider ID only on the filled placeholder.** `git remote get-url` applies
  `insteadOf`, so a row the clone creates sees the local `file://` remote and gets no repository. In
  production it sees the real `https` remote. Neither phase 1's tests nor this one check `fields` on a
  created row against a real remote.
- **A created row takes the folder's name.** GitLab and Bitbucket used to name it after the
  repository's display name, such as "API Gateway" rather than `api-gateway`. `ProjectCloneInput` has
  one `name` for both. Adding a second one would change the published plugin surface, and a project
  can be renamed.
- **Bitbucket passes no `fields`.** It never wrote an external ID, and this phase doesn't add one.
- **No `allowHttp`.** Phase 1 found that GitLab connections accept only `https` server addresses.
- **No shared client helper.** Following a run is one `cloneOutcome` call, and the three screens were
  already deliberate copies of each other. A shared hook's home would be `@acorn/plugin-api/client`,
  which loads at desktop startup, and phase 3 measured 2,514 bytes for moving clone code there. On the
  Node side, the shared part is the single `core.projects.clone` call.
- **One request at a time is kept.** Each request still asks for a folder first. It now answers in
  milliseconds, so it no longer blocks other rows while git runs.
- **A refused folder now reads as core words it**, such as "/x doesn't exist on this Node.", not the
  route's old "That folder doesn't exist on this Node."

Verify before building: phase 1 answered it. GitLab connections can't have an `http://` origin
(`gitlabOrigin` in `plugins/gitlab/src/server/serverAddress.ts`), so there's no `allowHttp`.

Bundle sizes:

- The Node service's boot graph is 1,948,293 bytes, 137 bytes under the 1,948,430 that phase 3
  recorded. It's still 1,293 bytes over the 1,947,000-byte ceiling.
- Client startup bundles weren't measured. The three importer screens load lazily
  (`lazy(() => import('./GithubImporter'))` and its peers), the plugins' client entry points didn't
  change, and the only new import is `@acorn/protocol/api.ts`, which startup already loads.

For later phases:

- Phase 5 doesn't touch the importers. An importer clone stays trusted and starts no workflow.
- The integration test's `insteadOf` setup is a pattern for phase 5's end-to-end check, with the same
  `get-url` limit.

## What's left

- **Checkpoint, skipped.** It needs `pnpm dev:agent`, which stops while the Node build is over its boot
  budget. Once the ceiling is raised, import three GitHub repositories at once from the desktop, one of
  them a few hundred megabytes. Confirm that all three finish and each row shows its state while they
  run. Record the date here.

## Risks still open

- **Two clones of one repository can race for one placeholder.** The placeholder is filled when a
  clone finishes, not when it starts. If two clones of the same repository start before either
  finishes, both target the same placeholder. The second one moves the row to its folder, and the
  first folder is left without a row. The screen disables **Clone** on a row while it clones, which
  covers the usual way this happens.
- **A row can briefly show Cloning… after the project exists.** The screen learns the outcome on its
  next `GET`. That gap is at most the 20-second wait, and normally under a second.
