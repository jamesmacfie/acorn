# Node plugin security

Part of [security.md](../security.md).

## Node-half plugin security

The section above is about bundles a Node distributes to a device. This one is about the isolated
worker realm that runs a loaded plugin's node half.

The manifest's `permissions.node` block is now an enforced ceiling. The host serializes only the
already owner-bound, permission-shaped context; functions cross as RPC references, so the worker
never receives a core database, registry, or service implementation. Node starts the realm with its
permission model enabled. The plugin package is readable but not writable, only that plugin's three
SQLite paths are writable, network calls go through a hostname-checking `fetch`, and child processes
are absent unless `exec` was declared. Native addons, nested workers, raw sockets, and direct
`node:sqlite` stay unavailable. The worker inherits only the process broker's credential-free base
environment plus explicitly named `env` and `files` grants. A file grant resolves an absolute path
from the named environment variable and is refused inside acorn's data root. The trust prompt therefore puts node grants under *Enforced* beside
the client broker's grants. Scheduled work and task checks remain *Declared*: acorn confines when and
where they run, but cannot verify what plugin-authored code intends to do.

This is a resource boundary, not an OS security claim. Node describes its permission model as a
seat belt rather than a sandbox for hostile code, and a worker is not crash isolation. Rung 3 remains
the answer for a deployment that needs an operating-system adversarial boundary.

### The broadcast namespace

One thing in that block *is* enforced, and it is worth separating from everything around it. A loaded
plugin's `ctx.events.send` used to accept any channel name, which meant it could put frames on `term:`
or `workflow:` and impersonate core's own streams — a renderer cannot tell a forged `term:out` from a
real one, because the WS envelope is deliberately open and core routes on the channel alone.

It is confined to `plugin:<its-id>:*`, and naming anything else throws. The worker boundary now backs
that context check: raw network modules are unavailable and the only network global checks its
manifest hostname list before connecting.

A built-in is unaffected. It owns real channel prefixes through `ctx.events.channel`, is compiled into
the binary, and is not the trust class this section is about.

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
  (`packages/node-core/src/server/core/secrets.ts`).
- **The user's account**: `~/.ssh`, `~/.aws`, browser profiles, anything user-readable, plus the
  ability to spawn processes (the Node legitimately owns PTYs, Git, Docker).
- **The fleet**: a plugin's routes and broadcasts reach every device paired with the Node.
- **Agents**: plugin-contributed agent tools execute inside agent sessions that read untrusted
  content.

The isolated realm cannot reach those assets directly. It can reach only what its RPC context and
launch grants name. The loader tests execute both ESM-import and `process.getBuiltinModule` attempts
to open `core.sqlite` and another plugin's database; both fail before `DatabaseSync` is obtained.

### The containment ladder

Each rung is real and additive. Rungs 0–2 are shipped; rung 3 is the remaining OS boundary.

#### Rung 0 — The client sandbox (shipped)

Before the node-side ladder starts, the client half of a loaded plugin is already contained, and there
are three containers rather than one. A bundle that draws pixels runs in an iframe on its own
hash-addressed origin under `plugin_scheme.rs`'s policy. A bundle that draws a tree runs in a Web
Worker with no DOM at all, under `PLUGIN_WORKER_CSP` (`docs/shell.md § The plugin worker`). Both have
`connect-src 'none'`, so the transferred `MessagePort` is the only way out, and both reach the host
through the same broker, which decides every call from the manifest's scopes.

**The third is the terminal's**, and it exists because a terminal has no iframe and no CSP to put one
under (`docs/tui.md` § The sandbox). A tree bundle runs in a `node:worker_threads` thread
started with `execArgv: ['--permission', '--allow-fs-read=<bootstrap>', '--allow-fs-read=<bundle>']`,
and the two transferred ports are the only way out of it. Three things are worth stating, because two
of them correct what the design expected:

