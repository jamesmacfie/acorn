# Phase 1: the scaffold route

Date: November 9, 2026. Status: built, waiting on the service ceiling (see the completion note).
Depends on nothing. Context: [the programme README](./README.md).

## Completion note

November 9, 2026.

### What landed

- `POST /v1/core/plugins/scaffold` in `routes/plugins/plugins.ts`, beside `/install`. It needs an
  `Idempotency-Key` and answers as the design below says. A 409 carries
  `{ error: { code: 'not-empty' } }`, and a 400 carries the reasons as `error.message`, the same
  error body every core route uses.
- `PluginScaffoldRequest` and `PluginScaffoldResult` in `pluginState.ts`. `api.ts` already
  re-exports that file, so no export line changed.
- The writer in `server/plugins/scaffold.ts`, loaded by the route with a dynamic `import()`. It
  builds the request schema too, so the validation code stays out of the startup bundle.
- Tests: `scaffold.test.ts` for the writer and schema (12 cases), and a `POST /scaffold` block plus a
  task-token 403 in `plugins.test.ts`.
- One line added to `routeRegistry.snapshot.json`, regenerated from this branch's clean base.

### Deviation: node-core doesn't depend on `create-acorn-plugin`

Step 4 can't be done as written. `create-acorn-plugin`'s own tests depend on `@acorn/node-core`, so
node-core depending on it makes a package cycle, and Turborepo refuses to plan any task:
`Cyclic dependency detected ... @acorn/node-core#topo -> create-acorn-plugin#topo`. That would fail
`pnpm test` everywhere.

Instead, apps/node depends on `create-acorn-plugin`, and the plugins bridge (`PluginsBridge`, the
`PLUGIN_STATE` capability) gained one member, `scaffoldPackage()`. The composition root supplies
it as `() => import('create-acorn-plugin')`. The writer takes the package as an argument, typed by a
small `ScaffoldPackage` type in `scaffold.ts`. TypeScript checks the real package against that type
where apps/node supplies it. Node-core's tests use a stand-in, `testkit/scaffoldPackage.ts`, and the
real package's own suite covers what each kind writes.

### Answers to "Verify before building"

- **Boundaries.** `tools/arch/boundaries.test.ts` has no rule against node-core importing
  `create-acorn-plugin`, and `SHARED` only governs plugin imports. The blocker was the Turborepo
  cycle above, not the boundary test. No allowance was added.
- **Task tokens.** `server/index.ts` mounts `requireDevice` on `/v1/core/plugins` and
  `/v1/core/plugins/*`, so the route inherits the gate. The test adds `/scaffold` to the existing
  "403s a task-scoped agent" list, which also shows the ungated router would have answered.
- **Git.** `core/git.ts` exposes `git` and `gitOrThrow`, which take a `cwd` and apply a 30-second
  timeout. The writer uses them. To decide on the fallback identity it runs
  `git var GIT_COMMITTER_IDENT`, which fails exactly when a commit would. A machine with its own
  identity commits as itself, including one where git can guess an identity from the host name.

### Service bundle

`pnpm --filter @acorn/node build`, static graph from `apps/node/scripts/check-service-budget.mjs`:

| | Bytes |
| --- | --- |
| Before | 1,946,645 |
| After | 1,947,190 |
| Growth | 545 |
| Ceiling on this branch's base | 1,947,000 |

The growth is inside the 700 B budget, and the writer is its own lazy chunk (`scaffold-*.js`). The
total is 190 B over this branch's ceiling, so the build's budget check fails here. The ceiling
wasn't raised. Main's ceiling moved to 1,952,500 B on November 9, 2026, so this may pass after a
rebase. The coordinator decides.

### Checkpoint

Run on November 9, 2026, without a dev Node. A full dev Node needs a paired device, so the same chain
ran in a throwaway Vitest file in apps/node against the real `create-acorn-plugin`, then was
deleted:

- Scaffolding a new folder with `git: true` answered `{ result: 'written', git: 'committed' }`. It
  wrote `acorn-plugin.json` and left one commit, "Start Weather from the plugin scaffold".
- `createProject({ path })` on that folder answered `ok` with `vcs: 'git'`.
- The same scaffold call again answered `not-empty`.
- The trigger and data source kinds wrote their own starters.
- The task-token 403 is covered by `plugins.test.ts`, not checked by hand.
- No machine without `~/.gitconfig` was used. `scaffold.test.ts` covers that case with a git config
  that sets `user.useConfigOnly`, and the commit comes out as `Acorn <acorn@localhost>`.

### For later phases

- Phase 3 calls the route with an `Idempotency-Key` and reads `git` for the skipped reason. A
  skipped git step still leaves the files, so the folder can become a project either way.
- The owning page, [plugin installs by an agent](../../plugins/agent-install.md), isn't updated.
  Phase 4 owns the docs.
- `pnpm --filter @acorn/arch-tests test` fails on `02-agent-session-starter.md:47`. That doc cites
  `sessionStarter.ts`, which phase 2 hasn't created. This phase didn't cause it.
- The route writes no audit row. `/install` does. Add one if the owner should see scaffolds in the
  audit log.

## Goal

The Node writes a plugin's starter files into a missing or empty folder on its own machine. If the
caller asks, it also makes the folder a git repository with the starter files committed. After this
phase, `createProject({ path })` on that folder works, because the folder exists.

This phase has no UI. Phase 3 calls the route.

## Starting point

- `createProject` refuses a folder that doesn't exist ("Directory does not exist.",
  `packages/node-core/src/server/projects/projects.ts:295`). Nothing in node-core creates a folder or
  runs `git init`.
