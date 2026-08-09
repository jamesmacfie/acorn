# Security model

acorn is single-owner software. A paired device has full owner authority for its Node. Security
controls therefore protect the transport, credential custody, process boundaries, repository data,
and untrusted provider/preview content rather than implementing multi-user roles.

## Trust boundaries

- Electron renderer: UI code and third-party preview content; no device token, certificate, database
  handle, process object, or direct network access.
- Electron main: native host, broker, certificate pins, device-token custody, window policy, and
  preview `WebContentsView` host.
- Node: authoritative data and execution environment. It is intentionally able to run developer
  tools, so a compromised Node account is outside the application threat model.
- Node child: task-scoped internal caller. It receives only an allowlisted environment and scoped
  token; its routes and task identity are checked by the Node.

The application does not defend against root/other-user access to the host, a compromised Node
account, or malicious first-party plugin code. Those are OS/deployment concerns.

## Transport and auth

- Nodes bind to `127.0.0.1` over TLS 1.3 and reject unexpected `Host` values.
- The certificate is self-signed, persisted in the Node data root, and pinned by fingerprint in the
  Electron broker. A changed fingerprint is a hard stop.
- Every protected HTTP route passes request-id, principal resolution, the auth gate, and then the
  idempotency middleware before reaching a router.
- `/v2/node` and `/v2/pair` are the only pre-auth routes. Device management, plugin toggles, audit,
  security, and backup are device-only.
- `/v2/events` authenticates the upgrade and rechecks device activity for long-lived streams.
- There is no cookie or ambient browser credential, so CSRF middleware is not part of the protocol.

## Credential handling

Provider credentials are encrypted at rest with `SESSION_ENC_KEY`, submitted write-only, and never
returned in API responses, client persistence, logs, events, or error envelopes. The GitHub token is
read only by the GitHub plugin's credential accessor. The HTTP client is device-principal-only and
does not expose encrypted request material to internal callers.

Child environments are built by the process broker. They do not inherit `SESSION_ENC_KEY`, GitHub
credentials, arbitrary `ACORN_*` values, or the parent process environment. They receive a task-scoped
internal token, the current data-root path, and the TLS trust material needed to call the Node.

The node-owner identity is opaque, explicit, and persisted at first boot. It is independent of
provider connections, and internal auth fails closed if it is unset. A task-scoped token cannot use
another task's task-addressed routes, terminal streams, preview tunnel, or worktree operations.
Provider-credential restrictions are route-specific; the current GitHub routes can be reached by an
authenticated internal principal and therefore can spend the active owner's GitHub credential.

## Process, path, and configuration controls

- Plugins use CoreServices for filesystem access and Git. The filesystem service applies one
  symlink-aware data-root/worktree confinement policy.
- Short-lived task work goes through the process broker, which uses explicit working directories,
  environment allowlists, process-group termination, bounded output, and production timeouts.
- Long-lived engines own their own children, under the same environment hygiene. The broker's model is
  "run a bounded command, capture its output, kill its group" — which does not fit a PTY, a JSON-RPC
  agent driver, a `docker logs -f` stream, a ripgrep scan or a pg client, all of which outlive a
  request and stream as they go. These are an ENUMERATED set, not an open door: the list of files
  permitted to import `node:child_process` is asserted in `tools/arch/boundaries.test.ts`, each entry
  with its reason, and adding one is a decision rather than a drift.

  This paragraph used to claim every child process went through the broker. Nineteen production
  modules did not, and the claim being both untrue and unenforceable was worse than not making it.
- Executable repository configuration (`.acorn/config.toml`, workflow files, and URL scripts) is
  hash-gated. The exact snapshot must be acknowledged before execution; a changed snapshot fails
  closed with `needs-trust`/`config-changed`.
- Docker matching configuration is declarative; Docker and run-target execution remains subject to
  the appropriate trust gate.
- External URLs opened through the OS pass a scheme allowlist. Preview navigation is limited to
  HTTP(S) URLs without userinfo.

## Third-party plugin bundles

A plugin installed on a Node is distributed by that Node: its client bundle travels the existing
broker pipe to every paired device. That makes a Node a source of executable code, so the bundle is
gated twice — once on content, once on consent.