- **A worker thread's grants are its own.** The design assumed `--permission` was process-wide and
  inherited, and planned a child process per plugin with the ports over IPC as the fallback. Measured
  on Node 24 and 26, `execArgv` applies the permission model to the thread: the worker is denied a read
  the parent is allowed. So the fallback is not needed, and the TUI process itself runs with no
  permission flags at all.
- **The terminal grants no network access.** The CSP gave the DOM worker that default for free; the
  Node worker also starts without a network grant. Its bootstrap
  (`apps/tui/src/plugins/pluginWorker.js`) runs before a stranger's module scope and installs a
  `module.registerHooks` resolver that refuses
  `net`, `http`, `https`, `http2`, `tls`, `dgram`, `dns`, `quic`, `child_process`, `worker_threads`,
  `cluster`, `module`, `vm`, `inspector` and `repl`, and deletes `fetch`, `WebSocket`,
  `XMLHttpRequest`, `EventSource` and `navigator`. `module` is on that list so a bundle cannot register
  a hook of its own and undo this one; `worker_threads` so it cannot start a thread that inherited
  none of it.
- **The permission grants are real paths.** Node compares resolved paths, so a grant naming one that
  goes through a symlink matches nothing and the worker cannot read the bundle it was started for.
  Both grants are `realpathSync`'d.

Everything above the sandbox is shared with the desktop: the same worker host, the same handshake, the
same heartbeat and grace, the same whole-batch pre-flight check and prop sanitiser
(`packages/client-core/src/host/tree/treeState.ts`), and the same broker deciding every bridge call
from the manifest's scopes. Two shells over one set of rules, which is why the terminal added no
security decision of its own beyond the two bullets above.

The tree path is the stricter of the two, and worth stating as a security property rather than a UI
one: the sandbox never produces markup. It produces names of the host's own components and props that
are checked against the kit's role enums, so `class`, `style`, `innerHTML`, a raw URL and a function
have nowhere to be. A prop that fails validation is dropped and the node still renders; a batch that
fails is dropped whole and recorded; a node name this build does not know is omitted. What a worker
that misbehaves can do to the UI around it is nothing. The host terminates it and removes its trees.

**Two messages cross the tree channel in the other direction**, and both are bounded requests rather
than an RPC door (`docs/plugins.md § Asking the owner`). `owner.invoke` calls one action the owning
extension point declared *and* the owner's `Slot` bound a handler for; `overlay.open` presents the one
overlay this contribution's own manifest descriptor named. Everything about their addressing is the
host's: a request is scoped by the slot it arrived on, so plugin code supplies no plugin, point, owner,
overlay or slot id and there is nothing to forge. Payload and reply are each capped at 64 KiB, eight
may be outstanding per slot, an owner has ten seconds to answer, and the failure arm is a code and a
sentence with no host stack in it. `overlay.open` additionally needs focus inside that exact tree and
is throttled to one a second, so a modal stays a person's act rather than something a timer can do.

**Binary bridge calls change no permission.** `api.bytes` is a second wire kind beside `api`, added so
a plugin moving a file does not have to base64 it through a JSON envelope. It runs the identical
`allowApi` decision at the identical point — before the body is touched at all — so your own
`/v1/p/<id>/` namespace is reachable and another plugin's is refused whichever kind asks. The desktop
end-to-end suite pins that by spying at the broker: a denied path must produce no request, not merely
a discarded response. Both directions are capped at 12 MiB, and `type` and `filename` are advisory,
because a sandbox saying what its bytes are decides nothing downstream.

**Cooperative destinations are manifest allowlists.** A loaded frame cannot name another plugin's
pane or route. A surface may declare up to eight local destination IDs, each mapped to one host target
kind. `ui.openDestination` accepts only a declared ID and resource IDs of at most 300 characters. The
host resolves the target through its notification navigation registry. The same declaration may name
one notification kind; `ctx.events.notice` keeps a loaded plugin's target and kind only when both match
that declaration. Every other loaded notice falls back to the plugin's own source and the non-toast
`plugin` kind. Each destination appears as an enforced line in the trust prompt, and its surface,
local ID, target kind, and optional notice kind form the update-diff key. Adding or retargeting one
therefore requires a new decision.

