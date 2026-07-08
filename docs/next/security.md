# Security model — the loopback surface after the transport collapse

**Status:** design constraints · **Date:** 2026-07-07 · **Companions:**
[implementation.md](./implementation.md) Phases 3–4, [review.md](./review.md)
(auth strengths), [extensibility.md](./extensibility.md) tenet 8,
[contribution-points.md](./contribution-points.md) §4.8/§4.12,
[integrations.md](./integrations.md) (provider-specific rules, §8 here)

No existing doc analyzes what Phase 3 (IPC → HTTP + WS) changes about the
threat model, and it changes something real: **65 request/response IPC channels
that today only the renderer can reach — file writes, PTY spawning, arbitrary
`git` and shell execution, Postgres queries — become HTTP endpoints on
`127.0.0.1:4317`.** Electron IPC is reachable only from the app's own renderer
process; a loopback HTTP port is reachable by every process on the machine and,
indirectly, by any web page open in any browser. This doc states the threat
model, the invariants Phase 3 must preserve, the new rules it must add, and —
just as deliberately — what we refuse to defend against.

---

## 1. Threat model (who we defend against, who we don't)

This is a **single-user, local, trusted-machine app**. In scope:

| Threat | Vector | Defense |
| --- | --- | --- |
| A malicious *web page* in the user's browser driving the API | `fetch('http://127.0.0.1:4317/...')` from a browser tab | Browsers block most of this (CORS, private-network access), but the app must not rely on browser policy alone: session-cookie auth on every route (`SameSite=Lax`, so cross-site POSTs don't carry it), `hono/csrf` Origin/Sec-Fetch-Site checks on mutating calls |
| DNS rebinding (a page resolving its own hostname to 127.0.0.1 to bypass same-origin) | crafted DNS + `fetch` | The Host guard (`main/server.ts:43-46`): any request whose `Host` isn't exactly `127.0.0.1:4317` is rejected 403 |
| A *non-browser* local process calling the API | `curl http://127.0.0.1:4317/...` | Cookie auth: no cookie → `user` is null → 401 on every protected route. The cookie lives in Electron's session storage, not on disk in a curl-readable form |
| An agent (Claude/codex/aider child process) exceeding its granted surface | the harness routes / MCP | `INTERNAL_TOKEN` (per-app-run `randomUUID()`, `bindings.ts:143`) required on internal routes; internal identity carries an **empty GitHub token** (`middleware/auth.ts:21`) so agents can never call GitHub with the user's credentials; tool risk tiers (§4) |
| A cloned repo's committed config executing commands | `.acorn/config.toml` run targets / workflow steps | The trust gate (§5): first-execution acknowledgment per config hash |

