# Host changes, in phases

Status: proposal, 2026-08-22. Nothing here is scheduled. Phases land in the order below —
[README.md](./README.md) § Sequencing rules says why. Line references were verified 2026-08-22;
treat them as hints and the decisions as durable.

## Phase 0 — de-provider the shared ACP path

Pure refactor inside plugins/agents, no behaviour change, proven by the existing suite.

- **The normalizer stops saying "Claude".**
  `plugins/agents/src/main/drivers/acpNormalizer.ts` writes "Claude updated a file.",
  "Claude switched to mode …", and "Claude session title: …" into user-visible strings (lines 114,
  152, 156 at verification). Those become the harness label, passed in — the normalizer is the
  shared half of the generic driver and may not know whose events it is normalizing.
- **The descriptor's capability list becomes derived.**
  `claudeDriver.ts` hardcodes a twelve-entry capability array in `probe()` (line 109) even though
  `start()` negotiates `initialize.agentCapabilities` a screen later (line ~195). The generic driver
  derives capabilities from the `initialize` response plus declared quirks; a hardcoded list on a
  generic driver would be a lie about every harness at once.
- **Drivers get disposed like profiles.**
  `plugins/agents/src/node/index.ts` keeps profile disposables and releases them in `dispose`
  (lines 19-22, 156-157) but never unregisters drivers — a module-level `driversRegistered` boolean
  (lines 24-34) papers over the double-boot case instead, so a reload keeps the first boot's
  factories. Keep the disposables `register` already returns; delete the boolean.

## Phase 1 — the generic driver

One `AcpDriver`, constructed from a launch spec instead of subclassed per provider:

```ts
type HarnessLaunchSpec = {
  id: string
  label: string
  spawn: { command: string; args?: string[] } | { entry: string; args?: string[] }
  env?: Record<string, string>
  envPassthrough?: string[]
  quirks?: { manualCompaction?: boolean; sessionPersistence?: boolean }
  probes?: { usage?: string; auth?: string }   // routes on the contributing plugin's node half
}
```

- `AgentDriverRegistry.register` (`plugins/agents/src/main/drivers/registry.ts:6`) accepts a spec.
  The factory form survives for tier 2: `registerNative(providerId, factory)` — the rename is the
  point, a native driver is a deliberate act with a different name.
- **Claude becomes the first spec.** Its spec carries the adapter entry
  (`@agentclientprotocol/claude-agent-acp/dist/index.js`, resolved host-side because it is a desktop
  dependency — `apps/desktop/package.json`), the `CLAUDE_CODE_*` passthrough, the
  `CLAUDE_CODE_EXECUTABLE` env, and its auth probe. The env comment in `claudeDriver.ts:144-151`
  (broker-env, never `ANTHROPIC_*`) moves to the generic driver and becomes the rule for every
  harness: passthrough is for tool configuration, never credentials.
- **Codex is untouched.** `codexDriver.ts`, `codexNormalizer.ts`, `jsonRpcProcess.ts` stay as the
  tier-2 worked example.
- Proof: existing agents tests green, Claude sessions unchanged end to end.

## Phase 2 — open the closed literals

Every place a third harness currently hits a wall. All inside plugins/agents:

- `src/shared/usage.ts:4` — `AgentUsageProviderId = 'claude' | 'codex'` widens to `string`; the
  hardcoded collector record in `src/main/usage/service.ts:56` becomes a registry keyed by harness
  id, fed by built-in collectors and by `probes.usage` routes for contributed harnesses.
- Client branches on the two ids — labels and icons come from the descriptor instead:
  - `src/client/usageModel.ts:66,70` — the `(['claude','codex'] as const)` walk and the ternary label.
  - `src/client/AgentCenter.tsx:242` — the `'C' : '⌘'` icon ternary becomes the harness glyph
    (`brand:<pluginId>` from the manifest icon, resolved by the existing icon-name resolver).
  - `src/client/AgentUsageSection.tsx:9`, `src/client/AgentPricingSettings.tsx:117` — same treatment.
- Nothing in protocol changes: `providerId`/`profileId` are already plain strings in
  `packages/protocol/src/managedAgents.ts` (lines 99, 211-212). That is what kept the durable model
  open; this phase makes the edges match it.

## Phase 3 — the manifest carrier

The descriptor, its validation, its delivery, and its trust record. Four pieces, one change set.

