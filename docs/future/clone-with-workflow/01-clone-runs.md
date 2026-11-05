# Phase 1: clone a Git URL in the background

Date: November 6, 2026. Status: proposed. Depends on nothing.

## Goal

The Node can clone any HTTPS or SSH Git URL into a folder on its own machine, and register the
result as a project. A client starts a clone in one request and reads its outcome in later ones, so
a slow clone never runs into the broker's 30-second deadline. Plugins reach the same service through
`CoreServices.projects`, and the CLI gets `acorn project clone`.

This phase has no UI. Phase 3 adds the form, and phase 4 moves the importers onto this service.

## Starting point

- Three importers clone today, each with its own copy of the code:
  `plugins/github/src/server/routes/repos/import.ts`, `plugins/gitlab/src/server/routes/import.ts`,
  and `plugins/bitbucket/src/server/routes/import.ts`. Each checks that the parent folder is absolute
  and exists, runs `core.git.gitOrThrow(['clone', ...])`, then calls `core.projects.create`.
- They clone inside the request and inherit `GIT_TIMEOUT_MS`, 30 seconds, from
  `packages/node-core/src/server/core/git.ts`. A repository that takes longer than that fails today.
- `git.ts` already sets `GIT_TERMINAL_PROMPT=0` and passes `SSH_AUTH_SOCK` through, so SSH clones use
  the Node machine's agent.
- [Archive in the background](../../workspaces-and-tasks/background-archive.md) is the pattern to copy:
  a `POST` that answers 202, a `GET ?waitMs=20000` that holds for up to 20 seconds, and an outcome
  kept in memory for 10 minutes. The routes are in `packages/node-core/src/server/routes/projects/worktree.ts`,
  and `archiveInBackground` in `packages/protocol/src/projects/task.ts` is the client side.
- The plugin project facet is `ProjectService` in `packages/node-core/src/server/core/projectRefs.ts`.
  Its write methods are listed in `PROJECT_WRITES` in `packages/node-core/src/server/plugins/permissions.ts`,
  and each method's call mode is in `packages/node-core/src/server/plugins/hostCallModes.ts`.

## Design

### The clone run

A new service, `packages/node-core/src/server/projects/clone.ts` (new), owns clone runs. A run takes:

| Field | Meaning |
| --- | --- |
| `url` | The Git URL, checked as described below |
| `parentDir` | An absolute folder that exists on the Node |
| `name` | Optional folder name. Defaults to the last path segment of the URL, without `.git` |
| `workspaceId` | Optional, with the same rules as `createProject` |
| `trusted` | Whether the new project starts trusted. Only the plugin facet can set it. Phase 2 stores it |
| `fillProjectId` | Optional. Give this existing path-less project the folder instead of creating a row. For the importers' placeholder rows |
| `fields` | Optional. The same fields `projects.update` takes, such as `githubRepoId` or `repositoryExternalId`, written with the row. Only the plugin facet can set it |
| `allowHttp` | Optional. Allows `http://` for a self-hosted GitLab whose connection URL is plain HTTP. Only the plugin facet can set it |

The steps:

1. Check the URL and the target. Refuse when `<parentDir>/<name>` exists and isn't an empty folder.
2. Clone into a hidden sibling folder, `<parentDir>/.<name>.acorn-clone-<runId>`, with
   `git clone --no-recurse-submodules -- <url> <hidden>`.
3. Rename the hidden folder to `<parentDir>/<name>`. If something took that name meanwhile, the
   rename fails and the run fails.
4. Create the project row, or fill `fillProjectId`, with `fields` in the same write, and return its
   ID. Writing them together means no client ever sees a GitHub clone without its GitHub link.
5. On any failure, delete the hidden folder. The real folder never holds half a clone.

The clone uses a 30-minute timeout and its own `AbortSignal`, so Node shutdown stops it. At most three
clones run at once and the rest queue, because phase 4 lets an importer start up to 100.

### URL checks

The URL is untrusted input. The check is a pure function in `clone.ts` with its own tests:

- Allow `https://host/path`, `ssh://[user@]host[:port]/path`, and the scp form `user@host:path`.
- Refuse every other scheme, including `http://` (unless the plugin facet passed `allowHttp`),
  `file://`, `git://`, and `ext::`.