**Trust binds to bytes, not to claims.** The hash a Node advertises in `/v2/core/plugins` is
untrusted input. Electron main fetches the bundle itself (the bytes never pass through the renderer),
hashes what arrived, and stores it content-addressed under that hash. A mismatch against the
advertised value is refused and reported, never re-keyed. Every acknowledgement therefore binds a
plugin id to a hash no one but this device computed.

**Consent is per device and per bundle.** First sight of a `(plugin, hash)` pair prompts, naming the
Node it came from and the permissions the manifest declared. An update arrives as a new hash and
prompts again, showing what the permissions gained. A rejection is remembered. Pairing a new machine
re-prompts, exactly as it re-pairs — the decision is about code this machine will run, so it is this
machine's to make. This mirrors repo-config trust one level out: that binds a project to the hash of
a config the Node will execute and is stored on the Node; this binds a plugin to the hash of a bundle
the device will execute and is stored beside the device token.

The threats this closes, and the ones it does not:

- **A compromised or hostile paired Node serving malicious JavaScript** — hash-verified bytes, a
  per-device acknowledgement that names the Node, and (phase 3) the sandboxed frame the bundle runs
  in. Nothing a Node pushes runs unprompted.
- **A Node lying in its listing** about hash, version or permissions — the hash is recomputed from the
  bytes. The permissions shown are the manifest as the Node's own loader read it; a Node that lies
  there also controls the bytes, so the containment rather than the disclosure is what bounds it.
- **Cache poisoning** — only main writes the cache, and content addressing means a poisoned entry
  cannot masquerade under a previously accepted hash.
- **Downgrade** — resolution prefers the highest version whose plugin-API major this client speaks. A
  Node offering an older bundle adds a candidate; it cannot evict a newer accepted one.
- **Not closed: the Node half.** A loaded plugin's node code runs in the Node's process, disclosed and
  acknowledged — the same trust class as an editor extension. Its declared `node` permissions shape
  the context it is handed; they are not enforced against a bundle that imports `node:fs` directly.
  Every surface that renders them says *declared*. `docs/security.md` holds the full
  model and the route to a hard boundary.

The only way a package reaches a Node's install directory is the owner-authenticated install route
(`POST /v2/core/plugins/install`, device principal only, audited). Nothing is distributed to a device
until a Node's owner has installed it, and nothing runs on a device until that device has separately
acknowledged the exact bundle bytes.

Frame key capture is also manifest-bounded. A frame already sees key events delivered to its own
document, but it may suppress shell forwarding only for modified chords listed in `claimsKeys`; those
claims are shown in the trust prompt and Settings. Runtime code may narrow the list, never extend it,
and the palette, settings, task-switching, and Escape chords are unclaimable.

A loaded plugin may declare a host-owned webview. Unlike its sandboxed interface frame, the remote
page has live network access and its own cookies/login state for the life of the process. The trust
prompt names the declared hosts as a separate grant. Electron enforces that allowlist across requested
navigations and redirects, and gives each surface an isolated ephemeral partition. The plugin gets no
page preload, CDP driver, devtools, tunnel headers, script injection, or `postMessage` path, so it can
choose the URL but cannot inspect or operate the page.

## Node-half plugin security

The section above is about bundles a Node distributes to a device. This one is about the code a
loaded plugin runs *inside the Node*, which is a different trust class and the weaker of the two.

Stated once and bluntly: **a loaded plugin's node bundle runs in-process in the Node and can do
anything the Node process can do.** Everything that shapes or displays its `permissions.node` block
is least privilege for cooperative code and honest disclosure for users — not a security boundary.
Every surface that renders those permissions must say *declared*, not *enforced*; the trust
prompt's footer line ("This plugin's server code runs with the same access as acorn itself") is the
canonical wording.

### Threat model

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

### The containment ladder

Each rung is real, additive, and independently shippable. The phases implement rung 1; rungs 2–3
are the "Future work" node-sandbox entry, specified here so nothing in the shipped phases forecloses
them.

#### Rung 1 — Permission-shaped context (phase 1, shipped with the loader)

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
than merely exposed to them: identity and write methods use `ProjectRef` projections, so a plugin
can resolve project identity without seeing the config columns on the row and without ever holding
the core database handle. The methods that do return executable configuration (`config`, `setup`
and its trust assertion) require the separate `projects:config` token. That is a real reduction in
what a *cooperative* plugin can touch, and it is why plugins key their rows by `projectId` instead
of reaching for the table.

