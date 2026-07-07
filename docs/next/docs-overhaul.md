# Documentation overhaul — what goes stale, when, and the rule that prevents rot

**Status:** plan · **Date:** 2026-07-07 · **Companions:**
[implementation.md](./implementation.md) (the phases that invalidate docs),
the root [README.md](../../README.md) and [docs/](../) tree

The next version's docs cannot be written after the fact — by Phase 10 the
archaeology would take longer than the writing. This doc does two things:
states the one rule that keeps docs true during the work, and maps every
existing doc to the phase that invalidates it so the final overhaul is a
checklist, not an investigation.

## 1. The rule

**A phase PR that changes an architecture fact updates the doc that states
that fact, in the same PR.** Not a rewrite — a surgical edit plus, where the
old design is worth keeping for history, a dated "superseded by" banner. The
phase's done-criterion includes it. (This repo already follows the pattern —
docs/electron.md is a migration record, docs/next retires superseded designs —
so this is codifying, not inventing.)

Evidence this is needed: `docs/panes.md` says there are eight panes; the code
has ten ([inventories.md](./inventories.md) §3d). That drift happened in the
*current* regime, before any refactor multiplied the rate of change.

## 2. Stale-map: existing docs × phases

| Doc | Invalidated by | What changes |
| --- | --- | --- |
| `docs/architecture-overview.md` | every phase, esp. 1, 3, 10 | boot sequence (composition root), transport story (IPC→HTTP+WS), repo map (`core/`+`plugins/`); rewrite §-by-§ as phases land, full pass at Phase 10 |
| `docs/electron.md` | Phases 1, 3, 9 | preload/IPC sections shrink to the residue; add WS; `WebContentsView`; `node:sqlite` kills half the ABI section |
| `docs/frontend.md` | Phases 5, 6 | registries replace the pane/shortcut/palette wiring descriptions; startup-restore section rewrites around the pipeline |
| `docs/panes.md` | Phase 5 (already stale today) | pane list derives from the registry; fix the 8-vs-10 count *now*, don't wait |
| `docs/caching.md` | Phase 2 | serve-then-revalidate documented once (the engine), TTL table points at the cache-policy module |
| `docs/data-layer.md` | Phase 2 + data-model track | sync engine, lineage-declared cascades/prune/indexes, `workspace_config` |
| `docs/api-reference.md` | Phases 0, 3 | error envelope (`ApiError`), `requireUser`, plus every migrated IPC domain appearing as new routes — this doc grows the most |
| `docs/authentication.md` | Phase 3 | WS upgrade auth, the loopback threat model (fold in or link [security.md](./security.md)) |
| `docs/github-integration.md` | Phases 2, 7 | mirrored-resource descriptors; provider interface |
| `docs/integrations.md` | Phase 7 | The provider contract ([docs/next/integrations.md](./integrations.md)) replaces the bespoke Linear/Rollbar walkthroughs — descriptor, connection flow, capabilities, link identity, lifecycle |
| `docs/mcp.md` | Phase 4 | tool projection replaces the per-tool wiring description; risk tiers; dynamic availability |
| `docs/local-development.md` | Phases 3, 9 | `dev:node` browser mode graduates from caveat to supported path; ABI section shrinks with `node:sqlite` |
| `docs/diff-rendering.md`, `docs/ui-design.md` | mostly stable | touch only if decomposition track moves files |
| `CLAUDE.md` (repo map, commands, gotchas) | Phases 9, 10 | ABI gotcha rewrite (`node:sqlite`), repo map (`core/`+`plugins/`), schema-change workflow if lineage registry changes it |

## 3. New docs the phases create

Each lands with its phase, seeded from the docs/next design content (which is
*proposal* prose that must be rewritten as *description* prose — "the core
does X", not "the core should X"):

- `docs/plugins.md` — how to write a plugin: the contribution points, `ctx`
  services, the conformance suite, the litmus test. Source material:
  [extensibility.md](./extensibility.md) + [contribution-points.md](./contribution-points.md). (Phase 10)
- `docs/agent-tools.md` — the tool contribution shape, risk tiers, the three
  projections, how to add a verb. (Phase 4)
- `docs/integrations.md` (rewrite) — how to write an integration provider:
  the descriptor, connection flow, codecs, formatters, conformance. Source:
  [integrations.md](./integrations.md). (Phase 7)
- `docs/state.md` — the tier/scope/ownership model and reaction rules, as
  normative guidance. Source: [state-and-policies.md](./state-and-policies.md)
  + [ui-state.md](./ui-state.md). (Phase 6)
- `docs/testing.md` — how to run/extend the suites. Source:
  [testing.md](./testing.md). (with the smoke suite)
- `docs/security.md` — the shipped threat model. Source:
  [security.md](./security.md). (Phase 3)

## 4. The README overhaul (at Phase 10 / 1.0)

The README currently sells a PR-review tool with workspace features; the
product is an agent workspace ([acorn product shape] — the pitch order
inverts). The rewrite:

- **Lead with the workspace**: workspaces → tasks → agents/terminals/panes;
  PR review is the flagship pane, not the product.
- **Architecture paragraph** replaces the current one: one local server,
  HTTP + WS transport, plugin core, SQLite mirror — with the one-screen
  ASCII diagram from architecture-overview.
- **Feature list derives from the parity map** (extensibility §7) — it is
  already the honest feature inventory.
- **Getting-started stays three commands** (`pnpm i`, OAuth app setup,
  `pnpm dev`); the ABI warning shrinks or dies with Phase 9.
- Keep `docs/next/` linked as the design-history record; move superseded
  design docs there rather than deleting (the repo's existing convention).

## 5. What happens to docs/next itself

When a phase completes, its section in [implementation.md](./implementation.md)
gets a ✅-dated strikethrough header (the guide doubles as the progress
record), and the phase ticks its rows in
[feature-parity.md](./feature-parity.md) — that file is a live checklist
during the work and the parity record afterwards. When *all* phases land:
implementation.md, review.md, inventories.md, and feature-parity.md become
historical records (banner at top, kept); the design
docs (extensibility set, integrations, agent-runtime, performance, ui-state,
ux, security, testing) graduate into `docs/` per §3 and their docs/next
originals get "superseded by docs/X" banners. `docs/next/` ends as the durable record of
*why* the next version looks the way it does — which is exactly what it was
for the last migration (docs/electron.md's role today).