**Four things rung 0 refuses permanently**, and each will be asked for again in words that sound
reasonable:

- **An iframe inside an iframe.** The original request for "let another plugin draw inside my pane",
  taken literally. `frame-src 'none'` in `apps/desktop/src-tauri/src/plugin_scheme.rs` says no, and
  that is load-bearing. An iframe embedded by another plugin's iframe lets the outer plugin overlay,
  resize and clickjack the inner one with no way for the inner one to detect it, puts the messages
  between them out of the host's sight, and makes the outer plugin's trust prompt a lie — "draws a
  pane" cannot describe a tree of other plugins' frames. A rectangle contributed into somebody else's
  point is a **sibling** the host places, never a child of a plugin's document.
- **Free `postMessage` between plugin origins.** Every cross-plugin byte in acorn passes the host and
  is validated against a declared shape. Two plugin origins talking directly cannot be gated, capped,
  logged, or described in a trust prompt. The remote tree, hooks, and rectangle slots all carry
  messages the host checks.
- **Nested slots.** A contributor's subtree grafted into an owner's slot does not itself open slots.
  One level. `Slot` is not one of the node names a tree may emit, so this is enforced by the wire and
  not by convention. A tree of grafts makes the trust prompt a tree and makes "who is drawing this"
  unanswerable.
- **Reopening `frame-src`**, for any reason. The Rust test in `plugin_scheme.rs` that pins the policy
  stays green for the life of the design.

#### Rung 1 — Permission-shaped context (phase 1, shipped with the loader)

The host builds a loaded plugin's `NodePluginContext` from its manifest's `permissions.node`
block: undeclared capability ids return `undefined` from `capabilities.get`; undeclared
CoreServices facets are absent from `ctx.core`; `secrets` and `exec` (the process broker) are
individually gated and default-off; `ctx.events.streams()`/`channel()` are never present for
loaded plugins regardless of manifest. Built-ins keep the full context.

What it buys: honest plugins cannot over-reach by accident, the trust prompt is truthful, and the
ecosystem learns to write minimal manifests from day one. Rung 2 now turns those same declarations
into host and runtime grants.

Implementation notes: gate by **omission**, not by throwing — an absent facet fails at
development time with a TypeError the author sees immediately, and the shape of `ctx` becomes
documentation of the grant. Keep the facet→permission mapping in one module with exhaustive
tests (phase-1 test list).

`ctx.core.projects` (`packages/node-core/src/server/core/projectRefs.ts`) is the model every facet
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

`ctx.core.data` is the host-mediated version of the same rule for databases. `data:query` exposes
connect, catalog, schema and bounded reads while core retains the URL, driver, socket and pools.
Reads run in a read-only Postgres transaction with a host-side timeout and row cap. `data:write` is a
separate high-risk grant and is the only scoped projection that accepts `{ readOnly: false }`; a
plugin cannot turn its read grant into a write by changing an options object.

Two things it does not do. It is not a barrier — a loaded bundle can still open `core.sqlite` and
read the config columns directly; only rung 2 changes that. And even used exactly as intended,
`checkouts()` returns the local filesystem path of every mapped project on the machine. That is a
layout disclosure — where the user keeps their code, how many codebases they have, and often their
employer's project names — and "read projects" does not sound like it. Say so in the phase-5 trust
prompt. Keep identity, executable config and writes split (`projects:read` / `projects:config` /
`projects:write`) so an importer that needs to create projects does not silently arrive with the
same grant as a plugin that only wants to label a row, and neither silently gains the scripts acorn
will execute.

##### Telemetry sinks

`ctx.telemetry` and `ctx.log` are on every node context with no grant at all, and that is deliberate:
a plugin measuring its own work reads nobody else's, the host binds the owner rather than taking one,
and the records go nowhere unless the owner turned telemetry on and something subscribed.

