# Phased review steps: the cleanup program

Status: plan, 2026-08-28. This folder turns the five reviews in [docs/reviews/](../../reviews/)
into sequenced, self-contained work an agent or developer can pick up phase by phase. The reviews
stay the evidence; these files are the plan. Where a phase touches a design that another
`docs/future/` folder owns ([events](../events/README.md), [sandbox](../sandbox/README.md),
[ecosystem](../ecosystem/README.md), [split.md](../split.md), [bundle.md](../bundle.md),
[orchestration.md](../orchestration.md)), the phase file sequences the work and points at the
owning doc rather than restating it. Where this folder disagrees with an owning doc, the owning
doc wins.

## Why the phases are ordered the way they are

Two goals decide the order, and they mostly agree.

The first is the reviews themselves: roughly 40 findings across code, docs, API surfaces, plugins,
and the security model, some confirmed bugs and some structural drift. Confirmed bugs come first,
then the changes that get more expensive with every out-of-tree plugin, then the seams the future
features need.

The second is a business direction that until these reviews existed was written down nowhere: a
paid cloud service that manages nodes. Acorn core stays free and open source; the paid offering
provisions nodes in the cloud, runs agents and code on them, and lets an acorn client connect to
and manage them. The details are not settled and nothing in this folder builds the service. What
the direction does today is order and constrain the cleanup:

- A cloud node is a machine nobody is sitting at, so the security burn-down (phase 1) and node
  autonomy (phase 4) stop being hygiene and become prerequisites.
- The extensibility review establishes that the control plane must be a loaded plugin with no host
  privilege a third party lacks, which makes the plugin API integrity work (phase 3) a cloud
  prerequisite rather than ecosystem polish.
- A set of constraints costs nothing to hold now and a rewrite to retrofit later. Those live in
  [cloud-guardrails.md](./cloud-guardrails.md) and apply to every phase, including work outside
  this folder.

The full design for the control plane, the node provider seam, and unattended enrollment is in the
extensibility review's "The control plane, and how it stays a plugin" section. Phase 5 is its
implementation guide.

## The phases

| Phase | File | What it delivers | What it unblocks for the cloud offering |
| --- | --- | --- | --- |
| 0 | [phase-0-stabilize.md](./phase-0-stabilize.md) | The in-flight work committed, the reviews in history, a fully green test suite | A baseline the rest can be measured against |
| 1 | [phase-1-security.md](./phase-1-security.md) | The confirmed security findings closed, plus the loopback API gates and defaults | A node safe to run where nobody is watching |
| 2 | [phase-2-boundaries-and-tests.md](./phase-2-boundaries-and-tests.md) | Compiler-enforced package boundaries, a UI test tier, the Zod boundary rule, doc link checking | Confidence to refactor the seams the later phases need |
| 3 | [phase-3-plugin-api-integrity.md](./phase-3-plugin-api-integrity.md) | One plugin API a stranger can build against: published types, schema, version range, capability hygiene | The cloud plugin must be a loaded plugin; this is what makes that possible |
| 4 | [phase-4-node-autonomy.md](./phase-4-node-autonomy.md) | A node that drives its own work with no client attached | A provisioned cloud node that is not an idle VM |
| 5 | [phase-5-control-plane-seams.md](./phase-5-control-plane-seams.md) | Attachment, unattended enrollment, the node provider contribution, lifecycle verbs | The seams the paid service plugs into |
| 6 | [phase-6-distribution-and-third-party.md](./phase-6-distribution-and-third-party.md) | Published packages, downloadable nodes, signing design, the out-of-tree proof | A node artifact the service can provision, and proof the seams hold for strangers |

Phases 0 through 2 are strictly ordered. Phase 3 can start once phase 0 lands (it renames and
publishes surfaces, so it wants a green suite and a committed baseline, not phase 2's machinery).
Phase 4 items are individually independent and can interleave with phase 3. Phase 5 depends on
phase 4's autonomy items and on phase 3 for anything the cloud plugin itself will consume. Phase 6
runs partly in parallel (the bundle.md and split.md tracks have their own orderings) but its
acceptance test, an out-of-tree control-plane plugin, needs phases 3 and 5.

## How to work a phase

Each phase file lists work items with the review finding they close (review file plus finding
number), the code they touch, acceptance criteria, and the documentation that owns the behavior
afterward. Two rules from the repo's own conventions apply throughout:

- **Verify before building.** File and line references in this folder were checked against the
  tree on 2026-08-28, with the consistency-review batch and the rail-marker work present but
  uncommitted. Paths rot. Each phase file ends with a verify list; run it before writing code.
- **Update the owning doc in the same change.** A contract change is not done until
  `docs/security.md`, `docs/plugins.md`, `docs/extensibility.md`, or whichever doc owns the
  behavior says the new true thing. The architecture review's finding 7 (docs carry a second
  implementation of the design) is the standing reason.

## What this folder does not do

- It does not restate designs that have owning docs. The events catalogue, the sandbox design, the
  repo split, and the node packaging work all keep their files.
- It does not design the cloud service. No accounts in core, no control-plane server, no pricing.
  Phase 5 builds the seams; the service itself is the extensibility review's phase 7 and is out of
  scope here.
- It does not schedule anything. Like the rest of `docs/future/`, this is ordering and content,
  not dates.
