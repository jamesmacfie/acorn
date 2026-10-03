# Cloud delivery phases

Status: proposed, 2026-09-29. Nothing here is scheduled. Each phase ends with something deployed and
usable by a named audience, and each has manual checkpoints along the way so the work is tested as
it grows rather than at the end. Read [goals](../goals.md) and [architecture](../architecture.md)
before taking a phase.

## The sequence

| Phase | What is deployed at the end | Who can use it | Depends on |
| --- | --- | --- | --- |
| [1. Node image](./01-node-image.md) | A published acorn Node image, and a recipe to run one on the compute provider and pair it by hand. | Anyone who self-hosts. | Nothing. |
| [2. Account service](./02-account-service.md) | A staging account site: sign in with GitHub, create a team with a region. | Allowlisted accounts. | Nothing. Runs in parallel with 1. |
| [3. Team Node](./03-team-node.md) | Creating a team provisions its team Node. Desktop and TUI sign in and use it with no pairing code. | Internal. | 1, 2. |
| [4. Relay](./04-relay.md) | Hosted Nodes reachable only through the relay. Owners can reach their own local Node from anywhere. | Internal, and allowlisted owners for remote access. | 3. |
| [5. Cloud task](./05-cloud-task.md) | Publish a project and run a task in the cloud from desktop or TUI, with history kept on the team Node. Manual stop. | Internal. | 4. |
| [6. Archive](./06-archive.md) | Idle workers archive and disappear after five minutes. Plugin detail restores on demand. | Internal. | 5. |
| [7. Isolation](./07-isolation.md) | A hardened worker: sandboxed task processes, brokered model keys, enforced egress, team policy. | Closed alpha: single-person teams, own keys. | 6. |
| [8. Plugins](./08-plugins.md) | Admin-approved loaded plugins, cloud connections, and frozen plugin locks in cloud tasks. | Closed alpha. | 7. |
| [9. Teams](./09-teams.md) | Invitations, admin, member, and viewer roles enforced on every route, and live revocation. | Closed beta, free. | 8. |
| [10. Billing](./10-billing.md) | Metering, estimates, hard budgets, and invoices. | Paid beta. | 9. |
| [11. Production](./11-production.md) | Three regions, backups, quotas, runbooks, security review, and the speed target met. | General availability. | 10. |

Phases 1 and 2 have no dependency on each other and can run at the same time. Phase 7 owns the
worker execution boundary and team policy described in [isolation](../isolation.md).

## Why this order

- **The Node image first**, because every hosted thing is that image, and because it answers the
  speed and provider questions with real numbers before anything depends on them.
- **One person before many.** Phases 3 to 8 prove the whole single-person loop, including teardown
  and plugins, before multi-person roles add a second axis of complexity.
- **Private reachability before cloud tasks.** Workers never get public addresses, so the relay
  must exist before the first worker.
- **Nothing is lost before anything is shared.** Archive and restore land before anyone outside the
  building team uses a worker.
- **Hardening before outsiders.** Phase 7 is the gate for the first external user, because a worker
  holds a team's secrets next to an agent.
- **Charging last.** Billing needs every metered thing to exist, and a free closed beta finds the
  problems cheaper than a paid one.

## Decisions to make before phase 1

Each is also listed in the phase that first needs it. Making them early saves rework.

1. The product and domain name for the hosted service.
2. The compute provider organization, with separate staging and production accounts.
3. Whether the account service lives in a private repository. See [services](../services.md#where-the-code-lives).
4. Who holds the credentials for staging and production infrastructure.

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
