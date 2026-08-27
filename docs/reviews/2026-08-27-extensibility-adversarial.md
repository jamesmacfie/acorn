# Adversarial review of extensibility, 2026-08-27

A read-only survey of the tree at `8e773d70`, measured against six things acorn is meant to grow
into: cloud run nodes with a control plane behind them, system monitoring, agent runs started by
events, plugin-to-plugin communication, richer workflow management, and agentic run applications
whose management and functionality come from plugins.

Most of that is not designed yet, and the findings do not design it. They ask a narrower question:
which decisions already in the code will have to be undone to get there, and which of those are cheap
to change today and expensive in six months.

The cloud offering is the exception, because it has a shape already. acorn stays open source and the
business is a hosted control plane, which has to be a plugin, because nobody is going to be stopped
from pointing acorn at a different cloud or writing their own. [The control plane, and how it stays a
plugin](#the-control-plane-and-how-it-stays-a-plugin) works that through, and
[Build-out phases](#build-out-phases) turns it into eight pieces of work that each leave the product
running as it does now.

It is a companion to [the architecture review](./2026-08-27-architecture-review.md), [the plugin
surface review](./2026-08-27-plugin-surface-adversarial.md), and [the security
review](./2026-08-27-security-review.md), and it does not repeat their findings. Where those asked
whether the surface holds for a plugin author, this one asks whether it holds for a plugin that runs
when nobody is watching, on a machine nobody is sitting at.

## The one framing that explains most of the findings

acorn currently gives two different answers to "who drives work when no window is open", and the two
halves of the codebase disagree in writing.

`docs/schedules.md` and `packages/node-core/src/server/schedules/scheduler.ts` say the node drives
it. `ctx.schedules` exists precisely because "a client closes, hides and sleeps, and a schedule is a
promise to run when nobody is looking". That is the right answer and the code is good.

`packages/client-core/src/registries/pollers.ts` says the client drives it. A poller runs on a
`window.setInterval`, skips every tick while `document.hidden`, and can be gated on `requires:
'desktop'`. Three pollers exist. Two of them, `taskStatus` and `workflows.triggers`, require a
desktop shell.

Both mechanisms are fine on their own. The problem is that the second one currently owns the
workflow trigger clock, which is the exact seam "agent runs based on events" has to be built on. So
today the answer to "what starts a run when something happens" is: a visible desktop window, polling
every 30 seconds.

Every future in the brief needs one answer, and it has to be the node's. The cloud offering makes
this urgent rather than tidy: a provisioned node with no client attached is a machine you are paying
for that will never do anything. Findings 1 through 4 are what the change costs, and phase 1 is where
it lands.

## What already holds

Worth stating first, because most of the machinery these futures need is present and well shaped.

The fan-out primitive in `packages/client-core/src/node/fanout.ts` was built for N nodes from the
first line. Per-node query caches, per-node timeouts, per-row freshness, and a partial-result banner
rather than a failed page. `nodeStatRegistry` and the attention registry already let a plugin put a
number and a row on every node's card without client-core knowing the plugin exists. When cloud nodes
arrive, the client half is done.

The harness seam in `packages/node-core/src/server/plugin/harnesses.ts` is the model the rest of the
plugin surface should copy. A harness is data, not code: a spawn spec, an env allowlist, declared
quirks, and two optional probe routes. The host mints the qualified id. A plugin adds a whole agent
CLI to acorn without shipping a line of host-side logic.

`ProviderRequestScheduler` in `server/integrations/budgetRuntime.ts` is a real two-level concurrency
governor, per provider and per connection, acquiring the narrower slot first so one connection cannot
starve the others. It is 40 lines and it is the correct shape for the resource governance every other
part of the system currently lacks.

The workflow runner's durability story is the strongest thing in the repo for these futures. Rows are
the checkpoint, budgets are persisted so a restart cannot reset the meter, and reconciliation sweeps
interrupted steps back to `pending` rather than repeating them blind.

`scopeCore` in `main/pluginPermissions.ts` gets forward compatibility right in the small: a manifest
naming a core facet this build does not have loses that one grant instead of failing to load. Finding
10 is about the three places that rule is not applied.

## Findings

### 1. There is exactly one door into the fleet, and the protocol says a second will never exist

The core schema has zero occurrences of `node_id`. Workspaces, projects, and tasks are node-local
rows with node-local UUIDs, and `docs/future/remote.md` states the consequence: nodes "have no peer
relationships at all", no shared database, no cross-node transaction. Each node also mints its own
`owner-<uuid>` at first boot in `main/core/identity/identity.ts`, so two nodes belonging to the same
person are strangers to each other. There is no account anywhere in the product.

None of that is the problem. The problem is one comment in `packages/protocol/src/broker.ts`:

> There is no "add this node with this token" shape. The only route into the fleet is
> probe-then-pair, which forces the fingerprint confirmation to happen.

That is a deliberate, correct, load-bearing refusal, and the security of pairing rests on it. A human
compares six words against the node's own screen, out of band, because reading a fingerprint over the
connection you are authenticating proves nothing.

It is also the single decision a control plane has to reopen, because a machine that a control plane
provisioned 40 seconds ago has nobody to read six words to.

Two supporting facts make this a seam question rather than a security question. `FleetBridge` in
`packages/client-core/src/platform/contract.ts` has nine members, `list`, `probe`, `pair`, `rename`,
`forget`, `reconnect`, `restartLocal`, `tunnelOpen`, and `tunnelClose`. It is a platform seam, so
only the desktop shell implements it and no plugin can reach it. Membership lives in
`fleet.json` in the helper's data root, holding the endpoint, the fingerprint, the certificate, and
the device id, at mode 0600. So today a plugin cannot add a node to the fleet, cannot see the fleet
except through `nodes()`, and has no way to vouch for one.

The right answer is not the one I would have given before knowing a control plane is coming, which
was "the client is the only coordinator". It is that there are three parties, and the third one is
optional:

- The **client** coordinates across nodes it can see. This is what `fanout.ts` already does.
- A **node** drives its own work whether or not anyone is watching. This is what the scheduler
  already does and what finding 2 is about.
- A **control plane** is a party a node can attach to and a client can ask for nodes. It holds
  metadata and vouches. It never sits in the data path.

Nodes still never peer. What changes is that "how did this node get into my fleet" gains a second
answer, and that answer is a plugin's.

The design and its phases are in [The control plane, and how it stays a
plugin](#the-control-plane-and-how-it-stays-a-plugin) below, because it is the largest single thing
this review has to say and it does not fit in a finding.

One thing to write down regardless, because it is free today and awkward later: every core id is a
UUID and must stay one, and a plugin table keyed on `taskId` must not add a node qualifier. That
keeps "move this task to another node" a copy rather than a re-key. `projects` is the only entity
with a natural key, `github_owner` plus `github_name`, and the casing gotcha there is already
recorded.

### 2. The trigger seam exists, has no registrations, and is clocked by a visible window

`WorkflowTriggerContribution` in `plugins/workflows/src/main/workflowContracts.ts` is the seam for
"start a run when something happens". `WorkflowContributionRegistry.registerTrigger` accepts them and
`WorkflowRunner.pollTriggers` at `main/workflowRunner.ts:173` walks them.

Nothing in the tree calls `registerTrigger`. Not one trigger exists.

The only thing that drives the seam is `plugins/workflows/src/client/triggerPoller.ts`, a
`PollerContribution` with `intervalMs: 30_000` and `requires: 'desktop'`, which the poller host skips
whenever `document.hidden` is true. The route it calls,
`POST /v2/p/workflows/workflows/triggers/poll`, refuses task-confined principals, so a running agent
cannot drive it either.

So the honest description of event-driven agent runs today is: a human has the desktop app open and
in the foreground, and every 30 seconds it asks the node whether anything happened. On a headless
node, nothing happens ever.

This pairs with finding 11 of the security review, where the agents plugin's outbound webhook service
is complete, has a better forgery guard than most production code, and no route reaches it. Two
independent pieces of event plumbing are built and unwired. That is not a coincidence, it is what
happens when the delivery model in `docs/future/events/delivery.md` has not been built yet.

The fix is small and it is available today. The node already has a scheduler with a plugin floor of
300 seconds, backoff, run rows, and an owner-visible pause. Register the trigger sweep as a plugin
schedule through `ctx.schedules` and delete the client poller, or keep the poller purely as a "check
now" nudge for a person who is looking. The evaluate-returns-matches shape stays exactly as it is,
which means this change is a clock swap, not a redesign.

### 3. The one generic "do a thing" primitive is welded to the scheduler

`runNodeAction` in `packages/node-core/src/server/nodeActions/registry.ts` is the whole vocabulary
for "make a plugin do something without a client attached". A plugin registers a name, a path, and a
risk tier. The host posts `Record<string, string>` to that path inside the plugin's own namespace and
treats anything other than a 2xx as a failure. It is a good primitive: the plugin cannot be made to
serve someone else's route, the risk tier is stamped onto the consent record at creation, and an
undeclared tier fails safe at `execute`.

It lives in `server/nodeActions/` but its only caller is `server/schedules/nodeAction.ts`, and its
registration seam is documented entirely in terms of schedules. `ctx.nodeActions` says "which of this
plugin's chrome actions a user may put on a schedule".

Every future in the brief is a different trigger against the same actions. An event fires, a monitor
crosses a threshold, a webhook arrives, a run finishes, and something should happen. Today the cross
product of triggers and actions has exactly one cell filled in, and the filled cell owns the
vocabulary.

Separating them is cheap right now because there is one caller. Two changes, neither of which touches
a plugin: reword `ctx.nodeActions` to say "work this plugin will do when something asks", and give
`runNodeAction` a caller that is not the scheduler, so the coupling cannot quietly re-form. The risk
tier becomes more useful the moment there are two callers, because "a person armed this on a timer"
and "an event armed this automatically" deserve different confirmations, and the tier is already
there to hang that on.

### 4. Capabilities allow one provider per id, and they are the only node-side seam between plugins

`CapabilityRegistry.provide` throws if an id is already taken, and the comment explains why: the
winner would depend on plugin init order. That is correct for what a capability is, a named typed
function with one owner.

It is also the only way two plugins can meet on the node. There are 13 real capability ids in the
tree. The client has a genuine many-to-many seam, `extensionPointRegistry`, where plugin A opens a
qualified `<ownerId>:<pointId>` point and any number of plugins deliver rows into it. The node has no
equivalent.

The consequence is already visible. `WorkflowContributionRegistry` is a hand-rolled many-provider
registry for step kinds, policies, and triggers, private to the workflows plugin, with its own
duplicate check and its own disposer convention. `WORKFLOWS_RUNNER` exposes only `reconcile()`, so
nothing can reach it. `docs/future/orchestration.md` asks for `registerStepKind` on that capability so
the HTTP plugin can contribute an `http` step. That request is right, and granting it one plugin at a
time is how you end up with five private registries that each got the lifecycle slightly different.

Every future in the brief is many-to-many on the node. Many monitors. Many event sinks. Many run
backends. Many step kinds.

I would build the node-side twin of extension points before granting the one-off. It is the same
model that already works on the client: the host mints `<ownerId>:<pointId>`, contributions are
ordered, duplicate ids from one plugin are refused, and everything disposes on unload. It replaces
`WorkflowContributionRegistry` rather than sitting beside it, so the count of mechanisms stays flat.

Two smaller notes on the same seam. Capability ids for cross-plugin use are effectively first-party
only, because 11 of the 13 live in `plugins/*/src/contract/` modules a loaded plugin cannot import,
which the plugin surface review covers as its finding 3. And a plugin that wants to be a *provider*
of something the host resolves has no way to say so in its manifest, because
`permissions.node.capabilities` describes consumption.

### 5. There is no core noun for a run

Three parts of the system already model "a thing that started, took time, cost money, and ended", in
three separate SQLite files:

- `workflow_runs` and `workflow_steps`, owned by `plugins/workflows`.
- Agent sessions and their turn ledger, owned by `plugins/agents`.
- `schedule_runs`, owned by core, in `server/db/schema.ts:323`.

Nothing can list them together, because one database file per plugin means no joins. Nothing can
apply a budget across them. `MAX_CONCURRENT_HEADLESS = 4` and `MAX_FAN_OUT_TASKS = 12` are workflow
ceilings, and an agent that calls a spawn tool in a loop is bounded by neither, which
`docs/future/orchestration.md` already identifies as the reason it recommends the implicit-run model.

"Agentic run applications with management and functionality provided by plugins" is a sentence whose
central noun is *run*, and the noun does not exist. If plugins are going to provide the functionality,
then the run is the thing the host has to own, the same way it owns the task.

The lazy version is a registry, not a table, and it matches three patterns already in the tree. A
plugin declares "here is the route that lists my runs" the same way `ctx.collections` declares "here
is the route that lists my rows", and the host merges. That gets a unified run list, a fleet-wide run
count on the node card, and a place for an agent tool to ask "what is running" without any migration
or any cross-plugin database access.

A core table becomes necessary at exactly one point, and it is worth writing down so the trigger is
recognised: when something outside the owning plugin has to cancel a run or charge it against a shared
budget. Cancellation and money are the two things a pointer cannot do.

### 6. Every plugin broadcast goes to every connected client

`wsBroadcast` at `packages/node-core/src/main/wsHub.ts:89` walks every open socket, skips the
task-confined ones, and sends. That is the entire delivery model for `ctx.events.send`. There is no
per-socket subscription, no filtering by what a client is showing, and no backpressure. The one
exception is the PTY stream path, which has per-session sinks and is available only to the single
compiled-in plugin that owns `ctx.events.streams`.

For the current traffic this is right, and `docs/future/events/README.md` defends it well: the
admission rule says human-scale only, payloads carry state rather than deltas, and a client that
misses a frame refetches. Per commit yes, per container health check no.

System monitoring is per container health check. So is tailing a cloud run. Both are machine-scale
streams that one pane wants and every other client should never receive, and the transport that
serves them is reserved for one compiled plugin.

I am not asking for a subscription protocol today. I am asking that the gap be recorded next to the
admission rule, because right now the rule reads as a design principle when part of it is a transport
limit. The difference matters when someone proposes the monitoring plugin: "we decided against
machine-scale events" and "the socket cannot carry them" lead to different next steps.

The cheap half is already identified in the events folder and is worth doing regardless: a loaded
plugin can push on `plugin:<id>:<verb>` and its own frames can subscribe, and no plugin in the tree
uses it. The cheapest publishing mechanism acorn has is idle.

### 7. `ctx.events` is send-only, and carries one plugin's vocabulary

`PluginBroadcast` in `server/plugin/types.ts` has `send`, `status`, `notice`,
`repoConfigTrustNotice`, `stepEvent`, `channel`, and `streams`. No `on`, no `subscribe`, no `once`. A
plugin's node half reacts to its own routes, its own schedule ticks, and five single-slot capability
hooks. That is the whole list, and `docs/future/events/subscriptions.md` covers it as the piece to
build last.

The part not covered is what is already on that surface. `notice(taskId, kind: 'gate' | 'run-done',
title)` and `stepEvent(runId, stepId, event)` are the workflows plugin's domain vocabulary, sitting on
the context object every plugin receives, with `runId` and `stepId` in the signature. So the generic
event surface is specific, and the generic mechanism next to it, `channel`, is compiled-tier only.

These names are on the `plugin-api` snapshot, which means the compatibility ratchet in
`surface.test.ts` will refuse to drop them once the major stops moving. Both moves are cheap now and
blocked later: relocate the two workflow verbs behind a capability the workflows plugin provides, and
land the `on` side of `PluginBroadcast` before there are out-of-tree plugins compiled against the
send-only shape.

### 8. Client capability gating is a closed two-key type, and one key names a plugin

`packages/client-core/src/capabilities.ts` defines `Capabilities` as exactly two booleans, `desktop`
and `terminal`, and `ClientCapabilityRequirement` as one of them or `'none'`.

> **Updated 2026-08-27**, after the consistency review's findings 1 and 8 landed. The file is
> `hostCapabilities.ts` and the three names are `HostCapabilities`, `HostCapabilityRequirement` and
> `hasHostCapability`. That is a rename, not a fix: the type is still a closed two-key union and
> everything below still holds. The count is 20 `requires: 'desktop'` sites, not 14. A rail source's
> provider gate moved out from under the word "capability" and is now `requiresProvider`, typed as a
> `ProviderCapabilityName`, which is a different question from either key here. The `terminal` answer is
literally `!disabledNodePlugins().includes('terminal')`.

So a contribution can say "only show me if this node runs the terminal plugin", by name, hardcoded,
and cannot say that about any other plugin. A monitoring pane that needs the docker plugin, a run
control that needs the workflows plugin, and anything at all that needs a third-party plugin have no
way to declare it. A contribution also cannot require two things.

The mechanism to generalise it is already sitting in the same file. `disabledNodePlugins()` is a
signal that answers the question for any plugin id, so `requires: { plugin: 'terminal' }` is a small
change today. It gets expensive once contributions across the tree and in out-of-tree plugins have
`requires: 'terminal'` written as a literal, and the comment above the type shows this has already
been got wrong once and fixed once.

The `desktop` key is a different question and should stay a boolean. The comment is right that it
should be reached for sparingly, and the 20 `requires: 'desktop'` sites in the tree are worth a
periodic re-read, because each one is a surface a web or cloud client will not have.

### 9. Plugins cannot write to the audit trail

`AuditAction` in `server/audit.ts:12` is a closed union of 15 dotted verbs, and the comment gives a
good reason: "an action nobody can enumerate is one nobody reviews". There is no `ctx.audit`, and
`recordAudit` appears nowhere in `plugin-api` or in any plugin.

The 15 actions cover pairing, devices, secrets, config trust, plugin lifecycle, and backups. Every one
is something the host does. Nothing a plugin does is on the trail.

For a product where plugins provide the functionality and agents drive it, the trail is the management
surface, and it currently stops at the boundary where the interesting things start. An agent spent
$4 on a run, a workflow pushed a branch, a monitor restarted a container, and the audit table has
nothing to say about any of it.

The closed-set argument survives a plugin-owned extension intact. A plugin declares its actions in its
manifest the way it declares schedules and harnesses, the host qualifies each one with the plugin id,
and the settings surface can still enumerate the whole vocabulary, because it came from manifests the
host parsed. Same trade the harness registry already makes, and the same reason it works there.

### 10. Forward compatibility is tolerant in three places, silent in all three, and brittle in the coarsest one

Four mechanisms decide what happens when a plugin knows about something this build does not:

| Mechanism | Behaviour |
| --- | --- |
| `scopeCore`, unknown core facet | Ignored, plugin loads without that grant |
| `ScheduleRow.kind`, unknown target kind | Retained inert, `registered: false`, row still renders |
| Manifest parse, unknown key | Stripped by Zod, no diagnostic |
| `apiVersion`, any mismatch | Hard refusal to load |

The schedule row is the one that gets it fully right, because it keeps the thing, marks it
unrunnable, and shows it to the owner. The other two tolerant cases drop silently, so an author whose
contribution simply does not appear has nothing to debug against and no reason to suspect a version
gap. The plugin surface review covers the fourth row and recommends a range check, which I agree with
and will not restate.

The rule I would write down, once, and apply to all four: **unknown is retained and reported, never
dropped silently.** The reporting surface exists already. `recordSurfaceFailure` and the attention
inbox handle the "your contribution did not land" case for id collisions, and this is the same class
of event.

### 11. Smaller things

**Resource governance is per-plugin and ad hoc.** `MAX_CONCURRENT_HEADLESS = 4` and
`MAX_FAN_OUT_TASKS = 12` are workflow constants. The scheduler has its own cap.
`ProviderRequestScheduler` governs integration requests only. A cloud node running several plugins'
agent work has no ceiling that spans them, and the plugin API offers nothing to declare cost against.
This is not urgent, but it is the same shape as finding 5, and if the run registry gets built, the
governor belongs beside it.

**The WebSocket channel prefix is a global un-namespaced claim.** `events.channel('docker', ...)`
takes the token before the first colon, first come first served, in the same global map as `term`,
`workflow`, `plugins`, `plugin`, and `agent`. It is compiled-tier only today, so a stranger cannot
take one. The plugin surface review makes the case for namespacing pane and command ids while the
window is open, and this is the same door on the same hinge, with the added wrinkle that the six
current prefixes are pinned by a test that would need an alias map.

**`docs/mcp.md` still describes a tool surface that does not exist.** `docs/future/orchestration.md`
flagged this on 2026-08-21 and it is still there. Line 23 claims workflows, database, and Docker
operations are reachable by an agent. No registered tool touches any of the three, and the four
`run_*` tools are terminal run targets rather than sessions. Whoever builds the agent-driven half
will read that sentence and assume part of the work is done.

**`dashboard_measure_samples` is the only time series in the system, and it is keyed by
`panel_id`.** Hourly buckets, a signature hash that deletes the series when a panel's meaning
changes. That signature idea is good and worth keeping. The grain is wrong for anything that is not a
dashboard panel, so system monitoring will want its own store rather than a widened key, and it is
worth saying so before someone tries the widening.

## The control plane, and how it stays a plugin

The brief: acorn stays open source, the business is a hosted cloud offering, and that offering has to
be a plugin, because nobody is going to be stopped from pointing acorn at a different cloud or
writing their own control plane. A person signs in, sees their nodes, spins up new ones, and runs
agents on them. Somewhere in the cloud a database holds the metadata for all of that.

This section is the design that follows from those constraints and from what the code already does.

### What a control plane is here

Three parties, and the third is optional:

- The **client** talks to every node it can see, directly, exactly as it does today.
- A **node** owns its data and drives its own work.
- A **control plane** holds metadata about nodes and vouches for them. It is never in the data path.

The rule that makes everything else possible: **the control plane stores what it takes to find a node
and vouch for it, and nothing about what the node is doing.** Node inventory, endpoints,
fingerprints, enrollment records, provider handles, accounts, billing. Not tasks, not repository
contents, not agent transcripts, not run history.

Hold that line and three good things follow. The plugin stays replaceable, because nothing depends on
it having seen your work. The trust story stays sayable in one sentence. And "everything works as it
does today" stays literally true, because every `/v2` route and the WebSocket are untouched.

### The four verbs, and what each already costs

| What a person does | What acorn needs | State |
| --- | --- | --- |
| Sign in to the cloud | A credential-owning provider | Exists. `ConnectionProviderContribution`, with GitHub's device flow as the precedent and `SecretService` for custody |
| See their nodes | A plugin that can put nodes in the fleet | Missing |
| Spin up a new node | A node that can enroll with nobody watching | Missing |
| Run agents on a node | A node in the fleet | Exists. Nothing changes once the node is there |

So the host-side work is two seams. That is a small surface for what it unlocks, and it is small
because the fan-out client, the per-node caches, the standalone node tarball, and the agent routes
were all built for this shape already.

One caveat on signing in. A connection provider stores its credential in the node's database, so the
cloud account ends up owned by whichever node holds it, and by default that is the bundled local
node. That is fine for a first version, because the local node runs whenever the app runs. It stops
being fine the day someone wants to see their cloud nodes from a machine with no local node, which is
the same day the web client arrives. Worth knowing about, not worth solving yet.

### Seam one: a node provider

A plugin declares that it knows about nodes, and optionally that it can make and remove them.

Run it on the **node side**, on the local node, beside every other integration provider. The
credential stays server-side, the sync engine's serve-then-revalidate applies for free, and there is
no cross-origin problem. A renderer-side provider would put the cloud account token in the renderer,
which is the one place the architecture has always kept tokens out of.

A sketch, not a specification:

```ts
type NodeProviderContribution = {
  id: string                                            // host-qualified <pluginId>:<providerId>
  label: string
  list(signal: AbortSignal): Promise<ProvidedNode[]>
  // Declaring create makes this a machine provider, and the host then requires destroy.
  create?(spec: NodeSpec, signal: AbortSignal): Promise<ProvidedNode>
  destroy?(providerNodeId: string, signal: AbortSignal): Promise<void>
  start?(providerNodeId: string, signal: AbortSignal): Promise<void>
  stop?(providerNodeId: string, signal: AbortSignal): Promise<void>
}

type ProvidedNode = {
  providerNodeId: string                                // the provider's own handle
  nodeId: string | null                                 // acorn's, once the node has booted
  label: string
  endpoint: string
  fingerprint: string
  state: 'provisioning' | 'ready' | 'stopped' | 'failed'
  enrollment?: { deviceToken: string }
}
```

The create-obliges-destroy rule is worth stealing verbatim from
[DevPod's provider model](https://devpod.sh/docs/developing-providers/quickstart), where defining
`create` makes a provider a machine provider and `delete` becomes required. Validate the pair at
registration and a provider that can make nodes but not remove them is a load error instead of a
support ticket.

On the client, the fleet list becomes helper-paired nodes plus provider-listed nodes, with provenance
on each row so the UI can say where a node came from and which nodes vanish if a plugin is disabled.

### Seam two: enrollment with nobody watching

Invert the secret. Today the node mints a pairing code and a human carries it across. For a
provisioned node, the provisioner mints a token before the node exists and carries it in.

On first boot, given `ACORN_ENROLLMENT_TOKEN` and `ACORN_CONTROL_PLANE_URL`, the node:

1. mints its TLS certificate exactly as it does today,
2. issues itself a device token, which it already does for the launcher and prints in the handshake
   JSON line,
3. posts `{nodeId, endpoint, fingerprint, deviceToken}` to the control plane, authenticated by the
   enrollment token,
4. records the attachment in `node.json` and writes an audit row.

With neither variable set, none of this runs and every existing install behaves identically.

Then `FleetBridge` grows one member, and it is the second door the protocol comment says does not
exist: `adopt(record, deviceToken)`, reachable only for a record a registered node provider
produced.

### What this costs, said out loud

The control plane learns a device token for every node it provisioned, so **trusting your control
plane is the whole game.** That is the same inversion `docs/future/remote.md` already recorded for a
web client, where the node serves the app and per-bundle prompts stop being the real consent surface.
It belongs in `docs/security.md` next to that paragraph, written down, not discovered.

Worth buying back, because each is cheap: enrollment tokens are single-use and short-lived, the
attachment record is visible in the node's own settings and revocable there, a detached node keeps
working standalone, and `node.enrolled` and `node.detached` join the audit vocabulary.

Not worth buying: an allowlist of permitted control plane URLs. Whoever set the environment variable
already made that decision.

Out of scope for a first version, and additive later: reaching a node that has no public address. A
cloud node has one. A home node behind NAT needs the relay `docs/future/remote.md` describes, and
because a provider returns an endpoint without saying how it was obtained, a relayed endpoint slots
in without changing this seam.

### Prior art worth copying

**[Headscale](https://github.com/juanfont/headscale), the open-source reimplementation of the
Tailscale coordination server.** Open-source clients, a proprietary coordination server, and an
independent server implementation that unmodified clients can be pointed at. Tailscale works with the
project on compatibility and employs one of its maintainers. The lesson for acorn is not the
architecture, it is the consequence: the moment a third party can write a control plane, the
node-to-control-plane protocol is a public interface whether or not you version it. Own it
deliberately, in `docs/`, from the first commit.

**[DevPod providers](https://devpod.sh/docs/managing-providers/what-are-providers).** A provider is a
declaration plus a small set of optional commands, and which commands you declare decides what kind
of provider you are. That is the same shape as acorn's harness descriptors, which are a spawn spec
rather than code, and it is the right shape here too.

**Nomad and the CI runner families.** An agent registers with a short-lived registration token,
exchanges it for a long-lived credential, and heartbeats after that. The two-token split is exactly
why the enrollment token above is single-use and the device token is the durable one.

### The rule that keeps the seam honest

**The first-party cloud plugin must be a loaded plugin, built only from documented seams, with no
host privilege a third party cannot have.** Make that an acceptance criterion on every phase below.
If it needs one special host change, that change is the moat, and it will rot, because nobody outside
will ever exercise it.

That rule has a price worth knowing now. Three things a loaded plugin cannot do today all bite a
control plane. It cannot claim a WebSocket prefix, which is finding 11 here. It cannot reach the
`contract/` modules where 11 of the 13 capability ids live, which is finding 3 of the plugin surface
review. And it gets no TypeScript types at all, which is finding 2 of that review. The
declaration-only types package stopped being a developer-experience nicety when the business model
started depending on strangers writing control planes.

### The gap left open: where the account credential lives

The caveat above, that the cloud login lands in whichever node holds the connection, is worth being
precise about, because "we will fix it later" is only true if later is additive.

It is additive, and three constraints in phase 4 are what make it so. None of them costs anything
today.

**The client asks nodes, plural.** The fleet merge fans out over reachable nodes and unions what
comes back, rather than reading "the local node". Today exactly one node answers, so the two are
indistinguishable, and the lazy version is a one-line `clientFor(homeNodeId())` that quietly closes
the door. `fanout.ts` already does this shape for every other aggregate surface, so taking the harder
path costs a few lines and no new machinery.

**A provider may run anywhere.** Write into the contract that a node provider runs on some node, not
necessarily the one the person is sitting at, with no client necessarily attached. One sentence,
and it stops plugins baking in an assumption that is invisible until the day it is wrong.

**Node identity belongs to the control plane.** `providerNodeId` is the control plane's id for a
node, stable no matter which node asked. Two nodes signed into the same account then list the same
cloud nodes, dedup works on the client, and moving custody later renumbers nothing.

With those three in place, the credential can move without the `NodeProviderContribution` contract
changing at all. The custody seam it would move to already exists in a usable shape: `DeviceTokens`
in `packages/desktop-helper/src/main/deviceTokenStore.ts` is a scope-keyed store backed by a
`TokenCipher` the shell injects, with `available()` allowed to answer no. It is not plugin-reachable,
and making it so would be a fifth member on `PluginCustody` in the platform seam, beside
`trustRecord` and `devGrant`, which are the same shape of question.

The one decision that would break this, and the reason to write it down now: **do not make node
providers client-side.** It looks like the direct fix, and it is a second registration seam for one
contribution kind, which is exactly the two-tier overlap the plugin surface review documents as a
migration that hits a wall in both directions. Keep the provider on the node and let the credential
be the thing that moves.

Last thing worth saying, because it changes how much this matters. The scenario that really needs
node-independent custody is the web client, where the browser is the client and there is no local
node at all. That project already has to solve client-held credentials for node device tokens, which
is a strictly larger problem, and `docs/future/remote.md` has costed it. So this gap is not a
separate piece of work waiting to be scheduled. It is a rider on one that is already written down.
The two smaller scenarios are less alarming than they sound: a desktop whose local node is down is
broken for other reasons, and one login per machine is arguably the right model anyway, since that is
how device pairing already works.

## Build-out phases

Eight phases. Each one ships on its own, leaves the product working exactly as it does today, and
leaves one more part in place. Phases 1 through 3 are worth doing whether or not the cloud offering
ever happens.

### Phase 0: decide, and write it down

Three paragraphs across two documents, and no code.

- `docs/architecture-overview.md`: the three-party model, and the rule that the control plane holds
  metadata only and never enters the data path.
- `docs/security.md`: the trust inversion, next to the web-client paragraph that already describes
  its sibling.
- `docs/plugins.md`: the first-party plugin gets no privilege a third party lacks.

Done when someone can read those and correctly refuse a design that puts task data in the cloud.

### Phase 1: a node drives its own work

The prerequisite nobody will think of, and the reason to do it first: a provisioned cloud node with
no client attached is an idle VM you are paying for. Findings 2 and 3 in one phase.

- Move the workflow trigger sweep from the client poller onto `ctx.schedules`. The
  evaluate-returns-matches contract does not change, so this is a clock swap.
- Keep the client route as an explicit "check now" for a person who is looking, or delete it.
- Let `runNodeAction` be called by something other than the scheduler, and reword `ctx.nodeActions`
  to describe work rather than schedules.

Done when a headless node with no client connected fires a trigger and starts a run.

### Phase 2: a node can say who it is attached to

Still no control plane. This is the local half, testable against a stub.

- An optional attachment record in `node.json`: control plane URL, when, and which enrollment token
  id.
- A settings surface that shows it and can detach, where detaching revokes the device row and leaves
  the node fully working.
- `node.enrolled` and `node.detached` in `AuditAction`.

Done when a node with no attachment behaves identically to today, and one with a hand-written
attachment record shows it and can drop it.

### Phase 3: unattended enrollment

- `ACORN_ENROLLMENT_TOKEN` and `ACORN_CONTROL_PLANE_URL`, honoured at first boot, ignored when
  absent.
- The four-step enrollment above, single-use token, bounded retry, failure recorded and visible
  rather than a boot that hangs.
- A written, versioned protocol document with a JSON schema for the enrollment payload, because of
  the Headscale lesson.
- A stub control plane in the test suite: 50 lines that accept an enrollment and hand back an
  acknowledgement.

Done when a node booted in a container with the two variables set appears in the stub's inventory,
and one booted without them is unchanged.

### Phase 4: the node provider contribution

The seam a third party needs.

- `ctx.providers.nodes(provider)` on the node context. Host-qualified ids, disposal on unload,
  `create` obliging `destroy`, all matching how harnesses and collections already behave.
- A core route the client reads, and a fleet list that merges helper-paired with provider-listed and
  carries provenance per row. Fan out over reachable nodes and union the results, deduped on
  `providerId` plus `providerNodeId`, rather than reading the local node. See [the gap left
  open](#the-gap-left-open-where-the-account-credential-lives) for why this one line decides whether
  the credential can move later.
- `FleetBridge.adopt`, reachable only for provider-sourced records.
- A reference provider in-tree that reads nodes from a JSON file. Not a toy: it is the seam's only
  consumer until the cloud plugin exists, and it is what the tests run against.
- Audit `ClientCapabilityRequirement` while here. A cloud node has no desktop shell, and the 14
  `requires: 'desktop'` sites decide what a person sees when their active node is in a data centre.
  Generalising it to a plugin id, which is finding 8, belongs in this phase.

Done when the JSON-file provider puts a node in the picker and a task runs on it.

### Phase 5: lifecycle verbs

- `create`, `destroy`, `start`, and `stop` surfaced in the client against whichever providers declare
  them.
- Confirmations drawn from the `ToolRisk` tiers already used by `nodeActions`, because destroying a
  node is the most consequential button in the product.
- A provisioning state in the fleet row, so a node being built shows as building rather than offline.

Done when a person creates and destroys a node from inside acorn against the reference provider.

### Phase 6: make the third-party path real

The phase that turns "someone else could write one" from a claim into a fact.

- The declaration-only types package and the generated manifest JSON schema, from the plugin surface
  review. Now load-bearing rather than nice to have.
- Publish the node provider contract and the enrollment protocol in the plugin docs.
- Replace the exact-string `apiVersion` equality with a range check, before there is an ecosystem a
  bump would strand.
- Write a second control plane plugin, out of tree, against a stub server, using only the published
  surface. If it needs a host change, the seam is not finished and this phase is not done.

Done when that out-of-tree plugin enrolls and lists a node with no modification to acorn.

### Phase 7: build the business

The first-party cloud plugin and the service behind it. By this point acorn needs no further changes,
which is the whole point of the six phases before it.

### What is deliberately not in any phase

- **No accounts in core.** A node keeps minting its own `owner-<uuid>` and knows nothing about a
  cloud identity. The control plane holds the account-to-node mapping in its own database. This is
  what keeps a node fully usable with no account, which is the open-source promise.
- **No node-to-node protocol.** Nodes still never address each other.
- **No mirrored run state in the cloud.** "See my agents from my phone with the laptop closed" is a
  real want and it belongs to the relay and push work in `docs/future/remote.md`, not here.
- **No core `nodes` table.** The provider answers, the client merges, the helper stores what it
  adopts, and `node.json` gains one optional record. Nothing else needs a row.

## The rest, in order

The findings above that no phase depends on, cheapest first.

1. Build the node-side twin of extension points, and port `WorkflowContributionRegistry` onto it
   instead of granting `registerStepKind` as a one-off. One mechanism for many-to-many on the node,
   before there are five.
2. Move `notice` and `stepEvent` off `PluginBroadcast` and behind a workflows capability, before the
   compatibility ratchet pins them.
3. Write down the four-row table in finding 10 as one rule, and make the two silent cases report.
4. Add a run registry shaped like `ctx.collections`, so a plugin can answer "what am I running" and
   something outside it can ask. Not a table until cancellation or a shared budget needs one.
5. Give plugins manifest-declared audit actions, qualified by the host.
6. Fix the `docs/mcp.md` tool-surface sentence. One line, and it is wrong today.

Item 2 stops being possible the moment the plugin API major stops moving. The rest stay cheap.

## What I would not build

Beyond the four exclusions listed under the phases.

**A subscription protocol on the WebSocket.** Finding 6 asks for the limit to be recorded, not
lifted. Nothing in the tree needs machine-scale streaming yet, and the invalidation-with-no-replay
contract is load-bearing for everything that does exist.

**A core `runs` table.** The registry answers the read question, which is all anything needs today.
The table earns its place when something has to cancel a run it does not own, or charge one against
a budget it shares.

**A generic plugin message bus.** `docs/future/events/subscriptions.md` already refuses this with the
right argument: a producer announces state changes, and a consumer that needs a typed payload is
asking for a capability. Findings 4 and 7 stay inside that refusal.

**A hub node.** `docs/future/remote.md` costed this and it is a bigger change than web
authentication. A control plane is not a hub: it hands out addresses and vouches for fingerprints,
and then gets out of the way. The moment it starts proxying traffic it has become the thing that
document refused.
