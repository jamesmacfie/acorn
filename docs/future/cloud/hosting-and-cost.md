# Hosting, regions, cost, and speed

Status: proposed, 2026-09-29; candidates, pause, and an hourly cost estimate added 2026-10-08. This
file holds the provider choice, regional placement, the cost model, admission and budgets, and the
speed target. Provider facts here are dated. Recheck them before any phase relies on one.

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

Two choices keep [customer-owned compute](./refused.md#no-customer-owned-compute-in-the-first-release)
possible later, and both cost little now:

- Store the provider credential per team, even while every team uses Acorn's own account.
- Have each implementation declare what it supports: pause with memory, filesystem snapshots,
  containers inside the worker, per-machine egress rules, and the kernel features
  [isolation](./isolation.md) needs. The orchestrator and the client read the declaration and say
  what a task cannot do, instead of assuming every provider matches the first one.

## Candidates, as of 2026-10-08

The requirements that sort these: a region the team chooses in the US, EU, or APAC; a full Node that
runs for hours; enough Linux privileges for [isolation](./isolation.md); and pause, snapshots, and
Docker, so a cloud task feels like a local one.

| Provider | Fit | Concern |
| --- | --- | --- |
| Fly Machines | Explicit region placement, fast boot from a prebuilt image, volumes, per-second billing. Suspend saves memory to disk, and Fly documents resume in a few hundred milliseconds. Leading candidate. | Volumes are tied to one host. Egress filtering per machine is not documented. Resume from suspend is not guaranteed, and a forum reply reports a 2 GB memory cap for suspend that the docs don't state. Recheck. |
| Fly Sprites | Fast sleep and a persistent filesystem. | Fly support reported on September 11, 2026, that a caller cannot choose or move a Sprite's region. Fails the region rule. |
| E2B | US, EU, and APAC regions. Pause saves the filesystem and memory. Bring-your-own-cloud on AWS and Google Cloud for enterprise customers. | Built for sandboxes, not long-lived Nodes: check session length limits, kernel privileges, and Docker support. |
| Daytona | Stop, start, and archive states, snapshots, and custom regions on compute the customer provides. | Shared regions are `us` and `eu` only. APAC needs a dedicated region bought from Daytona. |
| Railway | Regional services. | Its VM primitive is in beta. |
| Vercel Sandbox | Region choice on every plan, persistent sandboxes, and snapshots kept per region. | Regions are iad1, sfo1, cle1, and cdg1 in the August 24, 2026 changelog, and the regions page lists three. No APAC. Recheck the 24-hour continuous-session limit. |

Set aside: Modal, because region choice needs a Team or Enterprise plan and its sandboxes default to
a five-minute lifetime; and Cloudflare Containers, because the Node would have to run behind Workers
and Durable Objects. exe.dev has no published regions and prices per person, but its one-second
clone of a whole machine is the model for the project snapshots under [speed target](#speed-target).

For more information, see [Fly Machines](https://www.fly.io/docs/mcp/deploy-on/fly-machine/),
[Fly suspend and resume](https://fly.io/docs/reference/suspend-resume/),
[the Fly Sprites regional answer](https://community.fly.io/t/wheres-my-sprite-in-the-world/28621),
[E2B persistence](https://e2b.dev/docs/sandbox/persistence),
[E2B bring your own cloud](https://e2b.dev/docs/byoc),
[Daytona regions and runners](https://www.daytona.io/docs/en/regions-and-runners),
[Railway pricing and status](https://docs.railway.com/pricing/plans),
[Vercel Sandbox regions](https://vercel.com/docs/sandbox/concepts/regions),
[Vercel Sandbox duration](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence),
[Modal Sandbox reference](https://modal.com/docs/sdk/py/latest/Sandbox), and
[Cloudflare Containers placement](https://developers.cloudflare.com/containers/platform-details/placement/).

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
- Can a worker run Docker? Projects whose setup starts a database or a Compose stack lose their
  development workflow on a provider that can't.
- Can a machine pause with its memory and resume later? How large a machine can pause, how long a
  paused machine is kept, and whether resume is guaranteed decide whether
  [pausing before archiving](./projects-and-tasks.md#pause-before-archiving) works.

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
4. A snapshot of each shared project's machine after its setup script ran, rebuilt when the
   lockfile changes, that new attempts start from. Storage per project, kept in the team's region.
5. A small warm pool of booted, unassigned workers per region. This costs money every hour, so
   record its standing cost before choosing it.

If a region misses the target, fund the warm capacity or publish a narrower target for that region.
Do not relax the target silently.

The target stops at an adopted worker, but a local task usually starts with its dependencies already
installed. A cloud task that spends minutes in its package install doesn't feel the same, which is
why lever 4 is on the list even though setup can run after adoption.

## What the customer pays for

- A monthly base plan per team, covering the team Node and the account service.
- Worker CPU and memory time, metered per second.
- Archive, artifact, and snapshot storage, per GB-month.
- Relay transfer, per GB.
- Model usage is not billed by acorn. Teams bring their own keys.

Recheck [Fly pricing](https://docs.fly.io/about/pricing) and [Railway pricing](https://docs.railway.com/pricing)
once phase 1 produces a workload trace, and set prices from measured cost plus margin.

### A task hour on Fly, estimated October 8, 2026

This is Fly's published rate card applied to one worker, not a measurement. It assumes 65 billed
minutes (an hour of work plus the five idle minutes before teardown), a 20 GB volume, and 1 GB of
outbound traffic. Package downloads are inbound, which Fly doesn't charge for.

| Worker size | Ashburn (`iad`) | Frankfurt (`fra`) | Sydney (`syd`) |
| --- | --- | --- | --- |
| `shared-cpu-4x`, 8 GB | $0.10 | $0.11 | $0.14 |
| `performance-2x`, 8 GB | $0.16 | $0.18 | $0.23 |
| `performance-4x`, 16 GB | $0.29 | $0.34 | $0.40 |

Compute is nearly all of each figure. Plan around `performance-2x`: Fly throttles shared CPUs under
sustained load, and a test run or a TypeScript build is sustained load. Other costs outside that
hour:

- The team Node runs all the time. A `shared-cpu-2x` with 2 GB is about $13.39 a month in Ashburn,
  plus its volume.
- A stopped or suspended machine's disk costs $0.15 per GB per month, so pausing 20 GB overnight
  costs about five cents.
- Model tokens are the team's own and usually cost more than the worker for the same hour.

Phase 1's workload trace replaces these figures.

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
