# Node-half security

This document is the security companion to the phase files: what a third-party plugin's **node
half** can do to the machine it runs on, how we limit that, which limits are real versus
cooperative, and the design rules phases 0–5 must follow so the future hard boundary stays
buildable. The UI sandbox is covered in [phase-3-sandboxed-ui.md](./phase-3-sandboxed-ui.md);
distribution trust in [phase-2-distribution-trust.md](./phase-2-distribution-trust.md). This file
is about the code that runs inside the Node.

Status framing, stated once and bluntly: **until node-half sandboxing ships (README, "Future
work"), a loaded plugin's node bundle runs in-process in the Node and can do anything the Node
process can do.** Everything in phases 1/5 that shapes or displays node permissions is
least-privilege for cooperative code and honest disclosure for users — not a security boundary.
Every UI surface and doc must preserve that distinction; the phase-5 trust prompt's footer line
("This plugin's server code runs with the same access as acorn itself") is the canonical wording.

## Threat model

Adversaries, in decreasing order of likelihood based on how extension ecosystems actually get
attacked:

1. **Malicious update to a trusted plugin** (compromised maintainer account or repo). The
   install-time prompt was accepted long ago; the update is the attack.
2. **Malicious plugin from the start**, dressed as something useful (typosquat of a popular
   plugin, or a genuinely useful tool with a hostile payload).
3. **Sloppy plugin**: no hostile intent, but over-broad access plus bugs (secrets logged, paths
   traversed, injection-prone route handlers).
4. **Compromised paired Node** pushing hostile client bundles — phase 2's problem, solved there
   (bytes-hash trust + per-device acknowledgement + the UI sandbox).

Assets, concretely, on a machine running a Node:

- **The data root**: `core.sqlite` (workspaces, projects, tasks, task links, issues, integrations,
  device rows, audit), every plugin's SQLite file, the blob cache, worktrees. The `projects` table
  is the most sensitive of these for a plugin to reach directly: alongside identity it holds the
  per-project shell commands the Node executes (`setup_script`, `dev_script`,
  `teardown_script`, `db_url_script`) and the local filesystem path of every mapped codebase.
- **Provider secrets**: encrypted at rest, decrypted in the Node's memory when used
  (`packages/node-core/src/main/core/secrets.ts`).
- **The user's account**: `~/.ssh`, `~/.aws`, browser profiles, anything user-readable, plus the
  ability to spawn processes (the Node legitimately owns PTYs, Git, Docker).
- **The fleet**: a plugin's routes and broadcasts reach every device paired with the Node.
- **Agents**: plugin-contributed agent tools execute inside agent sessions that read untrusted
  content.

What in-process JS can reach today: all of the above. `ctx` gating does not change that — a
bundle can `import('node:fs')`, `import('node:child_process')`, open `core.sqlite` directly, or
monkeypatch globals shared with core. In-process realms share ambient authority; there is no
permission check you can write around that.

## The containment ladder

Each rung is real, additive, and independently shippable. The phases implement rung 1; rungs 2–3
are the "Future work" node-sandbox entry, specified here so nothing in phases 0–5 forecloses
them.

### Rung 1 — Permission-shaped context (phase 1, shipped with the loader)

The host builds a loaded plugin's `NodePluginContext` from its manifest's `permissions.node`
block: undeclared capability ids return `undefined` from `capabilities.get`; undeclared
CoreServices facets are absent from `ctx.core`; `secrets` and `exec` (the process broker) are
individually gated and default-off; `ctx.events.streams()`/`channel()` are never present for
loaded plugins regardless of manifest. Built-ins keep the full context.

What it buys: honest plugins cannot over-reach by accident, the trust prompt is truthful for the
well-behaved majority, and the ecosystem learns to write minimal manifests from day one — which
matters because rung 2 turns those same declarations into hard grants, and manifests that were
always minimal migrate without breakage. What it does not buy: any defense against rung-0
adversaries (1) and (2) above.

Implementation notes: gate by **omission**, not by throwing — an absent facet fails at
development time with a TypeError the author sees immediately, and the shape of `ctx` becomes
documentation of the grant. Keep the facet→permission mapping in one module with exhaustive
tests (phase-1 test list).

`ctx.core.projects` (`packages/node-core/src/main/core/projects.ts`) is the model every facet
should copy, and also the clearest illustration of rung 1's limit. It is built for plugins rather
than merely exposed to them: every method returns a `ProjectRef` projection, so a plugin can
resolve project identity without seeing the config columns on the row and without ever holding the
core database handle. That is a real reduction in what a *cooperative* plugin can touch, and it is
why plugins key their rows by `projectId` instead of reaching for the table.

Two things it does not do. It is not a barrier — a loaded bundle can still open `core.sqlite` and
read the config columns directly; only rung 2 changes that. And even used exactly as intended,
`checkouts()` returns the local filesystem path of every mapped project on the machine. That is a
layout disclosure — where the user keeps their code, how many codebases they have, and often their
employer's project names — and "read projects" does not sound like it. Say so in the phase-5 trust
prompt, and prefer splitting read from write (`projects:read` / `projects:write`) so an importer
that needs to create projects does not silently arrive with the same grant as a plugin that only
wants to label a row.

### Rung 2 — Out of process (the future hard boundary)

The acorn-native design already exists as a pattern: the MCP server is a stdio child that calls
the Node over loopback with a **task-scoped internal token** and "can use only task-addressed
routes and cannot read provider credentials or administer the Node"
(docs/architecture-overview.md, docs/mcp.md). Apply the same shape to plugins:

- Each loaded plugin's node half runs as a **child process** (one per plugin: crash isolation is
  a free and valuable side effect — a segfault no longer takes the Node down).
