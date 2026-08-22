# Harnesses as contributions

Status: proposal, 2026-08-22. Nothing here is scheduled. This folder designs the change
[managed-agents.md](../../managed-agents.md) § Providers already names as the open one: "Making the
driver registry a real contribution point is the change that would open this up." Where this folder
disagrees with [managed-agents.md](../../managed-agents.md), [plugins.md](../../plugins.md), or
[extensibility.md](../../extensibility.md), those win — they describe what is built; this describes
what to build.

## Why this, why now

acorn manages two harnesses, Claude and Codex, and both are wired by literal:
`plugins/agents/src/node/index.ts` registers each driver by name inside `init`. Adding opencode, pi,
Grok, or anything else means editing plugins/agents, which means only we can do it. The profiles
experiment already taught the half-lesson — each profile as its own workspace package read as an
extension seam and was not one, because everything that encodes provider knowledge stayed inside
plugins/agents. The packages were folded back in (managed-agents.md § Providers). The driver registry
is the seam that was never opened.

What changed is the evidence that a harness does not need to be code. The Agent Client Protocol
(ACP) normalizes exactly the hard parts — session lifecycle, streaming updates, tool-call lifecycle,
permission requests, plans, config options — and the field has converged on it:

- **emdash** (references/emdash) supports 35 harnesses; 22 of them speak ACP, and a natively-ACP
  agent's plugin is close to a one-liner (`createNativeAcpBehavior(() => ({ args: ['acp'] }))`).
- **bb** (references/bb) lets a user add an ACP agent through config alone: id, display name,
  command, args, env. No code, `acp-<slug>` provider id derived by the host.
- **proliferate** (references/proliferate) runs all five of its harnesses through ACP, resolving
  launch pins from the official registry at `cdn.agentclientprotocol.com/registry/v1/latest`.
- **cmux** (references/cmux) covers opencode and gemini with one generic ACP client file.

acorn is already most of the way there without having said so:
`plugins/agents/src/main/drivers/claudeDriver.ts` is an ACP client over
`@agentclientprotocol/sdk`, and `acpNormalizer.ts` already maps ACP session updates into the
normalized event vocabulary the transcript renders. What remains is to stop treating that driver as
Claude's and start treating it as the product's.
[ecosystem/references-survey.md](../ecosystem/references-survey.md) named this steal — "ACP as a
provider-plugin registry" — before this folder existed.

## The ruling — two driver tiers, permanently

**Tier 1: the generic ACP driver. A harness is data.** One driver, owned by plugins/agents,
constructed from a launch spec: a command or a package-relative entry file, args, an env passthrough
list, and a small block of declared quirks. Everything downstream — the normalizer, the durable
event ledger, the transcript, permission plumbing — is shared and already exists. This is the
default path for new harnesses and the only path open to loaded plugins.

**Tier 2: native drivers. First-party only, for what ACP cannot say.** Codex is the poster child:
its app-server gives acorn `thread/fork`, `thread/compact/start`, `thread/archive`, `thread/delete`,
and per-turn model/effort/permissions on `turn/start` — none of which ACP expresses. Proliferate
moved Codex to ACP anyway and paid by rebuilding fork natively and adding an HTTP side-door for
opencode; we decline that trade. A native driver is written when a vendor protocol carries product
value the generic driver cannot, and it lives in plugins/agents like the rest of the first-party
code.

**Claude migrates to tier 1.** It already speaks ACP through the packaged adapter; its driver
becomes the first launch spec, and the migration is the proof that the generic driver is real. Codex
does not move, deliberately, and the two of them ship as the worked example of each tier.

This mirrors the plugin system's own two-tier ruling (extensibility.md § Two tiers, permanently),
and the line is drawn by the same question: anything expressible as data plus async messages goes in
the open tier; what needs more stays first-party.

## What does not move

**plugins/agents stays first-party.** [compiled-tier.md](../compiled-tier.md) already rules it —
stream and surface owner, `AGENTS_RUNTIME` required by the composition root — and nothing here
weakens that. A harness contribution is a descriptor delivered *to* plugins/agents, not a fork of
it. The contributing plugin describes the spawn; plugins/agents owns the child process, the session,
and every byte of the transcript. This also answers the broker question before it is asked: the
process broker deliberately does not model long-lived agent drivers
(architecture-overview.md § Package boundaries), so a data-only harness plugin needs no `exec` grant
— it never spawns anything.

## The id constraint

A harness id is persisted, not displayed: it is stored as a session row's `profileId` and a workflow
step's `profile` (managed-agents.md § Providers). Renaming one is a compatibility break across every
stored row. Two consequences:

- Built-in ids (`claude`, `codex`, `claude-code`, …) are grandfathered as bare names.
- A loaded plugin's harness id is namespaced by its plugin id (`<pluginId>:<harnessId>`), minted by
  the host from the manifest the descriptor arrived under — the same rule extension points follow,
  and the same reason: a manifest cannot claim a name in someone else's space. bb's `acp-<slug>`
  derivation is the precedent.

## The files

| File | What it holds |
| --- | --- |
| `authoring.md` | The harness author's contract: the full opencode worked example, what you declare versus what acorn does, quirks, and the optional code-carrying extras. |
| `host.md` | What acorn changes, in ordered phases with the exact files, and what is deliberately not built. |

## Sequencing rules

- The phases in [host.md](./host.md) land in order. Phase 0 (de-provider the shared ACP path) and
  phase 1 (the generic driver, Claude as its first spec) are pure refactors inside plugins/agents
  and prove themselves against existing tests. Phase 2 (open the closed literals) unblocks phase 3
  (the manifest carrier); shipping 3 before 2 would deliver descriptors into union types that
  reject them.
- Phase 4 is the acceptance test, not a formality: opencode as a data-only loaded plugin, written
  outside-in from [authoring.md](./authoring.md) by someone who did not build the seam. The seam is
  not done until that lands without a question asked.
- Phase 5 (adopting ACP's client capabilities: fs, terminal, mcpServers) is independent of the
  plugin seam and can land any time after phase 1, or never — it is recorded there so it is not
  relitigated.

## Verify before building

Treat the decisions here as durable and the line references as hints. Before starting, re-census:

- `plugins/agents/src/node/index.ts` — drivers still registered by literal inside `init`, profiles
  registered beside them, and the module-level `driversRegistered` guard still present.
- `plugins/agents/src/main/drivers/types.ts` — `AgentDriver`/`AgentDriverSession` shape unchanged.
- `plugins/agents/src/shared/usage.ts` — `AgentUsageProviderId` still the closed
  `'claude' | 'codex'` union, and the collector record in `main/usage/service.ts` still hardcoded.
- `packages/protocol/src/pluginContract.ts` — the `contributions` looseObject and its descriptor
  roster; count them before adding the twentieth.
- `packages/protocol/src/managedAgents.ts` — `providerId`/`profileId` still plain strings (they
  are what keeps the durable model open; if someone has narrowed them, that is a regression to fix
  first).
- The `@agentclientprotocol/sdk` major in `plugins/agents/package.json` and the adapter package in
  `apps/desktop/package.json` — the spec moves; re-read the changelog before generalizing.
