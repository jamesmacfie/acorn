# Phase 4: plugins

Status: shipped 2026-08-30. Waited on phase 3.

## What shipped differently

- terminal's composition hooks (`configureTerminalMcp`, `reconcileTmux`, `refreshAcornMcpRegistrations`)
  are exported from `node/index.ts`, not from `contract/`. They are implemented by the PTY engine in
  `server/`, and the arch rule "a plugin contract/ never re-exports its own internals" forbids a
  contract module that reaches `server/`. The entrypoint is the other cross-package surface apps/node
  already imports.
- `apps/node/test/integration/pluginSystem/mainBarrelLoad.test.ts` is deleted rather than re-pointed.
  Its subject, `plugins/*/src/main/index.ts`, no longer exists, and every `node/index.ts` is already
  booted by the composition-root suites beside it.
- `capabilityId` and `extensionPointId` moved to `@acorn/protocol/plugin/ids.ts` with their brand
  types; node-core re-exports them so nothing else changed. Two contract modules still take a type
  (`HeadlessResult`, `StreamEvent`, `LayoutRecipe`) from `@acorn/plugin-api/node`; a type import is
  erased and carries no runtime edge.
- The onboarding shim is gone and the entry is a plain `index.ts` that calls `createComponent`. The
  arch resolver maps a subpath to `src/` literally, so an `index.tsx` target would fail it.
- The three `tsconfig.json` files in browser, model-providers, and nodes-file stay. They remove the
  DOM lib the shared base adds, so a one-line extend cannot carry them.
- editor keeps `client/search/searchClient.ts`; agents keeps five wrappers in its feature folders.
  changes' wrapper is `changesClient.ts`, workflows' is `client/workflowsClient.ts`.
- Only the three `*Slice`/`*State` pairs this phase named were folded into `*Store`; the rest are
  phase 5, as `docs/conventions.md` says.

## Goal

Every plugin has the shape in [03-target-layout.md](./03-target-layout.md): no `main/`, `node/`
holding only the entrypoint and schema, `contract/` holding only what another package imports and no
tests, one name per role. The two largest flat folders are subdivided. The Electron residue is gone.
The 13 misfiled runtime dependencies are dev dependencies.

## Why this phase, and why now

Phase 3 already stopped the arch test recognising `main` as a side, so any `main/` folder left is a
failing test. The plugins are 19 packages that mostly do not import each other, so the moves are
independent and can be one commit per plugin. Doing this before client-core (phase 5) means the 13
plugin files that deep-import `@acorn/client-core/*` are already in their final folders when phase 5
rewrites the specifier.

## Scope

### Retire `main/`, one commit per plugin

For agents, changes, database, docker, editor, github, memory, notes, terminal, workflows:
`git mv src/main/* src/server/`, fix relative imports (`tsc` lists them), delete `./main/index.ts`
from the exports map. Where `main/` had subfolders (`agents/src/main/drivers/`, `usage/`,
`profiles/`) they move as folders.

terminal's `main/index.ts` is imported from two places after phase 2, `apps/node/src/entries/` and
`apps/node/src/composition/`. Move what they need to `plugins/terminal/src/contract/` (it is
cross-package by definition) and import from there. agents' `main/index.ts` has no external importer;
it becomes `server/index.ts` or is inlined into `node/index.ts`.

`plugins/github/src/server/agentTools.ts` and its test move to `server/`, and github's `main/` folder
(two files) is gone with them.

### `node/` holds the entrypoint and schema only

Move `plugins/http/src/server/workflowStep.ts` and its test to `server/`. Pull `toRunStatus`,
`RUN_LIST_LIMIT`, `TERMINAL_WORKFLOW_STATUSES`, and the deps type out of
`plugins/workflows/src/node/index.ts` into `shared/runStatus.ts`; the entrypoint imports them.

### Apply the contract rule

- github gets a `shared/` folder. Move `plugins/github/src/shared/api.ts`,
  `plugins/github/src/shared/collections.ts`, `plugins/github/src/shared/pullRef.ts` and their
  tests there; each has zero external importers. Fix the false claim in `api.ts` line 4.
- Move `plugins/workflows/src/shared/workflowContracts.ts` and
  `plugins/workflows/src/client/workflowsClient.ts` to `shared/`.
- Move the two remaining tests out of `contract/`: `plugins/context/src/shared/contextBlock.test.ts`
  and `plugins/terminal/src/shared/api.test.ts` go to `shared/` beside a re-export, or the
  module they test moves to `shared/` and `contract/` re-exports it.
- Rename `plugins/terminal/src/shared/api.ts` to `api.ts` (it is route builders). Rename
  `plugins/github/src/client/clientRoutes.ts` to `clientRoutes.ts`.
- The 12 contract modules that import `@acorn/plugin-api/node` for `capabilityId` and
  `extensionPointId`: move those two helpers to `@acorn/protocol` if they are pure, so a contract
  imports only wire types. If they are not pure, record the exception in the arch test with a reason.
