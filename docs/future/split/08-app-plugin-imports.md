# Phase 8: list and test which plugin contracts the apps import

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