Reading the stream is the opposite, and it is the one facet on `ctx.core` that returns other
packages' data by design. A sink registered through `ctx.core.telemetry.onBatch` sees every record
from every owner: core's request timings and route patterns, another plugin's schedule and hook
runs, and the log lines of packages the owner installed for a completely different reason. So it is
its own `telemetry` token, and the trust prompt draws it **high**, with a sentence that says whose
records they are rather than "read telemetry".

Three things bound what a sink can learn ([telemetry.md](../telemetry.md) § What never leaves the
machine). Attributes are allowlisted scalars chosen at each seam, so there is no field a body, a
diff or a query could arrive in. Names are patterns and ids ride as attributes, so a route reads as
`/v1/core/tasks/:id`. And every message passes a scrubber that strips control characters, collapses
the owner's home directory and the data root, and replaces credential-shaped runs. A boundary that
already withholds a message keeps withholding it: `onServerError` sends a name and a code because
drivers embed bound values in `err.message`, and its record carries the same and no more.

The telemetry token remains a rung-1 disclosure decision: an owner can grant or refuse the stream,
and the host scopes the RPC surface accordingly. The worker boundary prevents a plugin from walking
around that decision by importing the host's telemetry graph or opening `core.sqlite` directly.

#### Rung 2 — Isolated Node realm (shipped)

Each loaded plugin's node half runs in its own `node:worker_threads` realm. The worker starts with
Node's permission model enabled and reaches the host only through one `MessagePort`. The host exports
an already owner-bound, manifest-shaped `ctx` over that port; registrations, fetch-shaped route
handlers, capabilities, and the few synchronous public calls all retain their published signatures
through structured-clone RPC.

The launch grant is intentionally narrow:

- the worker may read the installed plugin package and the trusted bootstrap/runtime dependencies;
- a plugin with migrations may read and write only its pre-created database, WAL, and SHM paths;
- the worker environment starts from the process broker's credential-free base. Explicit `env`
  names add individual values; `files` resolves individual absolute paths from named values and
  refuses anything under acorn's data root;
- the worker opens that database itself, validates the applied migration history, and never receives
  the host database or storage service;
- direct `node:sqlite` access is refused, including the `process.getBuiltinModule` path that would
  otherwise bypass Node's filesystem permission checks;
- raw socket modules are refused. `fetch` exists only when `permissions.node.net` is non-empty.
  Exact hostname grants return redirects unfollowed so the next request re-enters the check. An
  explicit `'*'` grant permits any hostname and follows the caller's redirect policy;
- child processes exist only with the explicit `exec` grant. Nested workers and native addons are
  never granted.

Reload preserves the existing candidate-then-commit contract. A candidate gets a fresh realm and
module graph, buffers its host registrations, and replaces the previous realm only after import,
dependency validation, and `init` succeed. A rejected or failed candidate is terminated; after a
successful commit the previous realm is disposed and terminated.

The acceptance test uses two deliberately hostile plugins. One imports `node:sqlite`; the other asks
`process.getBuiltinModule` for it. They attempt to open `core.sqlite` and a peer plugin database and
both fail before obtaining `DatabaseSync`.

This rung narrows ambient authority and turns the manifest into an enforced host/realm boundary. It
does not claim OS-grade hostile-code isolation: Node describes its permission model as a seat belt,
workers do not provide crash isolation, and an explicitly granted child process is an intentional
escape hatch. Those are rung 3 concerns.

#### Rung 3 — OS-level sandboxing (the last door)

Per-platform confinement of a plugin process: Seatbelt profiles on macOS,
Landlock/namespaces on Linux, AppContainer on Windows. This is what actually enforces a
`net` host allowlist and closes raw sockets. Substantial per-platform work; only worth it if the
ecosystem grows plugins that need direct egress. Design nothing that assumes it; foreclose
nothing that enables it. Moving the shipped RPC contract from a worker to a process is the migration
path if crash isolation or an OS policy becomes necessary.

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

