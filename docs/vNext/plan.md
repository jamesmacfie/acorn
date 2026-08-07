# Plan

## Approach: evolve, don't greenfield

The V1 codebase is already most of the way there: the service graph is Electron-free
(`app/service/runtime.ts`), features are foldered as plugins with registries, and boundaries are
test-enforced. vNext is a restructure + a transport swap + fleet features — done as phases on the
existing code, keeping the app shippable at every phase boundary.

Two clean breaks ride along (both make the work *smaller*):

- **New data root.** vNext never migrates V1 databases. First launch starts fresh; onboarding
  offers the config-only importer. V1's data is untouched, so "rollback" = run the old build.
- **`/api/v1` is removed** (all routes return 404, no token oracle), along with its bearer
  tokens and idempotency tables. Headless automation returns later as a first-class vNext
  decision if wanted.

Rules that hold through every phase:

- `pnpm lint`, `pnpm test`, and the e2e smoke suite green at every merge; the boundary test only
  ever gets stricter.
- One protocol, one Node implementation. No compatibility bridges between old and new transports
  beyond the phase that swaps them.
- Each phase ends with its tests merged, not promised.

## Phase 0 — workspace split

Restructure into the target monorepo shape with behavior unchanged:

- Create `packages/protocol` (Zod wire schemas — start by moving the existing shared contracts),
  `packages/plugin-api`, `packages/node-core`, `packages/client-core`; create `apps/node` from
  the existing service composition root and slim `apps/desktop` to Electron + renderer.
- Move the existing `src/plugins/*` folders to `plugins/*` packages mechanically — imports
  updated, no seam changes yet. Grandfathered cross-plugin imports move as-is under a temporary
  baseline that phases 2–3 drive to zero.
- Desktop packaging embeds the `apps/node` build artifact and spawns it (replacing the utility-
  process wiring); dev mode runs `apps/node` standalone with the renderer pointed at it.

**Exit**: app works exactly as V1 (e2e suite passes); `apps/node` runs standalone headless; new
boundary tests pass (roots, app→app import ban, protocol purity); Turborepo caches
build/lint/test per package.

## Phase 1 — protocol v2 and the fleet spine

Swap the transport to the vNext protocol and make the client multi-node:

- Node: TLS + pinned cert, `nodeId`, pairing endpoints, device tokens + revocation, `/v2` route
  mount, error envelope, idempotency middleware, events WS (notifications + stream frames),
  new data-root layout with the process lock.
- Client: renderer moves to the bundled `app://` origin; the main-process connection broker
  (pinning, tokens, per-node fetch/WS — architecture.md) lands here; fleet store (nodes,
  endpoints, pins, tokens in keychain), reconnect/refetch, `(nodeId, …)` cache keys,
  connection-state machine and staleness badges, node settings UI, pairing flow.
- **Auth swap**: the session-cookie/GitHub-OAuth login dies here. GitHub OAuth becomes an
  integration credential written to the node (client-side flow, plugin-inventory.md § github);
  login-gated UI is reworked around device identity. This is real budgeted work, not fallout.
- Local supervision: spawn, bootstrap handoff of endpoint + token, crash restart with backoff,
  recovery screen.
- Remove `/api/v1` and its tables.

Data roots created during phases 1–4 are **disposable** — internal builds, wiped freely. Nothing
promises schema stability until the Phase 5 release; that's what lets Phase 2 move tables into
plugin DBs without data migration. "Shippable at every phase boundary" means V1 users are
unaffected and the build is demoable, not that pre-release vNext data survives upgrades.

**Exit**: one client process drives the bundled node **and a second node on another machine**
concurrently — proven at the integration-test level plus a minimal node switcher in the dev UI
(the real fleet UX is Phase 4); pairing/revocation/reconnect/idempotency covered by integration
tests against a real node process on a temp data root; e2e parity suite green on the local node
(with login flows updated for the auth swap); revoking a device closes its open sockets
immediately and streams re-check within 60 s (both tested).

> **Phase 1 is done.** What shipped, where it deliberately stops short of the designs in this folder,
> and which test proves each exit criterion: [phase1-notes.md](./phase1-notes.md). Read it before
> "fixing" anything in Phase 1 that looks unfinished — several of those gaps are decisions with
> scheduled homes, and two (the internal principal's GitHub reach, and a standalone node wiring only
> the pure-Node bridges) are consequences a reader should know about before building on them.

## Phase 2 — core services and the plugin host

Build the seams plugins need, and pay down the V1 ownership debts:

- Land `NodePlugin`/`ClientPlugin` interfaces and per-plugin SQLite (each plugin's tables
  migrate out of the monolith into its own DB — a schema move, since pre-release data roots are
  disposable).
- Carry over the agent-tool registry and its three projections (MCP server with internal
  tokens, harness routes, permission UI) as the `tools` contribution point.
- Move misplaced authority into core: worktree/run-target/captured-command/config-trust routes
  out of terminal; fs confinement, git, process broker, secret use-scoping, http allowlists,
  scheduler as `CoreServices`.
- Shared UI kit into `client-core`: diff viewer, Monaco setup, xterm wrapper, data grid,
  wizard/form primitives.
- Capability + event registries with typed contracts; `contract/` entrypoints established.

**Exit**: every plugin initializes through the plugin API with its own DB; core services have
direct unit/integration tests (confinement, env allowlists, kill trees, secret non-disclosure);
the terminal scope-shed is complete; boundary baseline shrinks to only the edges scheduled for
phase 3.