`ctx.core.prefs` is the companion pattern for a raw service that cannot be narrowed by projection.
A loaded plugin sees only `plugin:<id>:*`, the same namespace its sandboxed frame reaches through
`state.get` and `state.set`, with the same 1 MiB value cap on both halves. Built-ins retain the raw
preference service for core-owned keys. The scoping prevents cooperative loaded plugins from using
the preference table as a hidden cross-plugin channel or corrupting another frame's state.

Two things it does not do. It is not a barrier — a loaded bundle can still open `core.sqlite` and
read the config columns directly; only rung 2 changes that. And even used exactly as intended,
`checkouts()` returns the local filesystem path of every mapped project on the machine. That is a
layout disclosure — where the user keeps their code, how many codebases they have, and often their
employer's project names — and "read projects" does not sound like it. Say so in the phase-5 trust
prompt. Keep identity, executable config and writes split (`projects:read` / `projects:config` /
`projects:write`) so an importer that needs to create projects does not silently arrive with the
same grant as a plugin that only wants to label a row, and neither silently gains the scripts acorn
will execute.

#### Rung 2 — Out of process (the future hard boundary)

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

#### Rung 3 — OS-level sandboxing (the last door)

Per-platform confinement of the plugin child process: Seatbelt profiles on macOS,
Landlock/namespaces on Linux, AppContainer on Windows. This is what actually enforces a
`net` host allowlist and closes raw sockets. Substantial per-platform work; only worth it if the
ecosystem grows plugins that need direct egress. Design nothing that assumes it; foreclose
nothing that enables it (a child process per plugin, rung 2, is the shape all three platforms'
mechanisms confine).

### Secrets: narrow, use-scoped access

The long-term secret-handling target is that plugin code **never holds a decrypted secret**. The
codebase already has the precedent: model providers register adapters
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

Loaded integration providers currently have one compatibility exception:
`PluginProviderRuntime.withConnections` lends a decrypted credential inside a provider-owned async
callback, matching the existing built-in `forEachConnection` contract. It is not a general read or
lookup API, does not expose the secret service, and is owner/provider bounded by the host. Moving the
node half out of process must turn that callback into an explicit broker/visitor protocol—or replace
it with the credential-injecting broker below—rather than add a long-lived secret value to RPC.

Implementation notes for the target broker: this is a `ctx.core` facet (`secrets: true` in the manifest gates it), and
it is the *only* thing `secrets: true` grants — there is no "read secret value" call on the
public surface at all, so there is nothing to abuse or deprecate later. The Node has no general
HTTP client abstraction (docs/http-client.md); the broker is a legitimate new consumer — keep
its fetch usage inside the broker module, same posture as the phase-5 installer.

### Tokens, routes, and agents

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

### Storage

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

### Supply chain

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

### Resource abuse

The UI side has the phase-3 bridge rate limiter. The node side has nothing until rung 2, where
the child process gets OS-level memory/CPU limits essentially for free. Accepted gap; one line
in the threat model, no interim machinery — an in-process watchdog can't stop a hostile plugin
anyway (it shares the event loop it would be policing).

### Design rules (keep the boundary buildable)

Everything above gets cheaper or free once plugins are out of process. These are the rules that
keep rung 2 a refactor instead of a redesign; each is already stated in its phase, collected
here as the checklist reviewers should hold PRs against:

1. **Fetch-shaped route handlers** for loaded plugins (phase 1) — a Hono instance cannot cross a
   process boundary. Shipped for both a plugin's own namespace and loaded provider routes:
   `ctx.routes.fetch(handler)` and fetch-shaped `ctx.providers.integration(provider, handler)` share
   one request-context adapter; a loaded plugin passing Hono is rejected. Provider resource and
   connection work goes through `PluginProviderRuntime`, never through `c.env.DB`.
2. **No `streams`/`channel` for loaded plugins, ever** (phase 1) — the one contribution that
   cannot survive the boundary.
3. **Async-shaped `ctx` surfaces only** on the public plugin-api — no new synchronous
   CoreServices facet or capability signature on the third-party surface; sync calls die at a
   process boundary.
4. **No general secret read path** on the public surface. The current provider callback is scoped to
   one host-controlled connection visit and must become a broker protocol at rung 2; do not add a
   persistent secret-returning method.
