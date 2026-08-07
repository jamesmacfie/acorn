# Phase 1 — what shipped, and where it diverges

Phase 1 (plan.md § "Phase 1 — protocol v2 and the fleet spine") is done: the transport is HTTPS +
`/v2` with device tokens, the client is multi-node through a connection broker in Electron main, and
the session cookie and `/api/v1` are gone.

This file exists for one reason: **the design docs in this folder describe the target, and the shipped
code deliberately stops short of it in several places.** Every entry below is a decision, not a bug and
not an oversight — a future reader who "fixes" one of these without reading why will be undoing work.
Where a divergence has a scheduled home, it is named.

For what the code *does*, read the code — every item here points at the file that owns the decision and
usually carries the same reasoning inline.

## Transport and protocol

**Flat WS frames, not the `kind: event` / `kind: stream` envelope.**
protocol.md § Events and § Streams specify two multiplexed frame kinds, a credit-based backpressure
layer, `fromSeq` replay on stream open, and tunnel frames. What shipped is V1's flat
`{ channel, … }` vocabulary (`@acorn/protocol/ws.ts`) on the new path `/v2/events`, with the new
things that actually matter for a fleet bolted onto it: bearer auth at upgrade, a per-connection
`seq` so the client can detect loss, and revocation closing sockets. The frame *envelope* is a
rewrite of eleven client frames and nine server frames plus every producer and consumer, and it buys
nothing until there is a remote node whose link is slow enough to need credit. Tunnels are explicitly
Phase 4 (plan.md § 118).

**`Idempotency-Key` policy is `optional` everywhere, never `required` per endpoint.**
> **Still open after Phase 2**, deliberately: no client call site sends a key today, so declaring
> routes `required` would break create-PR/post-comment/send-agent-turn. The route declaration and the
> client call sites have to land together.
protocol.md says endpoints with external side effects (create PR, post comment, send agent turn)
*require* the header. The middleware honours a key whenever one is present and never demands one
(`server/middleware/idempotency.ts`). Requiring it per endpoint needs a per-route declaration, and the
route registry carries `{ plugin, prefix, router }` and nothing else — inventing route metadata inside
the middleware would be worse than waiting for the field. Phase 2, with the declaration it needs.

**The ten error codes are a floor, not a whitelist.**
protocol.md calls the code list "a small closed set". `@acorn/protocol/errors.ts` treats it as the
closed *floor* and types the field as `ErrorCode | (string & {})`, because 37 domain codes are already
load-bearing on the client — `needs-trust` opens the config-trust modal, `provider_needs_auth` rewrites
the message. A closed set buys interop discipline across an API boundary and there isn't one here:
client and node ship from the same repo and are released together.

**Reads do not return `{ data, freshness }`.**
protocol.md § HTTP conventions specifies that envelope for provider-backed reads. Routes still answer
the bare V1 payload, and freshness is derived on the CLIENT from the node's connection state plus the
query's own status (`client-core/node/freshness.ts`). Two inputs, one derivation, no per-route
envelope to add and no 34 query factories to unwrap. The server-side `sync_state` freshness marker is
unchanged and still governs serve-then-revalidate.

**The internal principal can now reach GitHub — a posture change, not an oversight.**
> **Reversed in Phase 2.** A `task`-scoped credential is denied the GitHub credential; the `service`
> scope keeps it, which is what let the gate land without breaking `seedTaskNotes`. See
> [phase2-notes.md](./phase2-notes.md).
V1's internal principal carried a `SessionUser` whose `token` was `''`, so an agent-spawned child was
*structurally* unable to call GitHub. Moving the credential to a stored `integrations` row removed that
property: `githubToken(c)` reads the row for `ownerId(c)`, `ownerId` returns `principal.userId` for either
kind, and nothing in the github plugin's routers gates on kind. So "an agent cannot exfiltrate or spend
your GitHub credentials through the MCP surface" is **no longer true**. The counter-argument is real —
every such process is one the owner started, and it could read a `gh` CLI token anyway — but it is a
decision that should be made explicitly rather than inherited. The kind gates that *do* exist are
`routes/agentTools.ts` (renderer projection ⇒ `device`, MCP projection ⇒ `internal`) and
`plugins/http`'s `send` (⇒ `device`).