Loaded integration providers currently have three compatibility exceptions, each owner/provider
bounded by the host and none a general read or lookup API:
`PluginProviderRuntime.withConnections` lends a decrypted credential inside a provider-owned async
callback, matching the existing built-in `forEachConnection` contract; a connection contribution's
`projects.list({ connection, secret })` is the same lend for the project picker's enumeration; and
`PluginProviderRuntime.items(providerId)` returns a provider-scoped store object synchronously rather
than plain data over an async call. Moving the
node half out of process must turn the two credential callbacks into an explicit broker/visitor
protocol—or replace them
with the credential-injecting broker below—rather than add a long-lived secret value to RPC, and must
put a proxy in front of the item store. Each new callback- or object-shaped contract added to this
list raises the cost of that move; prefer a route the host fetches when one can express the job.

Node-side contributions with no request, currently GitHub's task-scoped create-PR agent tool, use the
singular `ctx.providers.withConnection(userId, providerId, callback)` counterpart. The host checks
that the plugin owns the provider, chooses only the first usable connection so a write cannot fan
out, lends the secret for that callback, and applies the same scrub-on-throw scope. It exists because
a task-scoped child cannot call provider-spending routes directly; the write-tier tool invocation is
the authorization event, and the trusted Node plugin performs the provider operation.

Implementation notes for the target broker: this is a `ctx.core` facet (`secrets: true` in the manifest gates it), and
it is the *only* thing `secrets: true` grants — there is no "read secret value" call on the
public surface at all, so there is nothing to abuse or deprecate later. The Node has no general
HTTP client abstraction (docs/http-client.md); the broker is a legitimate new consumer — keep
its fetch usage inside the broker module, same posture as the phase-5 installer.

### Tokens, routes, and agents

- **Plugin routes vs task-scoped tokens.** Decide explicitly, default no: task-scoped internal
  tokens (agents, PTY children, the MCP child) cannot reach `/v1/p/<third-party>/*`. Otherwise a
  prompt-injected agent can drive a malicious plugin's routes with the task's authority. Opt-in
  per route via explicit metadata when a plugin genuinely serves task-scoped consumers, surfaced
  in the permission prompt.
- **Agent tools are a prompt-injection surface.** A plugin-contributed tool is callable by an
  LLM reading hostile content. The existing risk-metadata and per-owner tool-permission
  machinery (docs/agent-tools.md) applies, with a stricter default for third-party tools:
  **disabled or ask-every-time until the owner enables them**, regardless of the plugin being
  trusted for everything else. Trusting a plugin's code and trusting an agent to call its tools
  autonomously are different decisions; keep them separate in the UI.
- **Findings has no workflow-gate authority today.** Observations and memory candidates remain
  advisory, and findings contributes no `workflows:policy`. A future opted-in policy must evaluate
  only decision requests explicitly bound by the workflow definition, against the exact evidence
  revision at execution time. Missing policy code, stale evidence, and incomplete obligations fail
  closed. Clearing a required fix is a device-authenticated decision—addressed, explicit risk
  waiver, or verified not applicable—and is never an agent tool. Acknowledgement, snooze,
  withdrawal, dismissal, or a model-assigned severity grants no authority.
- **A reviewer prompt is not a sandbox.** Before a provider can be advertised for a read-only
  reviewer preset, conformance tests must prove both the Acorn tool ceiling and the provider-native
  restriction on edits, shell commands, and other write paths. A provider that cannot enforce both
  is unavailable for that preset. This is separate from CI or repository merge enforcement, which
  would need its own versioned check receipt and integration.
- **Loaded tool and context routes inherit task authority, never device authority.** Manifest
  `agentTools[].handler` and `contextSections[].read` paths are confined to the declaring package at
  parse time. Core invokes them with an internal principal whose user, task, session and signed tool
  ceiling came from the authorized caller; IDs in the body cannot widen it. The task principal is
  deliberately unable to enter device-only approval, memory-authority or cross-plugin routes. Tool
  schemas, responses, deadlines and output sizes are bounded before data reaches MCP or prompt
  assembly, and one failed context section is recorded as unavailable without failing its siblings.