- Trellis already writes the scaffold, in `plugins/trellis/src/server/pluginPackage.ts:14`
  (`writePluginPackage`):
  - It reads the folder and refuses anything but a missing or empty one.
  - It takes the files from `scaffoldFiles(id, name, options)` in `create-acorn-plugin`.
  - It writes each file with `flag: 'wx'`, so an existing file is never overwritten.

  Copy its shape. Trellis keeps its own writer, because it adds `requires` and a seed-state file.
- `scaffoldFiles` (`packages/create-acorn-plugin/index.d.mts`) takes
  `{ rectangle?, dataSource?, trigger? }`. A data source starter is `{ row, inputs: { source, optional? }[] }`.
  `toPluginId` checks an ID.
- The plugin routes are in `packages/node-core/src/server/routes/plugins/plugins.ts`. `/install` (line
  372) requires an `Idempotency-Key` (`requireIdempotencyKey`, line 86). The family is gated by mount
  against task tokens (the comment at line 277 and
  [transport and auth](../../security/transport-and-auth.md)).
- Git runs through `packages/node-core/src/server/core/git.ts`.
- Routes load heavy code on first use with a dynamic `import()`, as
  `routes/projects/projects.ts:167,245` do. That keeps it out of the Node startup bundle.

## Design

### The route

`POST /v1/core/plugins/scaffold`, in `routes/plugins/plugins.ts`, beside `/install`.

| Field | Meaning |
| --- | --- |
| `folder` | Absolute path on the Node. Must be missing or an empty directory |
| `pluginId` | The manifest ID. Checked with `toPluginId`; refused if it changes the value |
| `name` | Display name for the manifest |
| `kind` | `'pane'`, `'trigger'`, or `'data-source'` |
| `dataSource` | Required when `kind` is `'data-source'`: `{ row, inputs }`, passed to `scaffoldFiles` |
| `git` | Whether to run `git init` and commit the starter files |

The answer:

- `200 { result: 'written', git: 'committed' | 'off' | { skipped: string } }`.
- `409 { code: 'not-empty' }`.
- `400` for a relative path, a bad ID, or a missing `dataSource`.

Put the request and response types in `packages/protocol/src/transport/api/pluginState.ts`, next to
`PluginInstallSource`, and export them through `api.ts`. The protocol package is at its cap of 99
entry points, so no new entry point.

### The writer

A new file, `packages/node-core/src/server/plugins/scaffold.ts`, loaded by the route with
`await import('../../plugins/scaffold')`. Inside it, `create-acorn-plugin` and git are imported
normally, so both stay out of the startup bundle.

1. Refuse a relative `folder`.
2. Read the folder. Missing is fine, an empty directory is fine, and anything else is `not-empty`.
3. `scaffoldFiles(pluginId, name, options)`, where `options` comes from `kind`.
4. `mkdir` each parent, and write each file with `flag: 'wx'`.
5. If `git` is set:
   1. Run `git init` in the folder.
   2. Run `git add -A`.
   3. Run `git commit -m "Start <name> from the plugin scaffold"`, passing
      `-c user.name=Acorn -c user.email=acorn@localhost` only when the Node has no git identity.

   If any git step fails, keep the files, and answer `git: { skipped: <reason> }`. A missing git
   binary is the common case.

### Why core and not a plugin

The Plugins settings page is core, and core can't call a plugin route by name and rely on it being
there. Trellis's writer lives in Trellis because only Trellis apps turn into plugins.

## Steps

1. Add the wire types to `pluginState.ts` and export them through `api.ts`.
2. Add `server/plugins/scaffold.ts` with the writer and its tests: missing folder, empty folder,
   non-empty folder, relative path, bad ID, each kind, git on, git off, and git failing.
3. Add the route to `routes/plugins/plugins.ts` with the idempotency check and the lazy import. Add
   route tests in `routes/plugins/plugins.test.ts`, including a task token getting 403.
4. Add `create-acorn-plugin: workspace:*` to `packages/node-core/package.json`.
5. Update `apps/node/test/integration/routeRegistry.snapshot.json`.
6. Run `pnpm --filter @acorn/node build`. Record the service bundle's size before and after in this
   file.

## Acceptance

- In a dev Node, `POST /v1/core/plugins/scaffold` with a new folder and `git: true` writes
  `acorn-plugin.json` and leaves one commit.
- `POST /v1/core/projects { path }` on that folder then succeeds and reports `vcs: 'git'`.
- The same call on that folder again answers `409 not-empty`.
- A task token gets 403.
- The service bundle grows by no more than about 700 B.

## Risks

- **Service ceiling.** If a static import slips into the route file, the whole scaffold package
  lands in the startup bundle and the build fails. The lazy import is the defence. Measure the bundle
  to confirm it held.
- **Uncommitted route registry snapshot.** On November 9, 2026, another agent had
  `routeRegistry.snapshot.json` modified in the main checkout. Regenerate it on a clean base.
- **Git identity.** A Node with no global git identity fails the commit. The `-c` fallback covers
  this. Check it on a machine with no `~/.gitconfig`.

## Verify before building

- Does `tools/arch/boundaries.test.ts` allow node-core to depend on `create-acorn-plugin`? Today only
  plugins import it, and its `SHARED` set at line 744 is for plugin imports. If core needs an
  allowance, add it with a reason.
- Confirm how the plugin route family refuses task tokens, so the new route inherits that gate, not
  a copy of it.
- Does `git.ts` expose a helper that runs in an arbitrary folder with a timeout? Use it rather than
  spawning git yourself.
