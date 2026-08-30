# Refused: what was considered and set aside, with the argument

Part of [docs/future/structure/](./README.md). Each of these will be asked for again, and the
request will sound reasonable. This file exists so the argument is had once.

## Renaming `@acorn/desktop-helper`

The name says who spawns it, not what it does; "broker" or "custody" would be truer. Refused because
the package name appears in the bundle staging scripts, the Tauri sidecar config, `docs/shell.md`,
and `docs/architecture-overview.md`, and the architecture doc already defines the package in one
sentence. A rename buys a better word at the cost of a release-path change. Flatten its folders
(phase 3) and leave the name.

## Renaming `packages/node-core/src/server/` to `domain/`

After phase 3 the folder is the whole node library, not an HTTP server, so `server/` understates it.
Refused because `server/` is the name every plugin uses for the same side, and one word for one side
across 20 packages is worth more than a more accurate word in one. The scheduler and the sync engine
living under `server/` is the same imprecision plugins already accept.

## Keeping `main/` with a written definition

The alternative to retiring the word was defining it: `main/` is engines and stores, `server/` is
routes and vendor clients. Refused by the owner on 2026-08-30. The arch test already treats them as
one side, only two of ten plugin `main/` folders have an entrypoint, and a definition nobody enforces
is the state that produced the inconsistency.

## Moving `testkit/` out of `src/`

A test helper in a production package's `src/` looks wrong. `docs/testing.md` section on the testkit
and the arch rule "no production file imports any package's `testkit/`" already record why it lives
there: it ships with the package so a plugin's tests can import it through the exports map. Refused
because the decision is written down and enforced.

## Deduplicating `linear` and `rollbar` `shared/rail.ts`

Two 44-line files with names swapped. Refused here because merging them means a shared module both
loaded plugins import, which is a tier question (`docs/future/compiled-tier.md`) and changes what
the bundles contain. This programme moves files; it does not change what they do. The same applies
to the `hono` import in the four loaded plugins, which `docs/first-party-plugins.md` already calls
"the honest asterisk".

## Splitting `plugins/agents` into packages

168 files, 27% of plugin source, 69 flat client files. Refused because the size problem is inside
one plugin and subfolders solve it (phase 4). A package split changes the exports map, the manifest,
and the activation order for no reader's benefit.

## Publishing the shared vitest and drizzle config as a package

`plugins/vitest.shared.ts`, `plugins/drizzle.shared.ts`, and `plugins/tsconfig.base.json` are loose
files inside a workspace glob directory. Refused because pnpm ignores a match without a
`package.json`, and `turbo.json` already lists them under `globalDependencies` so an edit invalidates
every plugin's cache. A package would add a dependency line to 19 files to solve a problem the
comment in `turbo.json` already solved.

## Collapsing protocol's plugin-named baseline

`browserRules.ts`, `managedAgents.ts`, `terminal.ts`, `notes.ts`, `workflow.ts` are plugin wire
types living in `@acorn/protocol`. Refused here because the arch test already holds them as a
shrinking list with a rule that a plugin owns its own wire surface. Each one moves when its plugin is
next touched for a reason of its own; a bulk move would change import paths in the plugins for no
structural gain.

## Closing the `./*` exports on the four library packages

`client-core`, `node-core`, `dashboards-core`, and `desktop-helper` export `./src/*`, so a deep
import is legal and only the arch test says otherwise. Refused for this programme because
`docs/architecture-overview.md` section "Package boundaries" already records it as a bigger job than
the plugin maps were, and because phases 3 and 5 move hundreds of files behind those wildcards.
Closing the maps first would mean editing them twice.

## A `docs/reference/` or `docs/guides/` split

41 flat doc files invite a folder split by kind. Refused because `docs/README.md` (new) (phase 1) groups
them by kind without moving them, every inbound link keeps working, and the path checker's job stays
small. If the count passes 60 the question is open again.
