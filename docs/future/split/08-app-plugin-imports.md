# Phase 8: list and test which plugin contracts the apps import

## Completion note

Landed October 15, 2026.

What changed:

- A test in `tools/arch/boundaries.test.ts` lists every production import from an app into a
  plugin's `contract/` folder, as `<app file> -> <contract file>`, with a reason for each. It fails on
  an import missing from the list, and on a listed import that's gone. Test code is exempt.
  Activation entrypoints aren't listed.
- [First-party plugins](../../first-party-plugins.md#what-the-apps-import-from-plugins) has the same
  list in words, and [package boundaries](../../architecture/packages.md#what-an-app-may-import)
  points at it.
- The CLI reads the agents and workflows route shapes from each plugin's `contract/wire.ts`.
  `AgentSessionRow` is gone from `apps/cli/src/projection.ts`. `agentCommands.ts` dropped its
  `Provider`, `Turn`, `Snapshot`, `EventRow`, and `EventPage` copies, and `workflowCommands.ts` dropped
  `Run`, `Step`, and `Definition`. The CLI has `@acorn/plugin-workflows` as a dev dependency, like
  agents, because the bundle inlines it.
- [Agents and workflows](../../cli/agents-and-workflows.md#why-these-commands-are-built-in) says why
  `agent` and `workflow` are built in, and when to move them onto `cliCommands`.

Decisions and deviations:

- The run and step routes answer `WorkflowRunProjection` and `WorkflowStepProjection`, which lived in
  the workflows plugin's `shared/api.ts`, where no app may import them. They moved to
  `contract/wire.ts` with `WorkflowChildRunSummary`, `WorkflowUsageSummary`, and `WorkflowBudget`.
  `shared/workflowContracts.ts` re-exports `WorkflowBudget`. Every importer in the plugin points at the
  contract. Nothing about the wire changed.
- The doc named four app files. The scan found 21 edges, including the extension sidebar, the Node
  composition root's capability tokens, the CLI's browser bridge, and `apps/tui/src/chrome/sessionPty.ts`.
  All are listed.
- The merged run list (`/v1/core/runs`) and the step status read keep their inline shapes in the CLI.
  The first is a core route, and the second has no named contract type.

Checked: changing `runtimeState` in `AgentSession` failed `tsc` in `apps/cli` in five places, and an
unlisted import in `TaskView.tsx` failed the new test with the edge named. The CLI tests (124), the
workflows tests (650), `tsc` in the CLI, workflows, and arch tests, knip, oxlint, the format check, and
the CLI build pass. Four arch reds predate this phase and match phase 7's list: the client console
baseline, two doc citation checks, and doc paths.

For later phases:

- A new app import from a plugin's `contract/` goes in both lists with its reason.
- Terminal drawer state (`setTerminalOpen`, `isTerminalMax`, `consumeTerminalFocusIntent`,
  `requestTerminalFocusIntent`) stays in client-core. The first-party page records why, and it moves
  only with the drawer.

Date: October 14, 2026. Status: proposed.

## Goal

When an app depends on a specific plugin, the dependency is on a written list with a reason, and a
test fails when someone adds one. Where an app redeclares a plugin's data shapes, it imports them
from the plugin's contract instead.

## Starting point

[Package boundaries](../../architecture/packages.md#what-an-app-may-import) let an app import any
plugin's public paths. These production imports exist:

- `apps/desktop/src/client/TaskView.tsx` imports terminal's `sessionsClient` contract to open a
  terminal profile.
- `apps/tui/src/chrome/Sessions.tsx` imports terminal's host client, wire types, and toolbar actions,
  and agents' handoff client. The terminal client draws terminal sessions itself.
- `apps/tui/src/chrome/Shell.tsx` imports workflows' Git launch contract.
- `apps/cli/src/browser/agents.ts` imports the agents plugin's contracts for the browser extension
  bridge.

[First-party plugins](../../first-party-plugins.md) explains why terminal sits close to the shell. It
doesn't list these imports, so nobody can tell an intended dependency from drift.

The CLI has a second pattern. `apps/cli/src/agentCommands.ts` and `apps/cli/src/workflowCommands.ts`
call `/v1/p/agents` and `/v1/p/workflows` directly. `apps/cli/src/projection.ts` redeclares the
session and run shapes rather than importing them. The CLI already lets plugins add commands through
`cliCommands`, in `apps/cli/src/pluginCommands.ts`. That contribution is for loaded plugins and takes
one bounded JSON object in and out. It can't follow an event stream or wait on a run, which
[agents and workflows](../../cli/agents-and-workflows.md) needs. That explains why the two command
groups are built in, but no doc says so.

## Changes

1. Add a check to `tools/arch/boundaries.test.ts` that lists every production import from an app
   into a plugin's `contract/` folder, with a reason for each. A plugin's `node/index.ts` and
   `client/index.ts` entrypoints stay unrestricted, because composition roots exist to import them.
2. Add the same list, in words, to the first-party plugins page.
3. Have the CLI import the agents and workflows wire types from each plugin's `contract/` folder, and
   delete the copies in `apps/cli/src/projection.ts`. A field rename then fails the CLI's type check
   rather than its users.
4. Say in the CLI docs why `agent` and `workflow` are built in. Extend `cliCommands` with a follow or
   wait shape only when a third plugin needs one.

## Out of scope

Moving the terminal drawer out of the shells. The first-party plugins page gives the reasons it's
there, and this phase only makes the dependency visible.

## Acceptance

- Adding an import from any app into a plugin's `contract/` folder fails the boundary test until the
  list names it.
- Renaming a field in the agents session wire type breaks the CLI's type check.
