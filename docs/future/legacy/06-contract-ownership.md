# Ticket 06: Plugin-owned workflow and agent contracts

Date: 2026-09-21. Status: implemented 2026-09-23; UI promotion acceptance remains open. Prerequisites: 05.
Read [context](./context.md), F04/F06 in [findings](./findings.md), and
[client/type decisions](./target-architecture.md#shared-client-contracts).

## Outcome

Core no longer defines workflow rows, agent session domain types, or workflow form behaviour.

## Work

- Split tool authorization from the workflow protocol module into a core-owned tool-policy module.
  Move workflow definition/run/step/input wire types to Workflows' contract. Move agent domain types
  to Agents' contract. Update facade and peer imports without creating core-to-plugin edges.
- Move the managed attention adapter into Agents. Keep core's small attention snapshot and state
  vocabulary; use plugin/source identity rather than the full agent-kind union.
- Move the pure tool-tone helper into Agents' contract for Agents and Changes. Keep UI implementation
  out of contract files and forbid transitive imports of plugin server/client modules.
- Replace the workflow prop on task promotion with the generic action contract specified in the target
  architecture. Move selection, typed input controls, and workflow start into StartFromItemHost.
  Preserve a created/attached task across a failed workflow start so retry cannot create another task.
- Use the admission ledger as the run-total cost authority. Remove legacy run-total queries and UI
  fallback; retain per-step cost details and current unknown-cost behaviour.

## Acceptance

Ordinary promotion and start-workflow-from-item both work; start retry reuses the task. Authorization
ceiling encoding and checking remains equivalent. Notification transitions and tool colours remain
unchanged. Root/child costs do not double-count; failed/reserved turns and no-priced-usage cases remain
honest. Run `pnpm lint`, architecture tests, workflow/accounting/notification tests, and real-window
promotion/review UI checks. Both hosts must compile against the moved contracts.

## Verify before building

Check all importers before moving protocol files. Preserve core-owned task/worktree/security types;
two plugins sharing a type is a reason for a plugin contract, not for core ownership.

## Implementation record

- Tool ceiling parsing, encoding, and checks now live in `packages/protocol/src/toolPolicy.ts`.
  Workflow wire rows and inputs live in Workflows' `contract/wire.ts`; managed session, event,
  request, and attachment types live in Agents' `contract/wire.ts`. Agents' workflow chip consumes
  only `{ id, name }` for the run and step, so no Agents-to-Workflows package cycle was added.
- Agents maps its sessions to the shared attention snapshot and owns the pure tool-tone function.
  The snapshot identifies its source and carries its notice target and completion policy. Terminal's
  adapter stays in client-core until ticket 07 moves its session state.
- `PromoteToTaskModal` accepts a generic rendered action. Workflows supplies its picker, typed inputs,
  readiness, and start callback. A failed start keeps a created or attached task for retry. Run-list
  and run-pane totals read admitted turns only; a step's own cost remains on the step.
- The plugin API surface snapshot records this phase's three moved names. Its regeneration gate
  allows only those three removals while API 13 remains in use; ticket 10 removes that temporary
  allowance when it assigns the fresh API-1 baseline.
- The published draft-attachment shape is checked against Agents' contract from the architecture
  test package, so neither shared declarations nor the plugin imports the other for that assertion.

## Verification

- `pnpm lint`: 34 of 34 packages passed, including desktop and TUI TypeScript.
- Client promotion and notification focus: 46 tests passed. Agents: 650 tests passed.
  Workflows: 480 tests passed. Node tool-policy focus: 28 tests passed. Plugin API: 12 tests passed.
- Architecture: 62 of 64 tests passed. The two failures were already present before this ticket:
  `paletteView.ts` invokes a command in a host renderer, and Findings has a test under `src/node/`.
- An isolated Tauri window opened Home and Workflows, created a draft, and showed its publication
  validation. No connected external item or published workflow was present, so the promotion form
  and a successful run could not be checked in that window. The isolated session was stopped.
