# Ticket 06: Plugin-owned workflow and agent contracts

Date: 2026-09-21. Status: not started. Prerequisites: 05.
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