- Refuse a URL with a password or token in it, such as `https://user:token@host/...`. Git writes the
  remote into `.git/config` in plain text. A bare user name, like `git@`, is fine.
- Refuse a host or path that starts with `-`, and anything with whitespace or control characters.

The clone then sets, on top of what `git.ts` already does:

- `GIT_ALLOW_PROTOCOL=https:ssh`, so a redirect or a submodule can't switch transport.
- `GIT_LFS_SKIP_SMUDGE=1`, so Git LFS doesn't download large files during the clone.
- `--` before the URL, which the GitLab and Bitbucket routes do and the GitHub route doesn't.

The service takes its allowed protocols as a dependency, so tests can add `file` and clone a local
bare repository. Production code never passes it.

### Routes

Device principal only. Task and service tokens get 403, so an agent can't fetch code onto the Node.

- `POST /v1/core/projects/clone-runs` takes `{ url, parentDir, name?, workspaceId? }` and answers 202
  with `{ cloneId, state: 'running' }`. A URL clone from this route is always untrusted.
- `GET /v1/core/projects/clone-runs/:id?waitMs=20000` answers `{ state: 'running', elapsedMs }`,
  `{ state: 'finished', result }`, or `{ state: 'none' }`. `result` is `{ ok: true, projectId }` or
  `{ ok: false, error }`.

The wire types go in `packages/protocol/src/projects/cloneRuns.ts` (new), with a client helper in the
shape of `archiveInBackground`. A finished run publishes the same project and workspace invalidations
as `createProject`.

### Plugin facet

`ProjectService` gets `clone(input)`, which returns `{ cloneId }`, and `cloneRun(id, waitMs)`. Both go
in `PROJECT_WRITES` and `hostCallModes.ts`. The plugin context fake in
`packages/node-core/src/testkit/pluginContext.ts` and the published surface snapshot change with them.

### CLI

`acorn project clone <url> --into <parent> [--name <folder>] [--workspace <id>]` starts a run, waits
with repeated `GET` calls, and prints the project ID. It retries a lost `POST` response the way other
CLI writes do ([retrying a write](../../cli/workspaces-projects-tasks.md#retrying-a-write)).

## Steps

1. Write the URL check and its tests.
2. Write the clone run service with the hidden-folder rename, the queue, and cleanup.
3. Add the route pair, the protocol types, and the client helper.
4. Add `clone` and `cloneRun` to the plugin facet, the permissions list, the call modes, and the testkit.
5. Add the CLI command.
6. Update [Projects and workspaces](../../workspaces-and-tasks/projects.md#add-a-project) and the CLI page.

## Acceptance

- URL check tests cover each allowed form and each refusal above, including `ext::sh -c ...`,
  `file:///tmp/x`, `https://u:p@host/r`, and `-oProxyCommand=...`.
- An integration test clones a local bare repository through the test-only `file` protocol, and
  checks the new row, its path, and the invalidations.
- A failed clone leaves neither the hidden folder nor the target folder behind.
- A target that exists and isn't empty is refused before git runs.
- A task token gets 403 from both routes.
- Checkpoint: clone a public repository of a few hundred megabytes from the CLI against a remote
  Node, and record how long it took.

## Risks

- **A Node restart mid-clone** loses the run, because runs live in memory like archive runs. The
  hidden folder stays on disk, and its name says what it is. A boot sweep would need the parent
  folders stored somewhere. Leave it until someone hits it.
- **No progress percentage.** `runProcess` collects output and has no streaming callback, so the run
  reports elapsed time only. Parsing `git clone --progress` needs a streaming hook in
  `packages/node-core/src/server/core/proc.ts`. Add it only if elapsed time proves not enough.
- **No cancel.** The 30-minute timeout bounds a mistaken clone. Add `DELETE` on the run if people ask.
- **Private repositories** need the Node machine's own Git login: a credential helper for HTTPS or an
  unlocked SSH agent. A failure says which one git asked for.

## Verify before building

- That `GIT_ALLOW_PROTOCOL` in `opts.env` wins over a value in the Node's own environment, given the
  `GIT_*` passthrough in `git.ts`. The spread order in `spec` suggests it does.
- That `fs.rename` of a folder works across every platform the Node ships on when both paths share a
  parent. It should, because it never crosses a filesystem.