Explicitly **out of scope** (defending against these would tax every interface
for a user that doesn't exist — extensibility tenet 5):

- **Malware already running as the user.** It can read the SQLite DB, the
  worktrees, and `~/.acorn` directly; API hardening is irrelevant at that point.
- **Other OS users on the same machine.** Personal macOS app; file permissions
  are the OS's job.
- **Hostile plugins.** Plugins are in-tree, type-checked, reviewed code
  (tenet 5). No sandboxing.
- **TLS on loopback.** No. Traffic never leaves the machine.

## 2. Invariants that already hold and must survive every phase

Each of these exists in code today. A phase that breaks one has failed its
verify step, whatever else it achieved:

1. **The GitHub token never reaches the renderer or any agent.** It lives
   inside the sealed session cookie (AES-256-GCM JWE, `session.ts`) and is
   unsealed only server-side. Internal-token callers get `token: ''`
   (`middleware/auth.ts:21`).
2. **Bind loopback only.** `hostname: '127.0.0.1'` (`main/server.ts:57`) —
   never `0.0.0.0`, never configurable.
3. **Host-header guard** rejects anything but `127.0.0.1:4317`
   (`main/server.ts:43-46`) — the DNS-rebinding defense. It must cover the WS
   upgrade path too (§3).
4. **CSRF middleware on `/api/*`** (`server/index.ts:34`) — Origin /
   Sec-Fetch-Site validation on mutating calls.
5. **Session cookie is `httpOnly`, `SameSite=Lax`** (`middleware/auth.ts:36-41`).
6. **`INTERNAL_TOKEN` rotates per app run** (`bindings.ts:143`) and is passed to
   agents via environment, never persisted.
7. **Integration tokens are encrypted at rest** (`encryptSecret`/`decryptSecret`
   under `SESSION_ENC_KEY`), and **list responses never expose tokens**.
8. **Path confinement through `taskWorktree.ts`** — every file operation
   resolves through `resolveTaskCwd`/`resolveInRoot`; no route or tool accepts
   an absolute path from the caller.
9. **The GitHub error folding keeps its meanings.** An upstream GitHub `401`
   maps to `reauth` and the client bounces to login; the SAML SSO,
   rate-limit, forbidden, and private-repo-not-found foldings keep their
   current machine codes. Phase 0's `ApiError` sweep standardizes the
   envelope *shape*, never this vocabulary ([feature-parity.md](./feature-parity.md) §16).
10. **The GitHub OAuth permissions re-request stays a settings feature** —
    distinct from the new agent-tool permissions page ([ux.md](./ux.md) §3);
    the new page must not replace the OAuth scope flow.

## 3. New rules Phase 3 must add

The transport collapse is a net security *simplification* (one auth story
instead of three), but only if these land with it:

- **Every migrated route sits behind `requireUser`.** Phase 0's middleware is a
  hard precondition: the migrated channels are strictly more dangerous than the
  existing routes (they write files, spawn processes, run SQL), and today's
  IPC surface had implicit renderer-only protection that HTTP does not
  replicate. No migrated route ships with an inline-guard-forgotten hole. The
  route-by-route auth check belongs in each migration PR's tests.
- **The WebSocket upgrade authenticates and validates Origin.** The upgrade
  request must (a) pass the same Host guard, (b) carry a valid session cookie,
  and (c) have an `Origin` header of exactly `http://127.0.0.1:4317` — browsers
  do **not** enforce same-origin for WebSocket connections, so an
  unauthenticated/unchecked WS endpoint would hand PTY output (and input!) to
  any web page. Reject the upgrade with 403 otherwise; no anonymous socket,
  not even read-only.
- **PTY input over WS is a privileged write.** `term:input` bytes reach a shell.
  The socket that carries them is authenticated at upgrade; there is no
  per-message re-auth (the connection is the credential), which is exactly why
  the upgrade check above is non-negotiable.
- **The Electron-ism IPC residue stays renderer-only.** Dialogs and
  `browser:bind` (which takes a raw `webContents` id — a capability handle)
  must *not* be projected to HTTP. `browser:bind` in particular: an HTTP caller
  supplying arbitrary webContents ids would get CDP control of any window.
  This is the classification rule's security face: "true Electron-ism" means
  "must never be HTTP-reachable", not merely "inconvenient to migrate".
- **`dev:node` browser mode gets no privilege widening.** Running the server
  without Electron for development doesn't relax any of the above; if a check
  depends on an Electron-only fact, it fails closed.

## 4. Agent tool risk tiers (what they are and aren't)

Phase 4's `risk: 'read' | 'write' | 'execute'` tier
([contribution-points.md](./contribution-points.md) §4.8) is **policy
transparency, not sandboxing**. The handler still runs in main with full user
privileges; the tier exists so that:

- the permissions settings page can show one honest inventory of what agents
  can do ([ux.md](./ux.md) §3), grouped by what it costs when misused;
- the user can turn off `execute`-tier (or `write`-tier) tools globally or
  per-tool, and the projection consults that pref alongside `when` — the
  toggle is enforced at the single projection seam, which is why the taxonomy
  must exist *before* the tool set grows (retrofitting it never happens);
- a future reviewer of a new tool contribution is forced to declare, in the
  diff, what the tool can touch.

Classification rule of thumb: reads local state only → `read` (notes list,
`git_log`, `pr_current`); writes durable user data → `write` (notes append,
memory add); spawns a process or evaluates code → `execute` (run targets,
`db:query`, browser driving). When in doubt, the higher tier.

The tier does **not** constrain a tool's implementation (no seccomp, no fs
jail). The worktree confinement (invariant 8) is the real fence; the tier is
the label on the gate.

