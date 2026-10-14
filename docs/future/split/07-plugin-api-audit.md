# Phase 7: move single-consumer facade exports to their owners

Date: October 14, 2026. Status: proposed.

## Goal

Every name in `@acorn/plugin-api` is a seam core offers to plugins in general, or a registry that
happens to have one contributor so far. A plugin's internals live in that plugin, and a name nobody
uses goes.

## Starting point

A regular-expression count on October 14, 2026, over named imports in `plugins/` and `apps/`
production code, found these numbers:

| Consumers | Exports |
| --- | --- |
| None | 110 |
| One plugin | 278 |
| Two plugins | 94 |
| Three or more | 182 |

Of the 110 with no plugin consumer, 59 match no word anywhere outside the facade, excluding tests.
Many of those are testkit fixtures that only tests use, so check each one.

The one-consumer exports cluster by plugin: 62 for agents, 50 for GitHub, 39 for terminal, 37 for
editor, and 31 for workflows. Some examples of a plugin's internals in core:

- `setManagedAgentReferenceHandler` in `packages/client-core/src/features/agent/reference.ts` is a
  single global slot where the last caller wins. Only `plugins/agents/src/client/referenceContribution.ts`
  sets it.
- `DEFAULT_PROFILE_ID = 'claude-code'` in `packages/node-core/src/server/agentProfiles/index.ts`
  names a profile the agents plugin registers.
- Terminal drawer state such as `consumeTerminalFocusIntent` and `isTerminalMax`, and the terminal
  open set in `packages/client-core/src/features/tasks/tasks.ts`.

`knip.jsonc` turns off unused-export checks for `packages/plugin-api`, and
`packages/plugin-api/src/surface.snapshot.txt` records names without their consumers. Nothing catches
an export that loses its last caller.

## Changes

1. Rerun the count with a script you keep under `tools/`, counting tests and `import *` as well.
   Put the results in a table in the pull request.
2. Sort each one-consumer export into one of three groups:
   - A general seam with one contributor so far. Keep it.
   - A plugin's internals. Move it to that plugin's `contract/` folder, or inside the plugin.
   - A seam shaped for one plugin that another could use. Make it general.
3. Replace `setManagedAgentReferenceHandler` with a reference target registry that any plugin can
   contribute to, ordered by priority. The session-source fallback in `sendReferenceToAgent` becomes
   one entry.
4. Have the agents plugin publish its default profile through a capability, and drop the literal
   from core.
5. Delete the exports with no consumer, tests included.
6. Add a check that every facade export has at least one importer outside the facade, tests
   included, so the zero group can't grow back.

## Out of scope

The published packages `acorn-plugin-sdk` and `acorn-plugin-types`. Outside plugins use them, and
their compatibility rules are in [published packages](../../plugins/publishing.md).

## Acceptance

- The pull request's table accounts for every one-consumer export, with its group and reason.
- The zero-consumer group is empty, and the step 6 check fails when someone adds an export nobody
  imports.
- Adding a file reference from the editor still drops it into the agent composer, through the
  registry.
