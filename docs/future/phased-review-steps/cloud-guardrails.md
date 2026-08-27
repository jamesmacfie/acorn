# Cloud guardrails: constraints that are cheap now and a rewrite later

Part of [phased-review-steps](./README.md). The cloud offering (free open-source core, a paid
service that provisions and manages nodes) is not designed yet, and that is fine. What is not
fine is making it impossible by accident. Each rule below costs nothing to hold today and a
migration to retrofit, and each names the review or doc that established it plus a way to check
it is still holding. These apply to all work in the repo, not only the phases in this folder.

When [phase 5](./phase-5-control-plane-seams.md) item 5.1 lands the write-downs in
`docs/architecture-overview.md`, `docs/security.md`, and `docs/plugins.md`, those become the
owning statements and this file becomes their checklist.

## The rules

**1. Every core id stays a UUID, and no plugin table keyed on a core id adds a node qualifier.**
Source: extensibility review, finding 1. Node-local UUIDs are what keep "move this task to
another node" a copy rather than a re-key. `projects` is the only entity with a natural key
(`github_owner` plus `github_name`), and its casing gotcha is already recorded.
Check: new columns and plugin schemas in review; grep migrations for `node_id`.

**2. The control plane holds find-and-vouch metadata only, never task data, never the data
path.** Source: extensibility review, § What a control plane is here. Node inventory, endpoints,
fingerprints, enrollment records, accounts, billing: yes. Tasks, repository contents,
transcripts, run history: no. Hold this and the plugin stays replaceable, the trust story stays
one sentence, and every `/v2` route stays untouched.
Check: any design that syncs task-shaped rows to a service fails this by inspection.

**3. Fleet-shaped client reads fan out over reachable nodes and union the results.** Never
`clientFor(localNode)` for an aggregate surface. Source: extensibility review, § The gap left
open. Today one node answers so the two are indistinguishable, and the one-line shortcut is what
would quietly weld the cloud account to the local node. `fanout.ts` already does the right shape
for every existing aggregate.
Check: new aggregate reads in review; the fleet-merge code in phase 5 must dedupe on
`providerId` plus `providerNodeId`.

**4. A node provider runs on some node, not necessarily the one the person is sitting at, with
no client necessarily attached.** Source: same section. One sentence in the contract, and it
stops plugins baking in an assumption that is invisible until the day it is wrong.
Check: the `NodeProviderContribution` contract text carries the sentence.

**5. Node identity for provided nodes belongs to the control plane.** `providerNodeId` is the
control plane's id, stable no matter which node asked, so two nodes signed into one account list
the same cloud nodes and moving credential custody later renumbers nothing.
Check: the provider contract; client dedupe logic.

**6. Node providers are node-side, never client-side.** Source: extensibility review, the one
decision it flags as breaking everything else. A renderer-side provider puts the cloud token in
the renderer, the one place the architecture has always kept tokens out of, and creates the
two-tier registration overlap the plugin surface review documents as a wall in both directions.
The credential is the thing that moves later (the web-client custody work in
[remote.md](../remote.md) already has to solve the larger version); the provider is not.
Check: any client-side registration seam for node providers is a design smell to refuse.

**7. The first-party cloud plugin gets no host privilege a third party lacks.** Source:
extensibility review, § The rule that keeps the seam honest. If it needs one special host change,
that change is the moat, and it will rot because nobody outside exercises it. This is an
acceptance criterion on every phase 5 item and the reason phase 6.4 (an out-of-tree control
plane) is the program's acceptance test.
Check: diff the cloud plugin's imports and grants against what `create-acorn-plugin` scaffolds.

**8. Every `requires: 'desktop'` site and every renderer-clocked mechanism is a hole in the
headless story.** Source: extensibility review, findings 2 and 8. A cloud node has no desktop
shell and often no client attached; work that only happens when a window is visible does not
happen there. New desktop gates and client-side clocks need a recorded reason; node-owned
schedules are the default for anything that is a promise to run.
Check: the phase 4 audit records the baseline; grep for `requires: 'desktop'` and compare.

**9. Unattended paths must degrade to exactly today's behavior when unconfigured.** Source: the
enrollment design (with neither variable set, none of it runs) and the sandbox folder's
absent-not-permissive resolver rule. The open-source promise is that a node with no account and
no control plane is fully usable; any cloud-flavored code path that changes behavior for an
unenrolled node breaks it.
Check: boot tests on an unconfigured node before and after.

**10. Two-token enrollment: the enrollment token is single-use and short-lived; the device token
is the durable credential.** Source: extensibility review, prior art (Nomad, CI runner
families). Keeps a leaked provisioning secret from becoming a standing credential.
Check: the enrollment protocol doc and its tests, once phase 5.3 exists.

## What these deliberately do not constrain

- The shape of the paid service, its pricing, or its stack. Nothing in this repo should encode
  any of it.
- Accounts. There are none in core, and none of these rules requires adding one.
- The relay and web-client work in [remote.md](../remote.md). It has its own preparation items;
  rule 3 is where the two programs touch.