**Internal tokens are still V1's single persisted token, not scoped and expiring.**
> **Resolved in Phase 2** — scoped `service`/`task` HMAC tokens
> (`server/auth/internalTokens.ts`). Expiry is still deliberately absent; see
> [phase2-notes.md](./phase2-notes.md).
protocol.md § Transport describes internal tokens as "task- or session-scoped, expiring, and
restricted". What exists is one `INTERNAL_TOKEN` per data root, persisted deliberately so a tmux
session reattached after a restart keeps working (`main/bindings.ts`). It is route-restricted in the
sense that the `internal` principal cannot reach GitHub or use the HTTP client as a secret oracle, but
it is not per-task and does not expire. Scoping it belongs with Phase 2's plugin host.

**Fingerprints are 64 hex characters, not six words.**
protocol.md asks for "6 words / grouped base32" for human comparison. The pairing UI shows the raw
sha256 hex (`client-core/settings/NodesSettings.tsx`), which the node prints identically. A
word-encoding is a real usability improvement and a real new encoding to agree on across both ends;
it is Phase 4 UX work.

**No `/v2/blobs/:sha256` route.**
protocol.md § Blobs specifies content-addressed blob upload/fetch. Blobs are still served through the
github plugin's own routes over the on-disk `BLOBS` cache. Nothing in Phase 1 needed a generic blob
endpoint, and adding one would have been an unused public surface.

## Client

**Prefs are read from the HOME node, whatever node is active.**
`prefsOptions` in `client-core/queries.ts` addresses `homeNodeTarget()` rather than the active node.
Prefs live on a node, so without this the theme, keybindings and visual style would flip every time
the owner switched nodes. The right answer is a client-side device-prefs tier (ui.md § State
ownership: "Client owns presentation"), which is Phase 4. Recorded in data.md § Client cache too.

**Freshness is rendered in exactly two places, not everywhere.**
The topbar chip and the Settings → Nodes rows. ui.md asks for offline/stale rendering across every
surface; threading a freshness prop through all 13 panes before the fleet UX exists would be 13 edits
to revisit, so plan.md § 116 owns it. `freshnessOf` already computes all six states, so the panes are
a wiring exercise, not a design one.

**The cache is partitioned by a QueryClient per node, not by a `nodeId` in every query key.**
data.md calls the client cache "keyed by (nodeId, queryKey)". `client-core/node/fleet.ts` satisfies
that by construction instead: one `QueryClient` + one IndexedDB persister key (`acorn-cache:<nodeId>`)
per node, and only the active node's provider is mounted. Prefixing keys would mean touching all 34
`*Options()` factories, 44 cache-mutation call sites and `shouldPersistQueryKey`, which reads
`key[0]`/`key[4]` positionally. The same-UUID-across-nodes hazard becomes impossible rather than
something every future call site has to remember.

**Device tokens live in Electron `safeStorage`, which is data.md's "OS keychain".**
data.md § Client state says device tokens are keychain-held. On macOS `safeStorage` *is* the Keychain
(it stores an app-scoped key there and encrypts with it), so the requirement is met without a
`keytar`-class native dependency. See `main/deviceTokenStore.ts`; a machine with no usable keychain
simply does not remember the token and re-pairs, which is why the fleet record and the token are two
separate files.

## Configuration

**`GITHUB_CLIENT_SECRET` is retained although nothing reads it.**
The device flow exchanges on `client_id` alone, so the secret has no consumer. The binding is still
declared and read *optionally* (`main/bindings.ts` — `optional`, not `secret`, so a fresh checkout
boots without it) at the owner's explicit request. Do not delete it as dead code; it is a deliberate
placeholder. Note that `GITHUB_CLIENT_ID` **is** required to boot a node.

## Scope left for later phases

Two things a reader might reasonably expect to work and which do not yet:

- **A standalone node wires only the pure-Node bridges.** `apps/node/src/server/standalone.ts`
  installs the search / editor / local-git / database / agent-usage HTTP bridges, but not the terminal,
  agent, workflow or config-trust engines — those are wired by the supervised composition root
  (`service/runtime.ts`), which needs `DesktopCapabilities` a headless node has no implementation for.
  So `/v2/p/terminal/*` on a paired remote node answers a clean `503 bridge-unavailable`, the same
  degraded mode `dev:node` has always had. "A remote task's terminal/agent/preview work end-to-end
  over the LAN" is a Phase 4 exit criterion.
