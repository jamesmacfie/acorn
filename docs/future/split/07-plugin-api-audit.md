# Phase 7: move single-consumer facade exports to their owners

## Completion note

Landed October 15, 2026.

What changed:

- `node tools/arch/facadeConsumers.ts` counts who imports each facade name, tests included. The
  per-export table, with each one's group and reason, is in
  [the audit table](./07-plugin-api-audit-table.md). It started at 11 names with no importer and 398
  with one, out of 772.
- `tools/arch/facadeConsumers.test.ts` fails when a facade name has no importer outside the facade.
  Adding an unimported name to the surface snapshot makes it fail.
- `ctx.referenceTargets` on the compiled client context replaces `setManagedAgentReferenceHandler`.
  `sendReferenceToAgent` asks targets from the highest `priority` down, and the first answer wins.
  Core registers the task's latest running agent session at priority 0. Agents registers its managed
  sessions at 100, in `init`. `docs/contribution-kinds.md` has the row.
- Agents provides `agents.defaultProfile` (`plugins/agents/src/contract/defaultProfile.ts`).
  `DEFAULT_PROFILE_ID` is gone from node-core and the facade. Workflows reads the capability through
  `RunnerDeps.defaultProfileId`, and passes it on in both validation catalogs and in
  `WorkflowCatalog.defaultProfileId`.
- Moved into their plugin: GitHub's check-status helpers (`client/checks/checkStatus.ts`), GitHub's
  blob cache keys (`server/blobKeys.ts`), and the codex stdout adapter
  (`plugins/agents/src/server/profiles/codexStream.ts`).
- `WorkflowNotice` is exported as `NoticeFrame`, its protocol name. `ui/tree: createArmedConfirm`,
  which nothing imported, is gone.
- `docs/plugins/plugin-api.md` § Change the facade states the rule and the check.

Decisions and deviations:

- The check exempts closed-kit nodes on `ui` and `ui/tree`. Ten have no importer: `Pane`, `Grid`,
  `PickerRow`, `KeyValueEditor`, `Fallback`, four diff rows, and `Rectangle`. Deleting them would break
  the kit's support matrix and its two-host parity, and the kit offers every node to every plugin.
  The support matrix test already holds that list.
- A workflow step that names no profile, on a Node where nothing publishes a default, passes
  validation and fails when it runs, with "This step names no agent profile, and no plugin supplies a
  default." Agents is a required plugin, so a real Node always has the default. Strict validation would
  have meant a default in every test catalog.
- Kept, with the reason in the table: terminal drawer state (`isTerminalMax`,
  `consumeTerminalFocusIntent`), because both shells read it, and phase 8 owns the shells' terminal
  wiring. Also `wsOnWorkflowStepChanged`, because moving it means the Node sends the frame on a plugin
  channel, which is a wire change. Also `previewUrlForClient` and `remotePreviewBlocked`, which phase 9
  decides.
- `agents.defaultProfile` isn't in the published capability catalogue. The published packages are out
  of scope, and the catalogue already leaves out other agents capabilities.

Checked on the final tree: knip, `tsc` in every package, and the tests for plugin-api, agents, GitHub
(312 passed), terminal, workflows (650 passed), client-core, node-core (1,805 passed), the Node app,
and the arch tests. These reds also fail on base `95b292259`: agents `toolFoldPrefs`, terminal
`TerminalPanel` (two), client-core `cssHygiene` border-radius, the plugin-disable pair (git routes
only), and six arch tests (client console baseline, two doc citation checks, doc paths, two test
focus checks). oxlint stops on an unused import in `apps/extension/src/sidebar/Handoff.test.tsx`, and
the format check flags six files this phase doesn't touch.

For later phases:

- Run `node tools/arch/facadeConsumers.ts` before adding or pruning a facade name. 385 names have one
  importer, and the table says why each stays.
- Phase 8: the task drawer exports and `requestTerminalFocusIntent` are the shells' terminal wiring.
- Workflow socket frames (`wsOnWorkflowStepChanged`, `wsOnWorkflowStepEvent`) still live in core's
  socket client.

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
