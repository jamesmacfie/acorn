# Phase 10: usage, billing, and budgets

Status: proposed, 2026-09-29.

## Goal

Charge teams for what they use, show a cost before it is spent, and stop spending at a hard budget
through the same safe path as an idle teardown. The invoice must match the usage ledger.

Read [hosting and cost](../hosting-and-cost.md#what-the-customer-pays-for) before starting.

## What you can deploy at the end

A paid beta. Teams subscribe to a base plan, add a payment method, set a hard budget, see an estimate
before each cloud task and spend so far on each running task, and receive an itemized monthly
invoice.

## Starting point

- The closed beta from [phase 9](./09-teams.md).
- Relay byte counts reported since [phase 4](./04-relay.md).
- Provisioning records with machine sizes and lifetimes since [phase 3](./03-team-node.md).

## In scope

- The usage ledger in the account service.
- Readings for worker CPU and memory time, storage in GB-months, and relay bytes.
- Reconciliation against the provider's own usage data.
- The billing provider integration: plans, payment methods, invoices, and failed payments.
- Admission: reservation of estimated spend and a concurrency slot before provisioning.
- Hard team budgets, and the graceful stop when a running task reaches one.
- Estimates in the new-task flow and spend in the task header.

## Out of scope

Reselling model usage. Per-member budgets. Prepaid credits, unless the pricing decision needs them.

## Steps and checkpoints

### 1. The ledger

Record every billable event with its team, attempt or Node, quantity, unit, time window, and source.
Never record task content.

**Checkpoint 1: the ledger tells the truth.** Run three cloud tasks of known length on staging. The
ledger's worker time for each is within a minute of the measured wall-clock time, and storage and
relay entries are present.

### 2. Reconcile with the provider

Each day, compare the ledger with the provider's usage data and invoice. Alert on any difference
above a threshold, and on any machine the provider bills that the ledger does not know.

**Checkpoint 2: a stray machine is caught.** Create a machine outside the provisioner. The next
reconciliation flags it.

### 3. Billing provider

Integrate plans, payment methods, metered usage, and invoices. Handle failed payments with a grace
period that ends in a stopped budget, not in lost data.

**Checkpoint 3: an invoice matches.** In the billing provider's test mode, generate a month's invoice
for a test team. Every line matches the ledger to the cent.

### 4. Admission and budgets

Estimate an attempt's cost, reserve it and a concurrency slot, and only then provision. Reconcile the
reservation to actual spend when usage arrives. Refuse work that would cross the hard budget.

**Checkpoint 4: an estimate before spend.** In the new-task flow, choosing **Cloud** shows the
estimate, the remaining budget, and the idle rule before **Run in cloud**.

**Checkpoint 5: the cap stops new work.** Set a team's budget just above current spend. Start a task.
When the next task would cross the budget, launch refuses with the amount and a link for an admin.

**Checkpoint 6: the cap stops running work safely.** Set a budget that a running task will cross.
When it does, the agent is asked to stop, the worker archives, and the attempt reaches `archived`.
The task header says why. Nothing is lost.

**Checkpoint 7: no client can bypass it.** With a stopped budget, call the reserve route directly
with a member's grant. It refuses.

## Acceptance

- Test-mode invoices match the ledger to the cent for a month of test usage.
- Provider reconciliation runs daily and has caught a planted discrepancy.
- A hard budget stops new and running work through the archive path.
- Estimates appear before spend.

## Docs to update when it ships

- The account service's own documentation for the ledger and billing.
- [hosting and cost](../hosting-and-cost.md) with the actual prices.

## Open questions

1. What are the prices: base plan, worker time, storage, and relay transfer?
2. Which billing provider? Stripe is the common choice for metered usage.
3. How are sales tax and VAT handled across regions?
4. Is there a free tier or trial, and what are its limits?
5. Who pays for a failed provision or an attempt that fails during setup through no fault of the
   team?
6. How is the standing cost of a warm pool attributed: spread across all teams, or to the base plan?
7. How accurate must an estimate be, and what does the UI say about uncertainty?
8. Do seats cost money, or only usage and the base plan?
9. What happens to archives and the team Node when a team stops paying? How long until deletion?

## Evidence

Record reconciliation results and invoice checks here, with dates.

## Verify before building

Recheck provider pricing and the billing provider's metered usage API.
