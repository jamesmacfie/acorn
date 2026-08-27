# Plugin surface consistency, 2026-08-27

> **Implemented 2026-08-27.** All eight items under "What I would do, in order" have landed, plus every
> item under "Smaller things", batched into one `PLUGIN_API_MAJOR` bump to `3`. Two judgement calls
> worth recording: `ctx.log` was resolved by deleting it rather than by adding a lint rule, and the
> gating fields were made uniform on `requires` (the host's question, one answer everywhere) while
> `when` was deliberately left non-uniform, because it needs a draw-site context and some registries
> have none — that rule is now written down in `hostCapabilities.ts`. Brand marks and content links
> became named `ctx` members, so `ctx.contribute` is now unambiguously "a registry another PLUGIN
> published". One claim in "Documentation to update" turned out to be wrong: `docs/extensibility.md`
> carries no contribution-kind count, so finding 5 changed nothing there. The census and the findings
> below are left as written, so the numbers in them describe the tree at `0aa2372e`, not the tree now.

A read-only survey of the tree at `0aa2372e`, asking one question the other three reviews do not: is
the plugin surface one vocabulary, or several that grew next to each other? It counts what each seam is
actually used for, then looks for places where two names mean one thing, or one name means two.

It brushes against three findings already written up and does not repeat them. Capability id squatting
is finding 3 of [the plugin surface adversarial review](./2026-08-27-plugin-surface-adversarial.md).
Workflow verbs on `PluginBroadcast` and the two-key client gate are findings 7 and 8 of
[the extensibility review](./2026-08-27-extensibility-adversarial.md). The tier overlap and the
`ctx.contribute` counting leak are findings 4 and 5 of the former. Where my findings touch those, I say
so and add only what is new.

The headline: the node half and the client half each read as internally consistent, and they disagree
with each other in four places. The worst is the word "capability", which names three unrelated
mechanisms on the client and means the opposite thing on the node.

## The census

Node context, 14 members, counted by how many of the 21 plugins call each:

| Member | Plugins | Notes |
| --- | --- | --- |
| `core` | 14 | |
| `routes` | 13 | |
| `capabilities` | 10 | |
| `storage` | 9 | |
| `tools` | 7 | |
| `events` | 7 | |
| `providers` | 4 | github, linear, model-providers, rollbar |
| `taskChecks` | 3 | changes, docker, terminal |
| `contextSections` | 3 | github, memory, notes |
| `collections` | 2 | agents, github |
| `log` | 2 | github, memory |
| `schedules` | 1 | agents |
| `nodeActions` | 0 | see finding 5 |
| `harnesses` | 0 | see finding 5 |

Client context, 23 members, 20 of them named contribution points. The distribution is thinner. Seven
have exactly one consuming plugin: `integrationFlows`, `projectImporters`, `taskSlots`, `refPanels`,
`agentToolRenderers`, `nodeStats`, and `capability`. Five of those seven are GitHub alone or docker
alone. The busiest are `panes` at eight plugins and `persistedState` at five.

Barrel exports with no consumer anywhere in `plugins/` or `apps/`: 5 of 121 on `/node`, 12 of 166 on
`/client`, 5 of 59 on `/ui`, and 2 of 6 on `/ui/host`. That ratio is healthy and some entries are
deliberate, `PLUGIN_API_MAJOR` being documented as kept without a consumer. The client list looks more
like drift: `readDraft`, `writeDraft`, `sourceRegistry`, `PreviewState`, `PreviewViews`, and four
marker and panel types.

The shape worth noticing across both tables is that a handful of seams carry the system and a long
tail exists for one caller. That is not automatically wrong. `refPanels` has one consumer because one
plugin shows external items, and it would have three if Linear and Rollbar grew panels. But it does
mean the surface count overstates how much of the design has been exercised, which is the same worry
`docs/extensibility.md` raises under "Unexercised seams rot".

## What already holds

The ownership binding is consistent everywhere it matters. Every registration point that mints an
identifier binds the plugin name at the seam rather than trusting the entry: routes, schedules,
collections, integration flows, and the client's `providerId` check in
`packages/client-core/src/registries/plugin.ts`. The host owns every disposable on both sides, so a
re-activation replaces rather than appends. Both halves run the same two-pass lifecycle for the same
stated reason, and both document why the second pass exists.

`ctx.core` returning projections rather than rows is the single best decision on the node surface.
`ProjectRef` and `TaskRef` mean core can rename a column without breaking a plugin, and the six fields
on `TaskRef` are exactly what plugin code reads.

The `/client` and `/ui` split holds on a rule an author can apply without asking: is it a component.
The reason is mechanical, a barrel evaluates every module on it, so the rule cannot rot into taste.

## Findings

### 1. "Capability" names three unrelated mechanisms, and the two halves disagree about which

On the client, the word covers three things that have nothing to do with each other:

1. `requires: ClientCapabilityRequirement` in `registries/panes.ts`, `slots.ts`, `commands.ts`,
   `pollers.ts`, `settings.ts`, and `paletteRows.ts` gates on the platform. Is this a desktop shell,
   does this node run the terminal plugin.
2. `clientCapability(id)` in `clientCapabilities.ts` resolves another plugin's typed function.
3. `requiredCapability?: string` on `SourceContribution` asks whether the connected integration
   provider supports an operation. `tabs/sources.ts:39` resolves it through
   `has(source.providerId, source.requiredCapability)`.

The third is the one that will bite. It is the only gate in the whole registry set spelled this way,
it is an untyped `string` where its six siblings take `ClientCapabilityRequirement`, and its name is
one word away from the other two. A plugin author reading `requires` on a pane and `requiredCapability`
on a source has no way to know these are different questions with different answer types.

Then the node inverts the vocabulary. `ctx.capabilities` on the node means meaning 2, plugin-to-plugin
functions. On the client, meaning 2 is the one thing *not* called capabilities. Someone who learns the
node half and then writes a client half gets it backwards, and the type system will not stop them
because both spellings exist.

This is distinct from finding 3 of the plugin surface adversarial review, which is about whether a
loaded plugin can squat a capability id. That finding is about enforcement. This one is about a reader
being unable to tell three mechanisms apart by name, and it is cheaper to fix.

### 2. Two slot registries hold the same type, and one of them has a single row

`registries/slots.ts` declares both:

```ts
export type UiSlotContribution = {
  id: string; slot: UiSlotId; order: number
  requires?: ClientCapabilityRequirement
  when?: (context: UiSlotContext) => boolean
  component: Component<{ context: UiSlotContext }>
}

export type TaskSlotContribution = {
  id: string; slot: TaskSlotId; order: number
  requires?: ClientCapabilityRequirement
  component: Component<{ taskId: string }>
}
```

Five fields in common, out of six and five. The differences are the context the component receives and
a missing `when`. Against that, `UiSlotId` has five values and `TaskSlotId` has exactly one,
`task.footer`, contributed by exactly one plugin, docker's container badge.

The comment gives the reason, which is that a task slot should not have to thread shell callbacks it
does not own. That is a real concern and the answer is a narrower context, not a parallel registry with
its own id type, its own `Registry` instance, its own context member, and its own line in every
document that lists contribution kinds. One `slot` namespace where the id selects the context shape
does the same job.

The vocabulary drift between `UiSlotId` and the manifest's `slotDescriptor` is finding 4 of the plugin
surface adversarial review. This is the compiled-side half of the same story: before the two tiers can
agree on slot names, the compiled tier has to agree with itself.

### 3. The same periodic-work idea is called two things with two vocabularies

The node calls it `ctx.schedules` and takes `cadence: Cadence`, a budgeted union of `{ every }`,
`{ daily }`, and `{ weekly }` clamped on read to a 300 second plugin floor. The client calls it
`ctx.pollers` and takes `intervalMs: number`, raw, with no floor.

A plugin author wanting "do this every so often" has to learn which half they are in, then which of two
words and which of two shapes applies. Nothing about the concept changes across the boundary. What
changes is who is watching, and `docs/schedules.md` already states that distinction well: below the
floor a schedule is a poll, and polling is the client's job for a person who is present.

That argument justifies two *implementations* and two *cadence vocabularies*. It does not justify two
names. `ctx.schedules` on both sides, with the client's taking `intervalMs` because a renderer poll
genuinely is not a node cadence, keeps one word for one idea and lets the shapes differ where the
reason is real.

### 4. The client's capability seam is a quarter of the node's, and its only instance inverts the convention

The node gets an object:

```ts
capabilities: Pick<CapabilityRegistry, 'provide' | 'get' | 'require' | 'ids'>
```

The client gets a bare method that only provides:

```ts
capability<T>(id: ClientCapabilityId<T>, impl: T): void
```

To read one, a client plugin imports `clientCapability` from the barrel separately. There is no
`require` for the four plugins that cannot be disabled, and no `ids`. Same mechanism, described in
both files as a mirror of the other, with a quarter of the ergonomics and a different name.

The tree has 13 `capabilityId` declarations on the node and exactly one `clientCapabilityId`:
`WORKFLOW_CONTROL`. Its single instance also inverts the convention the node's own registry states in
a comment, that "the signature lives in the provider's contract/, never here". The key is declared in
`plugins/agents/src/contract/workflowControl.ts`, provided by workflows at
`plugins/workflows/src/client/index.ts:16`, and consumed by agents at `AgentTaskSidebar.tsx:49`. So the
declaration lives with the consumer, and the id string `workflows.control` names the provider.

Given the cycle-breaking rationale that motivated the whole mechanism, putting the key in the consumer
may well be correct here. But then the node's stated convention is wrong for the client, and nothing
says so. One instance is not enough evidence to pick a rule from, which is the argument for writing the
rule down before the second one arrives rather than after.

### 5. Two context members exist only for the host to call

`ctx.nodeActions` and `ctx.harnesses` have zero calls across all 21 plugins. Neither is dead. Both are
filled by the host from manifest data: `server/plugin/host.ts:281` synthesises node actions from
manifest command descriptors, and `apps/node/src/server/composition.ts:61` passes
`entry.manifest.contributions.harnesses` through.

`NodePluginContext` is the authoring type. A member on it reads as something you write, and these two
are something the host writes for you. `types.ts` says as much for `harnesses`, that it is "a
capability handover" with "no registry here", which is an accurate description of a thing that should
not be sitting between `taskChecks` and `contextSections` in an author-facing list.

The cost is that every count of the plugin surface is two too high, and every author reading the type
spends time deciding whether these apply to them. Move both to the host-internal shape that
`server/plugin/context.ts` builds, and leave the manifest as the only way to declare either.

### 6. `ctx.log` lost to `console`

Two calls to `ctx.log` in the whole tree, from github and memory. Nine bare `console.log`, `console.warn`,
and `console.error` calls in plugin node code, from agents, browser, github, and terminal.

The prefixed logger is the better thing and nobody reached for it. `PluginLogger` is
`Pick<Console, 'log' | 'warn' | 'error'>`, so the two are interchangeable at every call site, which is
exactly why the habit never formed: `console` is already in scope and costs nothing to type.

This one is not worth a rename. It is worth either an oxlint rule banning bare `console` under
`plugins/*/src/{node,main,server}`, or accepting that attribution comes from the file path in a stack
trace and dropping `ctx.log`. The current state, where the seam exists and four plugins ignore it, is
the only option that costs surface without buying attribution.

## Smaller things

**`ContextSectionContribution` names two different types.** One in
`node-core/server/agentTools/contextSections.ts:20`, one in
`client-core/registries/contextSections.ts:16`. Neither reaches a barrel under that name, so this is
internal, but the two `contextSections` context members do differ: the node declares a section that
assembles prompt text, the client registers a component that renders *inside* one, keyed by
`sectionId`. The client member is a slot with a section's name. `contextSectionSlots` would say what it
does and stop colliding with the node's member and the client's own `slots` family.

**`ctx.contribute` has two targets in the entire tree**, `brandMarkRegistry` and
`contentLinkRegistry`. Finding 5 of the plugin surface adversarial review covers why this makes the
contribution count wrong. The number is the new part: with 20 named members beside it and 2 uses, the
line between "gets a named member" and "goes through the escape hatch" is not drawn anywhere, and both
targets look like they should have names.

**The gating fields are three shapes for two questions.** `requires` is a capability check, `when` is a
predicate, and both appear on `panes`, `slots`, and `commands`. `sources` has `when` and
`requiredCapability` but no `requires`. `refPanels` and `extensionPoints` have `when` and no `requires`.
`taskSlots` has `requires` and no `when`. None of that follows from what the contributions are.

**Four context members break the plural-noun convention** without being registries, which is fine:
`core`, `storage`, `log`, and `events` on the node. Two break it while being registries:
`attention` should be `attentionSources`, matching its own `AttentionSourceContribution`, and
`persistedState` holds `PersistedStateSlice` entries. The client's `contribute` and `capability` are
verbs sitting in a list of nouns, which is a fair signal that they are not contribution points.

## What I would do, in order

1. **Rename `SourceContribution.requiredCapability` to `requiresProvider` and type it.** One field, one
   consumer in `tabs/sources.ts`, no plugin sets it today. Cheapest possible fix for the worst
   ambiguity, and it can land this week.
2. **Move `nodeActions` and `harnesses` off `NodePluginContext`.** Host-internal already in behaviour,
   two lines of type surgery, and every surface count gets more honest.
3. **Fold `taskSlots` into `slots`.** One consumer to migrate. Do it while it is one.
4. **Give the client `ctx.capabilities` the node's four methods** and rename `capability` to match.
   Additive if you keep the old name as a deprecated alias through one major.
5. **Rename `ctx.pollers` to `ctx.schedules`,** keeping `intervalMs`. Two consumers.
6. **Pick a home for client capability keys and write it in `clientCapabilities.ts`,** before there is
   a second one to be inconsistent with.
7. **Decide `ctx.log`:** lint rule or delete.
8. **Rename `capabilities()` to `hostCapabilities()`** so "capability" means one thing per side. This
   is the largest edit, 20 `requires: 'desktop'` sites plus the type, and it only pays off once the six
   above have landed.

Everything from 3 down is a breaking rename. `packages/plugin-api/src/surface.snapshot.txt` pins 415
export names and `surface.test.ts` fails on any change, which is the ratchet working: each of these is
a decision someone signs off on. The `ctx` member renames are the riskier half, because the snapshot
does not cover context members at all, so a loaded plugin compiled against the old shape fails at
runtime with no test to catch it. Batch them into one `PLUGIN_API_MAJOR` bump rather than dripping
them out.

The window matters. Every item here is cheap while the loaded plugins are the five in this repository
and expensive once anything out of tree is compiled against these names. The same argument the
extensibility review makes about `PluginBroadcast` applies to all of it.

## Documentation to update

None of the findings above are documentation bugs. But every fix is a documented contract, so the
edit is not done until these move with it.

Owning documentation, by finding:

- `docs/plugins.md` § The plugin API, § Activation, and § Collaboration rules. The context member
  tables and the capability rules are stated here, so findings 1 through 5 all land in this file.
- `docs/plugin-authoring.md` § The node half and § The client half, plus the worked example, which
  names `ctx` members directly.
- `docs/plugin-map.md` and `docs/plugin-map.html`. The orientation map tabulates all 14 node members
  and the 22 client members that are not `name`, and the HTML repeats those names inside its diagrams.
  Both halves need the same edit, and the SVG text is easy to miss.
- `docs/frontend.md` § Registries and plugins, for the slot and gating changes.
- `docs/schedules.md` § Cadence, if `pollers` becomes `schedules`.
- `docs/extensibility.md`, for the contribution-kind count, which finding 5 changes by two.
- `packages/plugin-api/src/surface.snapshot.txt`, regenerated, for any barrel rename.

**The four reviews under `docs/reviews/` are untracked.** `git status` shows the whole directory as
`??`, so none of this analysis is in the history yet. Commit them before acting on any of it, because
several findings here are explicitly scoped as "not repeating finding N of file X", and that
cross-reference is worthless if the file it points at is only on one machine.

Three of them need an edit when work here lands, because their findings overlap:

- `2026-08-27-plugin-surface-adversarial.md`, findings 3, 4, and 5. Finding 4's tier-overlap list names
  `taskSlots`, `pollers`, and `contextSections` as compiled-only kinds. Renaming or folding any of the
  three makes that list wrong.
- `2026-08-27-extensibility-adversarial.md`, findings 7 and 8. Finding 8 counts the client gate as a
  closed two-key type, which finding 1 here proposes to split, and counts 14 `requires: 'desktop'`
  sites where I count 20, so its arithmetic has already moved.
- `2026-08-27-architecture-review.md`, finding 5 on there being two plugin APIs, and finding 7 on docs
  carrying a second implementation of the design. Finding 7 is the general case of this section.