**The descriptor.** `harnessDescriptor` joins the roster in
`packages/protocol/src/pluginContract.ts`, and the `contributions` looseObject (line ~534) gains
`harnesses` capped at 4, with the convention-required doc comment naming its ctx twin and owning doc
(this folder, until it graduates). Shape: the `HarnessLaunchSpec` above plus `terminal?` for the
interactive profile's data parts (command, backendPreference, launchArgs — the code-carrying parts
of `AgentProfileContribution` have no manifest form, authoring.md § What a data-only harness does
not get).

**Cross-field rules.** In `packages/node-core/src/main/pluginManifest.ts` (`superRefine`, line 60):
`spawn.entry` must be package-relative like every code entrypoint; `probes.*` routes are confined to
`/v2/p/<id>/`; declaring `probes` requires a `node` entry, the same rule `taskChecks` already
carries; harness ids unique within the manifest.

**Delivery.** Harnesses become the fifth manifest kind that crosses into the node host —
`apps/node/src/server/composition.ts:53-61` currently projects `schedules`, `collections`,
`commands`, `taskChecks`. A dispatch helper in `packages/node-core/src/server/plugin/host.ts`
(pattern: `registerManifestSchedules`, lines 172-187) delivers each descriptor to a capability
plugins/agents publishes — working name `agents.harnessRegistry`, declared beside `AGENT_USAGE`
(`plugins/agents/src/server/routes/usage.ts:15`). Resolved at delivery time, never cached at
registration: agents disabled means the same silent nothing every unmatched contribution gets, and
re-enabling redelivers. The host mints the runtime id as `<pluginId>:<harnessId>` at this seam.

**Trust.** A harness names an executable acorn will run — that is the headline fact of the prompt,
and it goes under **Enforced**, honestly: the host spawns exactly the declared command with the
declared args and nothing else. New grant kind, and all four homes land in the same change, because
an unrecorded grant can never read as newly requested:

- `pluginHarnessGrants` in `packages/protocol/src/pluginGrants.ts`, grant key including the resolved
  spawn (`command` + args, or the entry path) so a changed command reads as new under the key-diff
  in `trustModel.ts:100-106`.
- Rendered in `packages/client-core/src/plugins/trustModel.ts` `trustTiers()` (Enforced block,
  lines 56-73).
- Persisted by `recordTrustDecision` (`trustModel.ts:117-141`).
- Stored in `apps/desktop/src/app/main/helper/pluginTrustStore.ts` schema (lines 63-77), `.default([])`
  like its siblings so old trust files stay readable.

**Golden lists.** Registering harnesses shows up in `pluginDisable.snapshot.json` and friends;
regenerate deliberately, in its own hunk, per plugins.md § The golden lists.

## Phase 4 — validation, outside-in

opencode as a data-only loaded plugin, written from [authoring.md](./authoring.md) by someone who
did not build the seam. Every question they have to ask is a docs bug or a seam bug, fixed before
the seam is called done. This phase also updates managed-agents.md § Providers: the "not a
contribution point" paragraph becomes a description of the two tiers, and this folder's design
graduates into the owning docs.

## Phase 5 — deferred: ACP's client capabilities

Independent of the plugin seam; recorded here so it is not relitigated. The driver currently
declines everything ACP offers the client side (`claudeDriver.ts:189-193`):

- `fs` — the agent asks acorn to read and write files instead of touching disk itself: one audit
  point, worktree confinement checked before the write instead of revalidated after, and the
  precondition for the agent process and the worktree living on different machines.
- `terminal` — agent-run commands go through acorn's process lifecycle and show up in the task's
  terminal surfaces instead of vanishing inside the agent.
- `mcpServers` — per-session MCP with the task-scoped internal token, replacing per-CLI config-file
  registration (`mcpRegistration` on the profile).

Each is worth doing on its own merits and none blocks, or is blocked by, harness contributions.

## Deliberately not built

- **An argv template language.** Headless/workflow argv assembly stays code, first-party. The
  manifest carries data a person can read, not a program in JSON.
- **Runtime fetch of the ACP registry.** The manifest is the pinned truth; launch args change by
  plugin update so the trust record sees it. proliferate's resolve-at-build-time pins are the model.
- **Moving Codex to ACP.** proliferate paid for that with a native fork reimplementation and an HTTP
  side-door; acorn keeps the native driver and the four features (fork, compact, archive, delete)
  it carries.
- **Enrichment hooks in v1.** The `enrich` shape is agreed (authoring.md § Optional code extras) and
  parked; baseline ACP is the v1 surface.
- **Moving plugins/agents to the loaded tier.** Ruled in compiled-tier.md, restated in README.md —
  the harness seam exists precisely so that never has to happen.