5. **Structured-clone-safe arguments/results** for every capability exposed to loaded plugins — no
   live objects or class instances across the seam. Callback-shaped, use-scoped operations must have
   an explicit request/response visitor protocol before the process boundary ships.
6. **Honest wording everywhere** the `node` permission block is rendered: *declared*, not
   enforced, until rung 2 ships — then the same UI flips to *enforced* with no vocabulary
   change, which is the payoff for declaring the schema now.

### Summary table

| Asset | Exposure today (in-process) | Mitigation | When |
| --- | --- | --- | --- |
| User files (`~/.ssh`, …) | Full read/write | fs jail via `--permission` flags | Rung 2 |
| Other plugins' SQLite, `core.sqlite` | Direct open | fs jail + token-scoped core routes | Rung 2 |
| Provider secrets | Importable/decryptable in-realm; provider runtime lends one per connection callback | Owner/provider-bound callback today; credential-injecting broker at rung 2 | Rung 1 scoped, rung 2 absolute |
| Process spawning | Unrestricted | `exec` grant → `--allow-child-process` | Declared rung 1, enforced rung 2 |
| Native code loading | `.node` addon in bundle | `--permission` blocks addons; never `--allow-addons` | Rung 2 |
| Network egress | Unrestricted | Broker allowlist (brokered traffic); OS sandbox (raw sockets) | Rung 1 partial, rung 3 full |
| Webview hosts | Loads remote content the plugin chooses | Manifest host allowlist enforced across redirects; no CDP; isolated ephemeral partition | Webview phases 1/2 |
| Agent sessions | Tool contributions | Third-party tools default disabled/ask | Phase 1/5 |
| Fleet devices | Routes + broadcasts | Task-token opt-in default-no; content-free broadcasts | Phase 1/3 |
| Backups | Plugin-stored secrets survive scrub | Broker + "no secrets in plugin tables" rule; scope by `projectId`, never mirror the project row | Rung 1 |
| Project config scripts (`setup_script`, `dev_script`, …) | Readable through `core.projects.config()` and writable via the core config route; the Node executes them | Separate `projects:config` read grant; config `PUT`s permanently unmapped on the phase-3 bridge; project config trust ack on the node side | Rung 1 (node facet); phase 3 (frames); rung 2 (node half) |
| Project folder paths | `core.projects.checkouts()` lists every mapped codebase | Split `projects:read`/`:write`; name the disclosure in the trust prompt | Rung 1 (disclosure), rung 2 (enforced) |
| Trust over time | Malicious update | No auto-update, hash re-prompt, permission diff, provenance | Phase 2/5 |

## Host-owned webviews and browser automation

The desktop view service owns every `WebContentsView`, with an ephemeral session, no preload,
navigation checks, denied permission requests, and browser chrome outside the guest page. Loaded
plugin surfaces add a manifest host allowlist enforced on redirects and deliberately omit CDP
attachment. Preview supplies its task binding and is the only caller that opts into the CDP driver.
The remote preview tunnel accepts only declared task ports and authenticates its local loopback
request with a per-tunnel secret before forwarding it to the Node.

Agent browser tools use a CDP method allowlist. They do not expose arbitrary JavaScript evaluation.
Secret fields are filled through DOM primitives and are not injected into page scripts.

## Untrusted provider data

Rollbar occurrences and other provider payloads are parsed into bounded, allowlisted projections
before persistence or rendering. Raw payloads, request headers, cookies, bodies, IPs, and arbitrary
provider objects are discarded. Normalization failure rejects the item rather than widening the
surface automatically.

## Filesystem and backup

Data roots, credential files, TLS material, databases, WAL files, blobs, and worktrees are created
with restrictive permissions. A Node lock prevents two processes from opening one root. The app can
report disk-encryption status on macOS and surfaces the warning when it cannot verify full-disk
encryption.

Backups snapshot core and plugin SQLite files through SQLite's online-backup API. Device rows and
credential material are scrubbed, while blobs and worktrees are excluded because they are recoverable
and can dominate archive size. Restore is a documented manual operation into a fresh data root.

## Audit

The append-only core `audit` table retains security-relevant decisions for 90 days. Producers include
pairing-window changes, device pair/revoke, config-trust acknowledgement, secret create/replace/delete,
plugin toggles, and backup. The Settings → Security surface reads it. The trail is
not tamper-evident against someone who already controls the database file.