- **A node binds loopback only.** protocol.md already says remote use requires the owner to enable a
  non-loopback bind or reach the node over their own VPN/tunnel; nothing exposes that switch yet, so
  the two-node proof (`apps/desktop/e2e/twoNode.spec.ts`) runs two loopback nodes on two data roots.
  The client code path is identical either way — the endpoint is reported, never assumed.

## What is genuinely covered by tests

For the Phase 1 exit criteria specifically:

| Criterion | Where |
| --- | --- |
| Two nodes driven concurrently, same-UUID collision, node switcher | `apps/desktop/e2e/twoNode.spec.ts` |
| Pairing / idempotency / revocation against a real node process on a temp data root | `apps/node/test/integration/serviceSpawn.test.ts` |
| Pairing surface semantics (no-oracle uniformity, attempt budget, admin gating) | `apps/node/test/integration/pairing.test.ts` (assembled app, not a spawned process) |
| Revocation closes open sockets **immediately** | `packages/node-core/src/main/wsHub.test.ts` — fires `onRevoked` while leaving `isActive()` true, so the sweep cannot be the explanation |
| Streams **re-check within 60 s** | same file — flips `isActive()` without firing `onRevoked`, so the listener cannot be the explanation (interval injected, default 60 s, 20 ms in the test) |
| Reconnect / backoff / pin failure | `apps/desktop/src/app/main/nodeBroker.test.ts`, against a real TLS server with the node's own `ensureCert` output — not against a spawned node |
| e2e parity on the local node, with no login flow left to update | `apps/desktop/e2e/desktop.smoke.spec.ts` S1–S8 |

## Adversarial review findings (end of Phase 1)

### Fixed: the internal token was a complete privilege escalation

**Confirmed by running it**, not by reading. `ACORN_API_TOKEN` is injected into every PTY and agent
session env, and `requireUser` only asserts that *some* principal resolved — which is the right rule
for product routes and the wrong one for device administration. So anything running in a task terminal
could:

1. `POST /v2/core/pair/start` → **the pairing code comes back in the response body**;
2. `POST /v2/pair` with it → a permanent **owner-authority device token**, not task-scoped, surviving
   the task that leaked it;
3. `GET /v2/core/devices` → enumerate the owner's devices, and `DELETE` → revoke them.

That contradicts three of the four things `security.md` § Threat model promises an internal token can
never do (mint tokens, pair, touch device management).

Fix: `requireDevice` in `server/middleware/requireUser.ts`, mounted over `/v2/core/pair*` and
`/v2/core/devices*`. Regression tests in `apps/node/test/integration/internalPrincipal.test.ts`,
verified non-vacuous by removing the gate and watching five of seven fail.

### Accepted divergence: an agent CAN use the owner's GitHub credential

V1 enforced the opposite structurally — the internal principal carried `token: ''`, so an
agent-spawned child could not call GitHub at all, and `docs/mcp.md` and `security.md` both state that
as a guarantee. Moving the credential into an `integrations` row keyed by owner dropped it, because
`ownerId(c)` is the same for a `device` and an `internal` principal.

Gating `githubToken()` on `kind === 'device'` was tried and **reverted**, for two reasons:

- It contains nothing. An agent has a shell in the task worktree with the owner's git credentials, so
  it can already push and open pull requests. The route is not additional capability.
- It breaks a first-party caller. `seedTaskNotes` runs *inside* the service and uses the internal token
  over loopback to reuse `pullDetail`'s serve-then-revalidate, so the gate silently stopped seeding PR
  notes whenever the mirror was cold.

The real defect is that `INTERNAL_TOKEN` conflates "the service calling itself" with "a child an agent
spawned". `protocol.md` § Transport already specifies the fix — internal tokens that are task-scoped
and route-restricted — and that is Phase 2 work, not a one-line guard. Until then this is a **documented
divergence, not a guarantee**, pinned by a test so it cannot change silently, and `security.md`'s
wording needs revisiting when Phase 2 lands.
