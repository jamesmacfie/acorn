# SmolForge integration

This folder is the working documentation for integrating SmolForge — the Cloudflare-hosted forge
in `forge/` (git Smart HTTP hosting, issues, pull requests, CI Actions, deploy previews, and AI
transcript hosting; live at forge.smol.ai) — into acorn as a plugin. It is written for the
agents and developers implementing the phases: each phase has its own file with enough context
to execute without re-deriving the analysis.

Read `forge/README.md` and `forge/llms.txt` first. `llms.txt` is the machine-readable API
reference (auth, PAT scopes, every endpoint); the phase files cite its sections rather than
copying them.

`forge/` is intentionally vendored as a read-only reference so integration work can inspect the
implementation as well as its API documents without depending on a moving remote checkout. It is
not acorn source: the workspace globs exclude it, Turbo and TypeScript do not build or test it, and
oxlint ignores it. Changes to the reference belong upstream; this repository ships none of it.

## Why this integration, and why it is the stress test

SmolForge exercises every seam acorn has for integrations, plus several it doesn't have yet:

- **Git hosting** — a forge repo is a plain git remote; acorn's projects model already supports
  "git folder with a non-GitHub remote" (clone, branches, worktrees, push). Works today.
- **Issues and PRs** — external provider data, the Linear/Rollbar shape: mirror into core's
  generic external-item store, promote items to tasks, render lists and detail panes.
- **Transcripts** — the novel one: SmolForge hosts AI session transcripts
  (`POST /api/repos/:owner/:repo/transcripts`, JSONL, optional `commit_sha` linkage, server-side
  secret masking). Acorn **runs** the agents, so acorn is the natural upload source — which
  requires seams into the agents plugin that nothing else has needed yet.
- **CI/checks and deploy previews** — status surfaces (badges, attention items, PR checks).

Because it touches everything, the gaps it exposes are the gaps *any* serious third-party
integration would hit. Every seam phase below is provider-neutral; SmolForge is the forcing
function, not the beneficiary of special cases.

## What already exists (no work)

- Non-GitHub git remotes: clone/branch/worktree/push (docs/projects/README.md — the "Git
  folder" tier).
- Provider registries: `ConnectionProviderContribution` / `IntegrationProviderContribution`
  (`packages/node-core/src/server/integrations/types.ts`), provider route projection, core
  secret storage.
- The generic external-item store and codec runtime that Linear and Rollbar use
  (`packages/node-core/src/server/integrations/itemStore.ts`, `resourceRuntime.ts`) — issues
  and PRs need no plugin database.
- Serve-then-revalidate sync (`packages/node-core/src/server/sync/engine.ts`, TTLs in
  `policy.ts`).
- The capability pattern for cross-plugin calls — `plugins/agents/src/contract/sessionExecute.ts`
  (`capabilityId<T>('agents.sessionExecute')`) is the model every new capability here copies.
- The task↔external-item linkage and `Task.origin`, which is already a plain `string` on the
  wire (`packages/protocol/src/api.ts`) — looser than the docs' "github-pr | linear | rollbar |
  local" wording suggests. The gap is in registered *behavior* for an origin, not the type.

## What the third-party plugin project covers (docs/third-party/)

Install/trust/permissions (phases 1–5), frame panes for issue/PR/transcript viewers (phase 3),
descriptor chrome — rail sources, badges, attention items (phase 4), and the
credential-injecting fetch broker (node-security.md) through which every authenticated forge
call flows: the plugin registers a credential slot for the PAT and **never sees the token**;
the broker enforces the manifest's `net` allowlist. The SmolForge plugin is the broker's first
real customer. Note the plugin does not *require* the third-party loader — see "Strategy" below.

## Status

| Phase | File | Status | Size |
| --- | --- | --- | --- |
| 0 — Remote-URL claim seam | [phase-0-remote-claim.md](./phase-0-remote-claim.md) | ⬜ Not started | M |
| 1 — Task-origin behavior registry | [phase-1-task-origins.md](./phase-1-task-origins.md) | ⬜ Not started | M |
| 2 — Node-side lifecycle capabilities | [phase-2-lifecycle-capabilities.md](./phase-2-lifecycle-capabilities.md) | ⬜ Not started | M |
| 3 — Transcript export capability | [phase-3-transcript-export.md](./phase-3-transcript-export.md) | ⬜ Not started | S |
| 4 — The SmolForge plugin | [phase-4-smolforge-plugin.md](./phase-4-smolforge-plugin.md) | ⬜ Not started | L |

Ordering: 0–3 are independent of each other and can run in parallel; each is provider-neutral
and useful without SmolForge. 4 requires all of them. None of 0–3 depend on the third-party
loader work.

## Strategy: first-party first

Build the plugin as a **compiled-in first-party plugin** (the Linear/Rollbar path: composition
lists, `plugins/smolforge/`), then use it as the dogfood candidate when the third-party
packaging phases (docs/third-party/) need a real plugin to load, distribute, and sandbox. Two
reasons: the seams (phases 0–3) are the actual work and are needed either way; and a first-party
build separates "does the integration work" from "does the loader work" — one variable at a
time. The phase-4 doc notes what changes when it is repackaged as third-party.

## Invariants

- **Provider-neutral seams.** No phase 0–3 change may mention SmolForge in core: remotes are
  claimed by pattern, origins by namespace, capabilities by id. The architecture test's
  enumerated-plugin-modules rule (docs/architecture-overview.md, "Who owns which contract")
  extends: core gains no `smolforge`-named module, ever.
- **Facets stay detected, never demanded** (docs/projects/README.md invariant). A provider claim
  enriches a project; failure to reach the forge never blocks git operations.
- **Provider data stays disposable.** Issues/PRs mirror into the external-item store and can be
  dropped and re-fetched; tasks, links, and transcripts-upload state are the durable rows.
- **Secrets have no read path.** The PAT lives in a credential slot; all forge traffic goes
  through the credential-injecting broker (docs/third-party/node-security.md). This holds even
  while the plugin is first-party — build against the broker from day one.
- **Capabilities are structured-clone-safe and async** (node-security.md design rules) — every
  capability added in phases 2–3 must survive a future process boundary.

## Reference documents

- `forge/README.md` — SmolForge architecture and feature surface.
- `forge/llms.txt` — API reference: auth (§ Authentication, § Personal Access Tokens; scopes
  include `repo:read`, `repo:write`, `transcripts:write`), Issues, Pull Requests, CI/CD Actions,
  AI Transcripts (upload/list/by-commit), Webhooks.
- `docs/third-party/` — plugin loading, sandboxing, permissions, node security.
- `docs/projects/README.md` — the projects model and its invariants (phases 0/1 shipped).
- `docs/integrations.md`, `docs/plugins.md` — current provider and plugin contracts.