- The child holds a **plugin-scoped internal token** whose scope IS the manifest's permission
  list. Enforcement moves to the auth middleware
  (`packages/node-core/src/server/middleware/auth.ts`), where a `Principal` already carries
  scope — server-side, where it is strong, instead of in the plugin's realm, where it is
  cooperative.
- `ctx` becomes an RPC proxy over stdio/loopback. CoreServices facets and capabilities are async
  calls the Node authorizes per token scope. (They are async-shaped already; see "Design rules"
  below for keeping them so.)
- Route contributions: the plugin process serves its own handlers; the Node proxies
  `/v2/p/<id>/*` to it. This requires the **fetch-shaped route handler** decision from phase 1 —
  a Hono instance cannot cross a process boundary; a `(Request) → Response` shape can.
- The plugin's SQLite is opened **by the plugin process** against its own file only.
- Launch flags from Node's permission model (verify exact flag set against the Node version in
  use at implementation time; the model was stabilizing across Node 20–23):
  - `--permission` — deny-by-default posture;
  - `--allow-fs-read=<pluginDir>,<pluginDataDir>` and `--allow-fs-write=<pluginDataDir>` — the
    fs jail. `~/.ssh`, `core.sqlite`, and other plugins' databases become unreachable;
  - child processes and worker threads denied unless the manifest declares `exec`
    (`--allow-child-process` / `--allow-worker` granted only then);
  - **never grant `--allow-addons`**: with `--permission`, native addons are blocked by default,
    which closes the "ship a `.node` binary inside the bundle" escape hatch around all of the
    above. If a plugin legitimately needs a native dependency, that is a first-party-adoption
    conversation, not a flag.
- Network egress is the honest gap: Node's network permission was still experimental at design
  time. Blocking `exec` and jailing fs makes exfiltration require deliberate raw-socket use from
  the plugin process, and the credential broker (next section) removes the main *reason* to
  allow direct egress — but real network enforcement is rung 3. Do not present rung 2 as closing
  it.

Costs to accept: per-call loopback latency (noise for this traffic), registration becomes a
declarative announcement over RPC at child startup, and capabilities/broadcasts are async-only
across the boundary. Streams/WS-channel ownership cannot cross — already excluded from the
third-party surface by the two-tier rule.

### Rung 3 — OS-level sandboxing (the last door)

Per-platform confinement of the plugin child process: Seatbelt profiles on macOS,
Landlock/namespaces on Linux, AppContainer on Windows. This is what actually enforces a
`net` host allowlist and closes raw sockets. Substantial per-platform work; only worth it if the
ecosystem grows plugins that need direct egress. Design nothing that assumes it; foreclose
nothing that enables it (a child process per plugin, rung 2, is the shape all three platforms'
mechanisms confine).

## Secrets: never cross the boundary

