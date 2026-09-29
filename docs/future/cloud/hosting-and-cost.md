# Hosting, regions, cost, and speed

Status: proposed, 2026-09-29. This file holds the provider choice, regional placement, the cost
model, admission and budgets, and the speed target. Provider facts here are dated. Recheck them
before any phase relies on one.

## The provider interface

The first release uses one compute provider behind a small interface in the provisioner:

```ts
interface ComputeProvider {
  create(req: { idempotencyKey: string; region: string; image: string; size: MachineSize; env: Record<string, string>; volumeGb?: number }): Promise<MachineHandle>
  inspect(handle: MachineHandle): Promise<MachineState>
  destroy(handle: MachineHandle, idempotencyKey: string): Promise<void>
  usage(handle: MachineHandle, window: TimeWindow): Promise<UsageReading>
  list(region: string): Promise<MachineHandle[]>
}
```

Two implementations from the start: the chosen provider, and a local Docker adapter for development
and tests. A second real provider is not built until one is needed.

## Candidates, as of 2026-09-11

| Provider | Fit | Concern |
| --- | --- | --- |
| Fly Machines | Explicit region placement, fast boot from a prebuilt image, volumes, per-second billing. Leading candidate. | Volumes are tied to one host. Egress filtering per machine is not documented. Recheck. |
| Fly Sprites | Fast sleep and a persistent filesystem. | Fly support reported on September 11, 2026, that a caller cannot choose or move a Sprite's region. Fails the region rule. |
| Railway | Regional services. | Its VM primitive is in beta. |
| Vercel Sandbox | Simple API. | A 24-hour continuous-session limit on paid plans, so long runs need a restore path. |

For more information, see [Fly Machines](https://www.fly.io/docs/mcp/deploy-on/fly-machine/),
[the Fly Sprites regional answer](https://community.fly.io/t/wheres-my-sprite-in-the-world/28621),
[Railway pricing and status](https://docs.railway.com/pricing/plans), and
[Vercel Sandbox duration](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence).

[Phase 1](./phases/01-node-image.md) measures Fly Machines against the speed target. If it misses,
the phase compares one alternative before the programme commits.

### Questions the provider must answer

- Can each team's machines sit on an isolated private network, or only in a shared organization
  network? acorn does not rely on the private network for security, because all traffic goes through
  the relay, but a shared network widens what a compromised worker can probe.
- Can a machine's egress be restricted per machine?
- What kernel features are available inside the VM: user namespaces, Landlock, `nftables`?
- How fast does a machine boot from a cached image in each region, and how is the cache warmed?
- How does usage reporting work, and how late does it arrive?
- What happens to a machine and its volume on a host failure?

## Regions

A team chooses one region at creation: US, EU, or APAC. The team Node, workers, snapshots, artifacts,
and archives stay there. The control plane itself lives in one region and holds only account
metadata. Where that region is, and whether EU customers need account metadata in the EU, is an open
question for [phase 2](./phases/02-account-service.md#open-questions).

A region move is a separate migration. Changing a preference does not move data, and the UI must not
suggest it does.

## Scale targets

Design for tens of teams and hundreds of simultaneous workers before sharding anything. One team Node
per team. Limits on concurrent workers per team and on a single worker's runtime. Capacity alarms
per region. The control plane and relay scale independently, because neither holds the task ledger.

## Speed target

The warm-path target is 15 seconds from **Run in cloud** to an adopted worker with its project and
plugin roster visible. Checkout, dependency installation, and setup may continue after that, with
visible progress. Cold setup, in a new region or with a newly approved plugin, may exceed the target
and must say what it is doing.

Levers to measure, in order of cost:

1. A slim Node image with task tooling preinstalled, cached in each region.
2. Plugin packages cached by exact hash on the team Node or in the regional bucket.
3. A repository cache per team, such as a bare mirror on the team Node that workers fetch from.
   Never share private repository bytes across teams to hit the target.
4. A small warm pool of booted, unassigned workers per region. This costs money every hour, so
   record its standing cost before choosing it.

If a region misses the target, fund the warm capacity or publish a narrower target for that region.
Do not relax the target silently.

## What the customer pays for

- A monthly base plan per team, covering the team Node and the account service.
- Worker CPU and memory time, metered per second.
- Archive, artifact, and snapshot storage, per GB-month.
- Relay transfer, per GB.
- Model usage is not billed by acorn. Teams bring their own keys.

Recheck [Fly pricing](https://fly.io/pricing/) and [Railway pricing](https://docs.railway.com/pricing)
once phase 1 produces a workload trace, and set prices from measured cost plus margin.

## Admission and budgets

1. Before provisioning, admission estimates the attempt's cost from the machine size and a default
   run length, and reserves that amount and a concurrency slot against the team's budget.
2. The provisioner creates the machine only after the reservation succeeds.
3. After the provider reports usage, the ledger reconciles the reservation to actual spend.
4. A team at its hard budget cannot start new work. A running attempt that reaches the cap takes the
   graceful stop and archive path. Archive storage keeps accruing, and the admin sees that.
5. An admin can change future limits. No client can bypass a stopped budget.

The ledger lives in the account service. The team Node asks for admission and reports activity, but
the account service decides.

## Failure and operations contract

- Back up the team Node's volume in its region, and test restore regularly.
- Encrypt archives with team-scoped keys. Audit access and deletion.
- Keep billing rows out of Node backups and task bytes out of control-plane logs.
- Record provisioning duration, failure class, worker activity, archive lag, restore time, relay
  health, regional placement, and provider charges. Never log code or prompts.
- Capacity, storage, and spend limits fail admission visibly before starting a task that cannot
  finish.

## Verify before building

Recheck every provider fact in the table above and every price. Measure a representative workload:
boot time, setup time, CPU and memory over a typical agent run, archive size, and relay bytes.
