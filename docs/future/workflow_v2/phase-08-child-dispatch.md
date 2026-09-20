# Slice 08: One dispatcher for nested child workflows

Date: 2026-09-13. Status: complete (2026-09-14).

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./workflow-contract.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 06, 07. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A root dispatches a batch whose children conditionally start grandchildren, with one recovery path.

## Work

1. Extend frozen graph resolution and dispatcher lineage to the documented depth and root descendant limits.
2. Keep intended task/run IDs, payload fingerprints, reservation-before-effects, and transaction-checked admission.
3. Apply root budgets, deadlines, concurrency, cancellation, and usage accounting throughout the tree without parents holding agent slots.
4. Return ordered typed child outcomes and a distinct completed-with-failures status; independent children continue after an item failure.
5. Route AI-generated arrays through For each. Replace direct fan-out runtime and dedicated child-collection behavior, updating owned fixtures and retaining clear old-format diagnostics.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Test two nesting levels, the maximum depth, cyclic references, 500-descendant ceiling, four active agent slots, gates with running siblings, mixed outcomes, and cancel/restart at each dispatch boundary. Verify no duplicate tasks or usage charges.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

- `pnpm lint`: passed all 33 package tasks.
- `pnpm --filter @acorn/plugin-workflows test`: 372 tests passed across 38 files.
  Eight nested-dispatch integration cases exercise conditional grandchildren, frozen references,
  depth four, 500 real descendant tasks with four active agents, gated siblings at root concurrency
  one, mixed outcomes with a downstream summary, failed-grandchild retry, cancellation after core
  task commit followed by restart, local descendant-limit refusal, and atomic typed-roster rejection.
- Existing dispatcher and lifecycle tests cover ambiguous task/run acknowledgements, replay payload
  conflicts, cancellation at reservation and running-child boundaries, gated restart, terminal wakeup
  replay, and deadline recovery. Resolution tests reject cycles and depth five. Tree-safety tests
  cover ancestor subtree budgets, duplicate usage settlement, and unknown-usage recovery.
- `pnpm --filter @acorn/node exec vitest run test/integration/plugins/workflowRunner.test.ts test/integration/plugins/workflowTasks.test.ts`:
  25 tests passed. The former fan-out fixtures now use structured planning and mapped child workflows,
  retaining real Git worktrees, fake-agent execution, failure, and cancellation checks.
- Protocol tests: 173 passed. Plugin API tests: 12 passed. Architecture tests: 63 passed.
- `git diff --check`: passed.
- Real Tauri session `workflow-v2-phase08`: the AI-list shortcut inserts an ordinary structured agent
  step and a mapped child-workflow step, with readable predecessor labels and an explicit required
  child target. One Undo removes both inserted steps and enables Redo. Execution limits display
  the 100-descendant default, 500 ceiling, and four-agent default with slot-exemption help text.
  Screenshots: `.acorn/agent-dev/workflow-v2-phase08/screenshots/ai-list.png` and
  `.acorn/agent-dev/workflow-v2-phase08/screenshots/execution-limits.png`.
  Both screenshots were visually inspected. The isolated session was stopped after verification.

The implementation extends the existing dispatcher, keyed semaphore, and durable usage ledger. It
does not add a second queue. Child-status wakeups use batched reads; detailed bounded summaries are
built at settlement. Root execution limits are authored on the definition and shown in start review.
Retired fan-out and dedicated join kinds are no longer registered or executed. Their transitional
types and old-format diagnostics remain for slice 19; ordinary graph joins still use `after` edges.

## Verify before building

Re-read dispatcher/start-service/tree-safety and core intended-ID task creation. Do not implement a second queue or use array position as business identity.