The strongest secret-handling rule is that plugin code — any rung, any tier — **never holds a
decrypted secret**. The codebase already has the precedent: model providers register adapters
and consumers call `generateTextForConnection`; the provider key never leaves core's use-scoped
call path. Generalize it as the **credential-injecting fetch broker**:

- A plugin registers a named credential slot (`ntfy-token`); the user fills it through core's
  existing secret storage and settings UI. The plugin's own tables never store it (authoring
  rule; also protects backups — see below).
- When the plugin needs an authenticated request it asks the broker: "GET
  `https://ntfy.sh/my-topic` with credential `ntfy-token` as `Authorization: Bearer`". The
  **Node** attaches the secret, makes the call, returns the response.
- The broker enforces the manifest's `net` host allowlist on brokered traffic — which turns
  `net` from pure disclosure into real enforcement for the traffic that matters, at rung 1,
  without waiting for rung 3.
- Response bodies go back to the plugin; the credential never does. Redirects are followed only
  within the allowlisted host set (a redirect to an attacker host with the header attached is
  the classic leak).

Implementation notes: this is a `ctx.core` facet (`secrets: true` in the manifest gates it), and
it is the *only* thing `secrets: true` grants — there is no "read secret value" call on the
public surface at all, so there is nothing to abuse or deprecate later. The Node has no general
HTTP client abstraction (docs/http-client.md); the broker is a legitimate new consumer — keep
its fetch usage inside the broker module, same posture as the phase-5 installer.

## Tokens, routes, and agents

- **Plugin routes vs task-scoped tokens.** Decide explicitly, default no: task-scoped internal
  tokens (agents, PTY children, the MCP child) cannot reach `/v2/p/<third-party>/*`. Otherwise a
  prompt-injected agent can drive a malicious plugin's routes with the task's authority. Opt-in
  per route via explicit metadata when a plugin genuinely serves task-scoped consumers, surfaced
  in the permission prompt.
- **Agent tools are a prompt-injection surface.** A plugin-contributed tool is callable by an
  LLM reading hostile content. The existing risk-metadata and per-owner tool-permission
  machinery (docs/agent-tools.md) applies, with a stricter default for third-party tools:
  **disabled or ask-every-time until the owner enables them**, regardless of the plugin being
  trusted for everything else. Trusting a plugin's code and trusting an agent to call its tools
  autonomously are different decisions; keep them separate in the UI.
- **Broadcast hygiene.** `ctx.events.status()` is content-free by design; keep every
  third-party-reachable broadcast content-free or plugin-self-scoped so one plugin's events can
  never carry another's data to a subscribed frame (phase-3 bridge filters by declared channel;
  this rule is what makes that filter sufficient).

## Storage

- **Migrations** run in the Node at boot against the plugin's own file only
  (`packages/node-core/src/main/pluginMigrations.ts`). SQL is data, not code, but verify the
  plugin database factory (`main/pluginStorage.ts`) keeps `load_extension` unavailable
  (better-sqlite3 default) and never grants `ATTACH` reach into other files — an attached
  database is a cross-plugin read the boundary rules exist to prevent.
- **Backups.** Backup snapshots scrub core credentials and device rows
  (docs/architecture-overview.md), but a plugin that stashes tokens in its own SQLite defeats
  the scrub — its file is snapshotted verbatim. The credential broker makes core secret storage
  the path of least resistance; state the rule anyway wherever plugin storage is documented:
  secrets go through core secret storage, never plugin tables.
- **Scope by `projectId`, and store nothing else about the project.** Plugin tables reference a
  project by its id and nothing more (`plugins/http`, `plugins/database`, `plugins/memory` all do
  this). A plugin that also caches the project's local path, remote URL, or config columns into
  its own file has copied the two most sensitive parts of the `projects` row — filesystem layout
  and executable scripts — into a file the backup scrub does not know to treat as sensitive, and
  which survives uninstall by default. Re-read through `ctx.core.projects` each time instead; that
  is what the seam is for.

## Supply chain

- The phase-5 lockfile hash-pins what was installed and records source + resolved version. Add
  **provenance**: resolved commit SHA / release tag / npm integrity value, so "what exactly is
  running" is answerable after the fact and auditable across a fleet.
- **Updates are the attack window** (adversary 1). Already mitigated by design: no auto-update,
  no background checks, every hash change re-prompts, permission diffs render `node` additions
  most prominently (phase 5). Do not weaken any of these for convenience; "auto-update trusted
  plugins" is the specific feature request to refuse until signing exists.