- **The `execute` tier denies by default.** A tier the owner has never expressed an opinion about
  falls back to `TOOL_TIER_DEFAULTS` (`@acorn/protocol/toolPermissions.ts`), where `execute` is
  `false`. The fallback used to be `true` for every tier, which meant shipping a new execute tool
  granted it to every existing installation on upgrade, silently: the owner had approved a list that
  no longer described what the agent could do. `read` and `write` stay allowed and are written out
  rather than left implicit, so the next tier added has to say which it is. The node and the settings
  page read the same constant, so an untouched tier draws as off in Settings → Agent tools and is
  denied on the wire.
- **Delegation authority is direct and fail-closed.** The Agents plugin records each spawn's signed
  owner task and session before it creates a child. Prompt, wait, read, and cancel require that exact
  owner and child pair. Missing, foreign, sibling, ancestor, descendant, and cross-task identifiers
  all return the same `not_found` result. A managed child cannot approve its own permission or
  question request through the orchestration tools.
- **Tool ceilings only narrow.** A delegated child receives the intersection of its parent's signed
  ceiling and an optional requested ceiling. A workflow-owned managed session cannot spawn a child,
  because workflow budget accounting does not include delegated descendants. The execute permission,
  depth-two limit, 12-live-descendant limit, and managed runtime concurrency ceilings remain separate
  gates.
- **Broadcast hygiene.** `ctx.events.status()` is content-free by design; keep every
  third-party-reachable broadcast content-free or plugin-self-scoped so one plugin's events can
  never carry another's data to a subscribed frame (phase-3 bridge filters by declared channel;
  this rule is what makes that filter sufficient).

### Storage

- **Migrations** run in the Node at boot against the plugin's own file only
  (`packages/node-core/src/server/plugins/migrations.ts`). SQL is data, not code, but verify the
  plugin database factory (`server/plugins/storage.ts`) keeps `load_extension` unavailable
  (the default `server/storage/sqlite.ts` pins) and never grants `ATTACH` reach into other files — an attached
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

- npm's published `dist.integrity` is compared against the downloaded bytes, and a mismatch fails the
  install with nothing written (`server/plugins/installer.ts`). It used to be recorded into provenance and
  never checked, which made it a note about the package rather than a statement about what ran. A
  package the registry publishes no integrity string for still installs — refusing would break every
  older package that only ever published a shasum — and the lockfile records the archive hash either
  way.
- The phase-5 lockfile hash-pins what was installed and records source + resolved version — for every
  source that was *fetched*. A `{ path }` folder install is outside this section entirely and always
  will be: it is symlinked, its bytes keep changing, and it pins nothing (§ Installing from a folder).
  Signing will not cover it either. Add **provenance** for the fetched sources: resolved commit SHA /
  release tag / npm integrity value, so "what exactly is running" is answerable after the fact and
  auditable across a fleet.
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

The UI side has the phase-3 bridge rate limiter. The node half now has a separate event loop, so a
busy plugin does not share core's loop, but a worker still shares the process's memory and CPU budget.
Per-plugin operating-system resource limits require rung 3 or a move from workers to processes.

### Design rules (keep the boundary intact)

These are the rules that made rung 2 possible and now keep later API work from punching around it:

1. **Fetch-shaped route handlers** for loaded plugins (phase 1) — a Hono instance cannot cross a
   process boundary. Shipped for both a plugin's own namespace and loaded provider routes:
   `ctx.routes.fetch(handler)` and fetch-shaped `ctx.providers.integration(provider, handler)` share
   one request-context adapter; a loaded plugin passing Hono is rejected. Provider resource and
   connection work goes through `PluginProviderRuntime`, never through `c.env.DB`.
2. **No `streams`/`channel` for loaded plugins, ever** (phase 1) — the one contribution that
   cannot survive the boundary.
