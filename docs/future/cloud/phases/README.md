# Cloud delivery phases

Status: proposed, 2026-09-29. Nothing here is scheduled. Each phase ends with something deployed and
usable by a named audience, and each has manual checkpoints along the way so the work is tested as
it grows rather than at the end. Read [goals](../goals.md) and [architecture](../architecture.md)
before taking a phase.

## The sequence

| Phase | What is deployed at the end | Who can use it | Depends on |
| --- | --- | --- | --- |
| [1. Node image](./01-node-image.md) | A published acorn Node image, and a recipe to run one on the compute provider and pair it by hand. | Anyone who self-hosts. | Nothing. |
| [2. Team Node](./02-team-node.md) | Teams with a region. Creating a team provisions its team Node behind the relay. Desktop and TUI use it with no pairing code. | Internal. | 1, and [remote access phase 2](../../remote-access/phases/02-accounts.md). |
| [3. Cloud task](./03-cloud-task.md) | Publish a project and run a task in the cloud from desktop or TUI, with history kept on the team Node. Manual stop. | Internal. | 2. |
| [4. Archive](./04-archive.md) | Idle workers archive and disappear after five minutes. Plugin detail restores on demand. | Internal. | 3. |
| [5. Isolation](./05-isolation.md) | A hardened worker: sandboxed task processes, brokered model keys, enforced egress, team policy. | Closed alpha: single-person teams, own keys. | 4. |
| [6. Plugins](./06-plugins.md) | Admin-approved loaded plugins, cloud connections, and frozen plugin locks in cloud tasks. | Closed alpha. | 5. |
| [7. Teams](./07-teams.md) | Invitations, admin, member, and viewer roles enforced on every route, and live revocation. | Closed beta, free. | 6. |
| [8. Billing](./08-billing.md) | Metering, estimates, hard budgets, and invoices. | Paid beta. | 7. |
| [9. Production](./09-production.md) | Three regions, backups, quotas, runbooks, security review, and the speed target met. | General availability. | 8. |

Phase 1 has no dependency on remote access and can run beside it. Phase 5 owns the
worker execution boundary and team policy described in [isolation](../isolation.md).

## Why this order

- **The Node image first**, because every hosted thing is that image, and because it answers the
  speed and provider questions with real numbers before anything depends on them.
- **One person before many.** Phases 2 to 6 prove the whole single-person loop, including teardown
  and plugins, before multi-person roles add a second axis of complexity.
- **Remote access before any hosted Node.** Team Nodes and workers never get public addresses, so
  they use the account service and relay from [remote access](../../remote-access/README.md) from
  the start.
- **Nothing is lost before anything is shared.** Archive and restore land before anyone outside the
  building team uses a worker.
- **Hardening before outsiders.** Phase 5 is the gate for the first external user, because a worker
  holds a team's secrets next to an agent.
- **Charging last.** Billing needs every metered thing to exist, and a free closed beta finds the
  problems cheaper than a paid one.

## Decisions to make before phase 1

Each is also listed in the phase that first needs it. Making them early saves rework.

1. The compute provider organization, with separate staging and production accounts.
2. Who holds the credentials for staging and production infrastructure.

The product name and domain are decided in
[remote access phase 2](../../remote-access/phases/02-accounts.md#open-questions). The hosted service
is closed source ([services](../services.md#where-the-code-lives)).

## Rules for every phase

- Each phase starts by writing its design section: exact endpoints, wire schemas, idempotency keys,
  and which owning documents change. Put the design at the top of the phase file, or in the owning
  document if the contract is shipping.
- Run `pnpm lint` and the relevant tests for each slice, and `pnpm test` for the whole suite.
- For desktop changes, test in the real Tauri window with `pnpm dev:agent` and the UI driver. For TUI
  changes, use the isolated PTY driver. See [local development](../../../local-development.md).
- Test a packed Node image as well as a checkout.
- When a phase ships a contract, update the owning document under `docs/` in the same change. Move
  shipped behavior out of this folder; leave the phase file as the record of decisions and evidence.
- Record measured results, such as boot times, archive sizes, and costs, in the phase file's
  evidence section with the date.
- Each phase's open questions are answered, or explicitly deferred with a reason, before its
  acceptance is signed off.

## How a checkpoint works

A checkpoint is a manual test that someone runs and records before the phase continues. It names the
setup, the steps, and what you should see. If a checkpoint fails, fix the cause before starting the
next step. A checkpoint that is skipped is written down as skipped, with the reason.

## Verify before building

Before starting a phase, reread the phases before it for decisions that changed, and recheck the
provider facts in [hosting and cost](../hosting-and-cost.md).