- **Signing/attestation** (sigstore-style) is future work layered on the same lockfile fields.
  Nothing needed now beyond not inventing a bespoke format the ecosystem can't verify later.
- **Typosquatting**: local id-collision rules protect one machine, not discovery. Any future
  browse surface shows repo owner and stars prominently and repeats the unreviewed-listing
  wording from phase 2's threat model.

## Resource abuse

The UI side has the phase-3 bridge rate limiter. The node side has nothing until rung 2, where
the child process gets OS-level memory/CPU limits essentially for free. Accepted gap; one line
in the threat model, no interim machinery — an in-process watchdog can't stop a hostile plugin
anyway (it shares the event loop it would be policing).

## Design rules for phases 0–5 (keep the boundary buildable)

Everything above gets cheaper or free once plugins are out of process. These are the rules that
keep rung 2 a refactor instead of a redesign; each is already stated in its phase, collected
here as the checklist reviewers should hold PRs against:

1. **Fetch-shaped route handlers** for loaded plugins (phase 1) — a Hono instance cannot cross a
   process boundary. *Shipped for a plugin's own namespace*: `ctx.routes.fetch(handler)` exists and
   `ctx.routes.register` (the Hono one) is absent from a loaded plugin's context. **Not** shipped for
   provider routes, which still take a Hono router: their handlers reach core's database through the
   host's Hono context (`ownedConnections(c, …)`, `providerResource(c, …)`), so the remaining work is
   to give the integrations resource runtime an explicit context. That is a rung-2 prerequisite in its
   own right — a plugin process cannot hold `c.env.DB` either way — and reviewers should hold new
   provider-facing helpers to taking a plain context object rather than `c`.
2. **No `streams`/`channel` for loaded plugins, ever** (phase 1) — the one contribution that
   cannot survive the boundary.
3. **Async-shaped `ctx` surfaces only** on the public plugin-api — no new synchronous
   CoreServices facet or capability signature on the third-party surface; sync calls die at a
   process boundary.
4. **Secrets have no read path** on the public surface — broker only, from day one.
5. **Structured-clone-safe types** for every capability argument/result exposed to loaded
   plugins — no live objects, no functions, no class instances across the seam.
6. **Honest wording everywhere** the `node` permission block is rendered: *declared*, not
   enforced, until rung 2 ships — then the same UI flips to *enforced* with no vocabulary
   change, which is the payoff for declaring the schema now.

## Summary table

| Asset | Exposure today (in-process) | Mitigation | When |
| --- | --- | --- | --- |
| User files (`~/.ssh`, …) | Full read/write | fs jail via `--permission` flags | Rung 2 |
| Other plugins' SQLite, `core.sqlite` | Direct open | fs jail + token-scoped core routes | Rung 2 |
| Provider secrets | Importable/decryptable in-realm | Broker: no read path exists at all | Rung 1 (design), absolute at rung 2 |
| Process spawning | Unrestricted | `exec` grant → `--allow-child-process` | Declared rung 1, enforced rung 2 |
| Native code loading | `.node` addon in bundle | `--permission` blocks addons; never `--allow-addons` | Rung 2 |
| Network egress | Unrestricted | Broker allowlist (brokered traffic); OS sandbox (raw sockets) | Rung 1 partial, rung 3 full |
| Agent sessions | Tool contributions | Third-party tools default disabled/ask | Phase 1/5 |
| Fleet devices | Routes + broadcasts | Task-token opt-in default-no; content-free broadcasts | Phase 1/3 |
| Backups | Plugin-stored secrets survive scrub | Broker + "no secrets in plugin tables" rule; scope by `projectId`, never mirror the project row | Rung 1 |
| Project config scripts (`setup_script`, `dev_script`, …) | Writable via the core config route; the Node executes them | Config `PUT`s permanently unmapped on the phase-3 bridge; project config trust ack on the node side | Phase 3 (frames); rung 2 (node half) |
| Project folder paths | `core.projects.checkouts()` lists every mapped codebase | Split `projects:read`/`:write`; name the disclosure in the trust prompt | Rung 1 (disclosure), rung 2 (enforced) |
| Trust over time | Malicious update | No auto-update, hash re-prompt, permission diff, provenance | Phase 2/5 |