- Add `plugins/github/src/testkit/githubToken.ts` to github's `./testkit` barrel or move it into
  `server/routes/__fixtures__/`.

### Subdivide

- `plugins/agents/src/client` (69 files) into `composer/`, `sessions/`, `usage/`, `settings/`,
  `center/`. Take the grouping from the component names; `AgentComposer.tsx` and its siblings are
  one group, the usage panels another.
- `plugins/github/src/server/routes` (32 files) into `pulls/`, `repos/`, `checks/`, `mirror/`.
- `plugins/agents/src/server` after the merge (the former `main/`, 77 files) keeps `drivers/`,
  `usage/`, `profiles/` and gains `sessions/` for the runtime, store, repository, and engine files.

### Apply the conventions

From [02-conventions.md](./02-conventions.md), per plugin:

- One client wrapper per plugin, `<plugin>Client.ts`, in `client/`. agents keeps its five but they
  move into their feature subfolders. `plugins/terminal/src/contract/sessionsClient.ts` and
  `plugins/workflows/src/client/workflowsClient.ts` stay in `contract/` only if another plugin
  imports them (sessionsClient: yes, two importers; workflowClient: no, it moves).
- Client state files end in `Store.ts`; drop `Slice`, `State`, `ViewState`. docker's four become
  `dockerStore.ts`, `dockerLogStore.ts`, `dockerViewStore.ts`, `dockerPrefs.ts`. github's
  `filterSlice.ts` and `filterState.ts` merge or one renames. context's `selectionSlice.ts` and
  `selectionState.ts` likewise.
- `plugins/agents/src/server/drivers/__fixtures__/` renames to `__fixtures__/`.
- `plugins/workflows/src/server/workflowExtensions.test.ts` drops the infix.
- `plugins/onboarding/src/client/index.ts` shim: keep, it is commented and unique for a reason, or
  make the four loaded plugins do the same. Pick one and write it in `docs/plugins.md`.

### Electron residue

- Delete the `app.asar` rewrite in `plugins/editor/src/server/search.ts` lines 18 to 24 and the
  assertion in `search.test.ts` line 51.
- Rewrite `plugins/preview/src/node/index.ts` lines 3 to 6.
- Rename `plugins/memory/src/server/knowledgeChannel.ts` to `knowledgeChannel.ts` and
  `plugins/terminal/src/server/runChannel.ts` to `runChannel.ts`. Rewrite the "main process" and
  "renderer" prose in the 13 files the review listed; `grep -rln "main process\|main-process\|renderer" plugins --include=*.ts --include=*.tsx`
  finds them.
- Rewrite `plugins/terminal/src/server/terminalDisplay.ts` line 4.

### Dependencies

Move `@acorn/node-core` and `@acorn/client-core` from `dependencies` to `devDependencies` in agents,
changes, context, database, docker, editor, github, memory, notes, onboarding, preview, terminal,
workflows. `pnpm install` and confirm nothing in `src/` outside tests imports them.

### Leftovers

Delete `plugins/database/src/server/formatSchema.test.ts` or extract `formatSchema` from
`database.ts` so the test has a subject. Collapse the three near-identical nine-line `tsconfig.json`
files in browser, model-providers, nodes-file to a one-line extend if `plugins/tsconfig.base.json`
can carry the `types` they add.

### Docs

`docs/plugins.md` canonical shape loses its "target" marker. `docs/architecture-overview.md` section
"Package boundaries" subpath table drops the `./main/index.ts` row. `docs/first-party-plugins.md`,
`docs/managed-agents.md`, `docs/terminal.md` (new), `docs/github-integration.md`, `docs/workflows.md`,
`docs/notes-and-memory.md`, `docs/docker.md`, `docs/http-client.md`, `docs/database.md` (new) cite
`plugins/*/src/main/` paths (six distinct). Fix them here.

## Out of scope

Deduplicating `plugins/linear/src/shared/rail.ts` and `plugins/rollbar/src/shared/rail.ts`, and
replacing the `hono` import in the four loaded plugins with the portable carrier. Both change what
the code does; see [refused.md](./refused.md). Splitting `plugins/agents` into packages (refused).

## Done when

- `find plugins -type d -name main -path '*/src/*'` is empty.
- `find plugins -path '*/src/contract/*.test.*'` is empty.
- `find plugins -path '*/src/node/*' -type f | grep -v -e index.ts -e schema.ts` is empty.
- No plugin `src/client` or `src/server/routes` has more than 30 direct files.
- `grep -rn '"./main/index.ts"' plugins/*/package.json` is empty.
- `grep -rli electron plugins --include=*.ts --include=*.tsx` is empty.
- `pnpm lint`, `pnpm test`, and `tools/arch` are green.

## Verify before building

- The importer counts in [01-findings.md](./01-findings.md) for github's and workflows' contract
  modules are still zero.
- terminal's `main/index.ts` is still imported from exactly two files under `apps/node/src`.
- `plugins/http/src/server/workflowStep.ts` still exists.
- `plugins/agents/src/client` still has no subdirectories.
