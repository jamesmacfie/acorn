# Phase 4: the importers clone through core

Date: November 6, 2026. Status: proposed. Depends on phase 1.

## Goal

The GitHub, GitLab, and Bitbucket importers stop running `git clone` themselves. Each one hands its
clone to phase 1's service, so every clone gets the same URL checks, the hidden-folder cleanup, the
30-minute limit instead of 30 seconds, and progress a client can follow. Importer clones stay trusted.

## Starting point

Each route in `plugins/github/src/server/routes/repos/import.ts`,
`plugins/gitlab/src/server/routes/import.ts`, and `plugins/bitbucket/src/server/routes/import.ts`
takes up to 100 items. For each **Clone** item it:

1. Looks up the repository in the plugin's own mirror.
2. Checks the parent folder.
3. Runs `git clone` inside the request, with the 30-second default timeout.
4. Finds a placeholder project with no folder (`core.projects.byGithub` or `byRepository`), or creates
   a row.
5. Stamps the row with `path` and the provider's ID (`githubRepoId` or `repositoryExternalId`).

It answers with one result per item. The client screens are
`plugins/github/src/client/GithubImporter.tsx`, `plugins/gitlab/src/client/GitlabImporter.tsx`, and
`plugins/bitbucket/src/client/BitbucketImporter.tsx`. Each waits for the whole answer.

**Link folder** (`map`) items don't clone and stay as they are.

## Design

### The routes

For a **Clone** item, a route keeps steps 1 and 4, then calls `core.projects.clone` with:

- the URL it builds today,
- `parentDir` and the folder name it works out today, after its own path grammar check,
- `trusted: true`,
- `fillProjectId` when step 4 found a placeholder,
- `fields` with the provider's ID, so the row is linked when it first appears,
- `allowHttp` only in GitLab, and only when the connection's origin is `http://`.

The item's result becomes `{ ok: true, action: 'clone', cloneId }` instead of a project ID. A **Link
folder** item still answers with its project ID. The parent folder check and the `gitOrThrow` call
leave the plugins, and so does the GitHub route's missing `--`.

Phase 1's queue runs at most three clones at once, so an import of 100 repositories doesn't start 100
`git` processes.

The response shape changes, so the shared types in each plugin's `src/shared/api.ts` change with it.
These are first-party plugins that ship with their client, so no older client reads the new shape.

### The screens

Each screen follows its clone IDs with phase 1's client helper and marks each row **Cloning…**,
**Cloned**, or the error. When every run in the batch has finished, it calls
`onImported(projectIds)` with the IDs the runs reported. Closing the importer stops following, and the
clones carry on.

## Steps

1. Change the three routes and their shared types.
2. Change the three screens to follow clone runs.
3. Update their tests and `apps/node/test/integration/plugins/codeHosts.test.ts`.
4. Update [GitHub integration](../../github-integration.md) and
   [Projects and workspaces](../../workspaces-and-tasks/projects.md#add-a-project).

## Acceptance

- The integration test clones from a local bare repository through each importer's route, with the
  test-only `file` protocol, and checks the provider ID on the new row.
- A placeholder project is filled, not duplicated, for each of the three providers.
- No plugin under `plugins/` calls `gitOrThrow(['clone'` any more. A grep in review is enough.
- Checkpoint: import three GitHub repositories at once from the desktop, one of them a few hundred
  megabytes, and confirm all three finish and each row shows its state while they run.

## Risks

- **A row can briefly show Cloning… after the project exists.** The screen learns the outcome on its
  next `GET`. That gap is at most the 20-second wait, and normally under a second.
- **The plugin facet change touches the published plugin surface.** Update
  `tools/arch/publishedPluginSurface.snapshot.txt` in phase 1, not here.

## Verify before building

- Whether a GitLab connection can have a plain `http://` origin at all. If it can't, drop `allowHttp`
  from phase 1.