## 5. Repo-config trust gate

Full mechanism in [contribution-points.md](./contribution-points.md) §4.12,
dialog UX in [ux.md](./ux.md) §2. Security summary: repo-layer
`.acorn/config.toml` is *remote-authored executable config* — cloning a repo
must never be sufficient to execute its commands. The gate hashes the repo
layer; first execution from an unacknowledged hash shows the exact commands
and records `config_acks (repo, hash, ackedAt)` (machine-scoped); any config
change re-asks with a diff. Two sharp edges the implementation must respect:

- **The gate covers every execution path**: the run ▶ button, workflow starts,
  *and* the `run_*` agent tools. An agent asking to run a target from an
  unacknowledged config parks the request until the user acks in the UI (the
  tool returns a distinguishable "needs-trust" error, not a silent hang).
- **The hash covers everything executable**: run target commands, workflow
  step definitions, preview/url scripts — not just the section the user
  happened to look at. Hash the whole parsed repo layer.

## 6. Secrets posture (unchanged, restated)

- Dev secrets in `apps/desktop/.env` (gitignored); the packaged-build keychain
  work uses Electron `safeStorage`, not keytar (review.md technology choice #4).
- `SESSION_ENC_KEY` is the root secret (sessions + integration tokens at
  rest); it must be exactly 64 hex chars and `session.ts` rejects anything
  else. When `safeStorage` lands, this key moves there first.
- The observability log (implementation.md ongoing tracks) must never log
  request bodies or headers wholesale — tokens ride in both. Log route +
  status + timing, not payloads.

## 7. Verification

Security assertions are cheap route tests ([testing.md](./testing.md) §2):
unauthenticated request → 401 for every migrated route (one parameterized
test over the route table); WS upgrade without cookie / with wrong Origin →
403; harness route without `INTERNAL_TOKEN` → 401; a `run_*` tool against an
unacknowledged config → needs-trust error. The security-sensitive Phase 3
domains carry more: path-traversal / symlink-escape / missing-worktree /
stale-buffer tests for editor/git/search, and SQL-surface tests for the
database routes (identifier validation, never-persisted connection URL) —
[feature-parity.md](./feature-parity.md) §7/§14. Add them in the same PR as
the surface they cover — a security property without a test regresses
silently.

## 8. Integration-provider rules (Phase 7)

Invariant 7 (tokens encrypted at rest, never in list responses) is the seed;
the plugin-era integration contract ([integrations.md](./integrations.md))
adds rules that generic provider machinery must enforce structurally, not
per-provider by convention:

- **Provider tokens and refresh tokens never enter renderer state.** A
  credential form submits once; after `validate`/`normalize` the renderer
  sees only the connection summary — no provider settings component receives
  raw secret material back (integrations §3).
- **Agent tools cannot read secrets.** The generic list-connections tool
  returns capability states, never `authRef` material (integrations §16);
  this is a conformance-suite assertion, not a review comment.
- **Provider route handlers and the observability log never log provider
  tokens, auth headers, webhook secrets, or wholesale upstream payloads**
  (which may embed secrets) — the §6 log rule extended to provider surfaces.
- **Provider write actions default off for agents by risk tier**
  (integrations §11 reuses the §4 taxonomy); high-operational-risk mutations
  (incident ack/resolve) ship agent-disabled regardless of tier.
- **Self-hosted base URLs are allowed but validated** (integrations §3
  `config`): http(s) only, no credential-bearing URLs, and provider fetches
  only ever carry that provider's credential — never the GitHub token
  (invariant 1's corollary). Server-side fetch to a user-configured URL is
  the SSRF-shaped surface here; in a single-user local app the "attacker" is
  a malicious config value, so validation is a correctness fence more than a
  boundary — but it is still stated, because a future webhook/relay story
  changes the calculus.
- **Task-link and binding writes derive `providerId` from the connection
  server-side** (integrations §5) — a plugin or agent cannot forge another
  provider's rows by passing a string.
- **If webhooks ever land** (integrations §15): signature verification,
  replay windows, and the handler treated as a fully untrusted input
  boundary (zod per decision 2).
- **OAuth callback routes** (when the first OAuth provider lands) bind
  provider id + CSRF state into the OAuth `state` parameter and are
  core-owned (integrations §3).

## 9. External-control forward-compatibility (keep open, do not build)

Herdr-style tools expose their whole control surface to any local process over a
socket. acorn deliberately does the opposite: §1 lists "a non-browser local
process calling the API (`curl`)" as a threat the cookie guard **blocks**, and
that posture stays. This section is not a plan to open that door. It is the set
of seams that keep the door *lockable with issuable keys* — so that authorizing
an external client later (a CLI, an external agent, a companion tool) is a matter
of recognizing a new principal, not re-architecting auth, events, and transport.

The reason preserving these seams is cheap: **after Phase 3 the entire control
surface already is loopback HTTP behind one guard** (§3). There is no separate
external API to build later — only the guard's answer to "is this caller
authorized" to extend. Keep these five seams open (this mirrors extensibility
tenet 5 and §9.1's "don't foreclose, don't build"). Nothing here is built now.

1. **Auth is principal-based, not cookie-based** (Phase 0 — the one expensive-to-
   retrofit seam). The shared guard already resolves more than one credential:
   the session cookie (`user`, real GitHub token) and `INTERNAL_TOKEN` (internal
   identity, empty GitHub token, `middleware/auth.ts:21`). Write it to resolve a
   `Principal` — a `kind`, a capability set, and the GitHub-token posture — from
   whichever credential is present, and gate routes on the principal, never on "a
   cookie is present." A future authorized external caller is then a new `kind`
   plus a token issuer, not a re-touch of every migrated route. This is nearly
   free now precisely because the guard must already handle two credential types;
   it is ruinous to retrofit across ~65 routes once the cookie-shape is copied.

2. **Runtime/session events are serializable and stably named** (Phases 3, 5).
   Herdr's most-used external capability is `events.subscribe` / `wait
   agent-status`. acorn's `ctx.events` is an in-process client bus, so it is the
   one control-relevant surface Phase 3 does *not* automatically put on the wire.
   Two rules keep a later projection additive: (a) distinguish **runtime/session
   events** (agent/session status, workflow step events, PTY / worktree / task /
   workspace lifecycle) from **pure presentation events** (which overlay is open,
   selection) — the former carry plain serializable data and namespaced string
   kinds, never live signals, closures, or DOM refs; (b) emit the runtime/session
   ones at a wire-reachable tier (main/server), not client-only. A client-only
   bus of live objects cannot be projected without touching every emitter.

3. **The one WebSocket is a typed multi-channel multiplexer** (Phase 3). The
   §3/Phase-3 socket carries PTY frames and workflow-step frames. Frame it as
   kind-tagged channels so an `events` (or future control-response) channel is
   additive rather than a second socket with its own auth-at-upgrade story. The
   upgrade auth (Host guard + credential + exact-Origin) is identical regardless
   of channel count.

4. **Mutation provenance derives from the principal, in an open representation**
   (data-model track). Mutations already record provenance from the calling
   channel (contribution-points §4.8, integrations §11), and task `origin` is
   free text. Source the recorded actor from the request principal (seam 1) as an
   open representation, not a closed `{ human | agent }` union — then an external
   caller's writes are attributable without a migration. This is the only place
   external-control forward-compat reaches the schema, and it is a stance choice,
   not a column.

5. **App-control mutations land as HTTP routes, not preload residue** (Phase 3
   classification). The only reason a channel stays IPC residue is that it needs a
   true Electron capability handle (dialogs, `browser:bind`'s raw `webContents`
   id — §3). Do not residue-classify a control mutation (open pane, focus task,
   create workspace) merely because only the renderer calls it today; if it is a
   serializable request/response app contract it becomes a route behind the guard,
   and is thereby reachable by a future authorized principal.

Verification is only that the seams hold, not that external access works: the
guard is principal-shaped (a second principal `kind` can be added in a test
without editing routes), and runtime events and WS frames are serializable and
kind-tagged. Everything else is the ordinary Phase 3/5 work.