3. **Prefer async-shaped `ctx` surfaces** on the public plugin API. Existing synchronous
   registration and codec calls are supported by the worker RPC transport, but a new synchronous
   cross-realm call must justify blocking both realms and staying within the bounded reply size.
4. **No general secret read path** on the public surface. The current provider callback is scoped to
   one host-controlled connection visit; do not add a persistent secret-returning method.
5. **Structured-clone-safe arguments/results** for every capability exposed to loaded plugins — no
   live objects or class instances across the seam. Callback-shaped, use-scoped operations need an
   explicit request/response visitor protocol.
6. **Honest wording everywhere** the `node` permission block is rendered: filesystem, network,
   child-process, and host-context ceilings are *enforced*. Plugin-authored timing and intent remain
   *declared*.

### Summary table

| Asset | Loaded-plugin exposure today | Mitigation | When |
| --- | --- | --- | --- |
| User files (`~/.ssh`, …) | No access unless an owner accepts an explicit environment-backed file grant | exact-path `--permission` grants; data-root paths refused | Rung 2 |
| Node environment | Credential-free base plus individually declared names | scrubbed worker `env`; each inherited name is a high-risk trust line | Rung 2 |
| Other plugins' SQLite, `core.sqlite` | Direct open refused | exact plugin DB/WAL/SHM grant; direct `node:sqlite` refused | Rung 2 |
| Provider secrets | Provider runtime lends one per owner-bound connection callback | scoped RPC callback; future credential-injecting broker can remove plaintext from the plugin realm | Rung 1 scoped, rung 2 contained |
| Process spawning | Refused unless `exec` is declared | `exec` grant → `--allow-child-process` | Rung 2 |
| Native code loading | Refused | `--permission` blocks addons; never `--allow-addons` | Rung 2 |
| Network egress | `fetch` only to declared hostnames; raw network modules refused | realm allowlist today; OS sandbox for an adversarial boundary | Rung 2 enforced, rung 3 hardened |
| Webview hosts | Loads remote content the plugin chooses | Manifest host allowlist enforced across redirects; no CDP; isolated ephemeral partition | Webview phases 1/2 |
| Agent sessions | Tool contributions | Third-party tools default disabled/ask | Phase 1/5 |
| Fleet devices | Routes + broadcasts | Task-token opt-in default-no; content-free broadcasts | Phase 1/3 |
| Backups | Plugin-stored secrets survive scrub | Broker + "no secrets in plugin tables" rule; scope by `projectId`, never mirror the project row | Rung 1 |
| Project config scripts (`setup_script`, `dev_script`, …) | Available only through `core.projects.config()` when granted; config writes remain unmapped | Separate `projects:config` read grant; project config trust acknowledgement | Rung 2 (node half); phase 3 (frames) |
| Project folder paths | Available through `core.projects.checkouts()` only when granted | split `projects:read`/`:write`; name the disclosure in the trust prompt | Rung 2 |
| Every other owner's telemetry | A sink sees core's request timings and every plugin's spans, logs and error names | Its own `telemetry` token, drawn high; allowlisted scalar attributes; route patterns rather than URLs; a scrubber on every message; off unless the owner turned it on | Rung 1 (disclosure), rung 2 (enforced) |
| Trust over time | Malicious update | No auto-update, hash re-prompt, permission diff, provenance | Phase 2/5 |
| Install on an agent's say-so | Prompt-injected agent asking for a hostile package | Request/decision split: the tool cannot install, the device does, the owner decides in shell chrome | Shipped |
| A plugin in dev mode | New bundle hashes load without individual review | Same isolated realm; bounded to one `(plugin, node)` the owner chose; badged, revocable, audited | Shipped |
| The terminal client's device token and plugin consent files | A process on this machine running as the user can read them | `0700` directory, `0600` files, the same discipline as the node's own keys; the token stays in the broker module and the consent file in the custody module, held by an arch rule | Shipped |