> **Phase 2 is complete as of Phase 3's first work item.** Its one outstanding finding — no task-scope check
> on any plugin route — is fixed (phase3-notes.md § "The security fix, done first").
> Core services, the terminal scope-shed and scoped internal tokens
> are done; the plugin host works and one plugin is through it; eleven plugin databases, the `tools`
> contribution point, the UI kit and `ClientPlugin` are not.
> [phase2-notes.md](./phase2-notes.md) states exactly which, and records the divergences (no
> `plugin-api` package, no http-allowlist or scheduler service, no token expiry) plus one **breaking
> trust-model change**: an agent-spawned child can no longer spend the owner's GitHub credential.

## Phase 3 — break the coupling map

Work through the ~25 V1 cross-feature edges (table in plugins.md), in dependency order:

1. shell/palette stop importing feature UI (contributions only);
2. terminal ↔ agents (roster, handoff lease), changes/github → shared diff viewer;
3. notes owns its storage; memory + context consume capabilities; context sections registry;
4. github ↔ linear reference seam; preview → terminal runTargets; workflows owns its UI and
   consumes `agents.sessionExecute`; database → model-providers.

**Exit**: boundary-test baseline is zero — no plugin imports another outside `contract/`;
disabling any non-required plugin at startup leaves the rest working (automated test cycles
through each plugin disabled); per-plugin vitest suites pass against real temp data roots.

> **Phase 3 is done**, with one criterion met in part. Baseline is zero and the rule is now an invariant
> rather than a ratchet; the shell imports no feature UI; context sections are a per-plugin contribution
> point. The disabled-plugin cycle is proven on the NODE side against the real fifteen-plugin list and is
> **not** proven on the client side — vitest cannot import the client plugin list at all (no Solid transform,
> no DOM), and the fix is a dependency decision rather than a test.
> [phase3-notes.md](./phase3-notes.md) records that, the six edges and what each one actually was (four of
> the six were a file in the wrong package, not feature coupling), the divergences, and the one security gap
> left open on purpose: **a task-scoped agent can still prune the Docker daemon**.

## Phase 4 — fleet product surfaces

The user-visible multi-node experience:

- Fleet home with node cards; aggregated Agent Center, attention inbox, search with per-node
  fan-out, timeouts, partial-result banners, node badges.
- Workspace picker grouped by node; per-workspace restore keyed by node; offline/stale rendering
  everywhere per ui.md's vocabulary.
- Settings → Nodes (add/rename/revoke/unpair, fingerprint verification UX, identity-change hard
  stop) and Settings → Plugins (enable/disable per node).
- Preview tunnel for remote nodes (task-scoped, over the authenticated connection).

**Exit**: e2e suite covers two-node scenarios: same-UUID collision across nodes, node offline
(stale render + failed mutation kept as draft), revocation mid-session, aggregated surfaces with
one node down; a remote task's terminal/agent/preview work end-to-end over the LAN.

> **Phase 4 is done.** All six exit criteria are covered (twoNode.spec.ts is 12/12 with the smoke suite),
> and the three items earlier phases scheduled into this one — the client-side device-prefs tier, freshness
> beyond Phase 1's two render sites, and word fingerprints — landed with it, as did Phase 3's two open
> prerequisites. [phase4-notes.md](./phase4-notes.md) records the divergences (tunnels are a dedicated
> upgrade rather than multiplexed stream frames; the aggregated Agent Center is polled for non-active nodes;
> a plugin's enabled state is the NODE's) and, more usefully, the bugs the assertions found — five
> pre-existing (inbound WS frames ignoring their nodeId, `everOnline` shared across the fleet, module state
> surviving a node switch, an unclaimed HTTP upgrade leaking its socket, PullDetail wiping the user's text on
> a failed mutation) plus **fourteen from an adversarial review**, including a tunnel that survived device
> revocation, a preview that fell back to loading the CLIENT's own localhost, a plugin-disable that never
> applied on a node switch, and a `requireDevice` claim that was VACUOUS (deleting the real mount left all 26
> packages green). Three risks are accepted rather than closed and named there: **the client-side loopback
> tunnel listener is unauthenticated**, **there is no heartbeat on the events socket** (a hung-but-connected
> node reads `online` indefinitely), and `standalone.ts`'s SIGTERM drain is slow enough that a socket
> outlives a 30-second poll.

## Phase 5 — polish, importer, release

- Onboarding flow with the config-only V1 importer (idempotent, resumable, V1 files byte-
  identical after import — verified by hashing in tests; imported executable config lands
  untrusted).
- Walk the parity checklist in ui.md against a fresh install; fix gaps; record the deliberate
  divergences (editor autosave conflicts, automation tokens gone, preview raw-shell mode
  removed) in the release notes.
- Backup/restore command; disk-encryption warning; audit surface in settings.
- Packaging: notarized DMG with embedded node build; standalone node distribution
  (`npx`/tarball + launchd/systemd notes) for remote machines.

**Exit**: fresh-install parity checklist signed off; importer tested against a copy of a real V1
data root; full test pyramid green (unit, integration on real node processes, two-node e2e,
packaging smoke test on a clean macOS VM); V1 remains installed and functional alongside.

## Testing summary (what "fully tested" means here)

| Layer | Tooling | What it proves |
| --- | --- | --- |
| Protocol schemas | vitest in `packages/protocol` | shapes parse/reject as documented |
| Node core services | vitest + temp data roots | confinement, auth, idempotency, revocation, process policy |
| Plugin node parts | vitest + real core services, fakes at true externals | feature logic, migrations, capability contracts |
| Client stores/registries | vitest (node env) | fleet store, cache keying, contribution wiring |
| Rendered UI + flows | Playwright e2e (single- and two-node) | parity checklist, fleet scenarios, offline/revocation behavior |
| Packaging | smoke test on clean VM | bundled node boots, pairing works, data root created correctly |

No traceability matrices, no evidence bundles: the phase exit criteria name the tests, and the
tests live in CI.
