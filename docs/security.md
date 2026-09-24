# Security model

acorn is single-owner software. A paired device has full owner authority for its Node. Security
controls therefore protect the transport, credential custody, process boundaries, repository data,
and untrusted provider/preview content rather than implementing multi-user roles.

## Trust boundaries

- Renderer: UI code and third-party preview content; no device token, certificate, database
  handle, process object, or direct network access.
- Desktop shell and its helper: native host, broker, certificate pins, device-token custody, window policy, and
  preview `WebContentsView` host.
- Node: authoritative data and execution environment. It is intentionally able to run developer
  tools, so a compromised Node account is outside the application threat model.
- Node child: task-scoped internal caller. It receives only an allowlisted environment and scoped
  token; its routes and task identity are checked by the Node.
- Terminal client (`acorn`, `docs/tui.md`): the first two collapsed into one process. UI code
  and the broker share a realm, so what the desktop holds as a process boundary this holds as a module
  boundary: the device token lives in the broker's module, the plugin cache and the acknowledgement
  file live in one custody module, and an arch rule refuses an import of either from anything in
  `apps/tui` that draws a cell. A loaded plugin still gets a realm of its own — a worker thread under
  `--permission` — so the boundary that matters most is the one that did not move.

The application does not defend against root/other-user access to the host, a compromised Node
account, or malicious first-party plugin code. Those are OS/deployment concerns.

## Transport and auth

- Nodes bind to `127.0.0.1` over TLS 1.3 and reject unexpected `Host` values.
- The certificate is self-signed, persisted in the Node data root, and pinned by fingerprint in the
  helper's broker. A changed fingerprint is a hard stop.
- The bearer rides the `/v1/events` upgrade request's headers, which a browser cannot set. On the
  desktop that is why the socket belongs to the helper rather than the renderer. The terminal client
  (`docs/tui.md`) is one process running under Node, so it sets the header itself: equal to
  the desktop, easier than a browser. What the desktop holds as a process boundary the terminal holds
  as a module boundary, and an arch rule keeps it — nothing in `apps/tui` that draws a cell may
  import custody.
- Every protected HTTP route passes request-id, principal resolution, the auth gate, and then the
  idempotency middleware before reaching a router.
- `/v1/node` and `/v1/pair` are the only pre-auth routes. Device management, plugin toggles, audit,
  security, backup, schedules, preferences, projects, and workspaces are device-only.
- `/v1/events` authenticates the upgrade and rechecks device activity for long-lived streams.
- Revoking a device (`DELETE /v1/core/devices/:id`) closes that device's live sockets immediately and
  fails its in-flight requests. A device can revoke its own row; that is the same effect as unpairing
  itself.
- A bearer that authenticated is remembered for 60 seconds, keyed by the SHA-256 of the whole token,
  so a client holding a live socket does not run a `SELECT` and a constant-time compare per request
  (`packages/node-core/src/server/auth/deviceTokens.ts`). Only a token that resolved is remembered: a
  wrong secret and an unknown id read the row every time, so neither can become a warm entry.
  **Revoking a device drops its entries before it notifies anyone.** Without that, a revoked bearer
  would keep working for the rest of the window, which is a credential the owner believes they took
  away. The 60-second window matches the socket sweep's, so the only way an entry can outlive its
  device is a revoke this process never saw. `isActive`, which that sweep reads, is never cached.
- There is no cookie or ambient browser credential, so CSRF middleware is not part of the protocol.

`requireUser` is the single gate mounted over `/v1/*`. It accepts either credential kind, device or
internal, because product routes such as the MCP server and agent sessions legitimately read and
write task data as the owner. `requireDevice` is narrower and sits in front of surfaces an
agent-spawned child must never reach: pairing, device management, plugin administration, audit,
security, backup, and schedules. Before `requireDevice` existed, the internal token injected into
every PTY and agent session environment was a complete privilege escalation: a prompt-injected agent
could call `POST /v1/core/pair/start`, read the pairing code back out of the response body, pair
itself a device, and walk away with a permanent owner-authority token. `requireDevice` answers 403
rather than 401 for this case: the caller authenticated fine, it just is not the owner at a keyboard,
and a 401 would invite a retry loop instead of stopping it.

Preferences, projects and workspaces joined that list after a route review found each of them
reachable by an agent's own token. The preference one mattered most: the agent-tool permission ceiling
is a preference key, so a task-scoped token could raise its own ceiling and then call the tool it had
just granted itself — the control designed to contain a rogue agent, liftable by the rogue agent. The
project row holds `setup_script`, `dev_script`, `dev_restart_script`, `teardown_script`,
`db_url_script` and `run_targets`, all commands this node runs later, so a write there is code
execution with a delay on it. Workspaces are lower stakes and destructive: none of those routes is
task-addressed, so nothing narrowed a delete to the caller's own work. If an agent tool ever needs to
read its own project's configuration, that is a task-addressed route under `/v1/core/tasks/:id/...`,
not a widening of this gate.

`server/mountCoverage.test.ts` is what keeps the list from drifting again. It builds the app, reads
every route under `/v1/core` off it the way a request does, and fails unless each one is covered by a
gate mount or named in an allowlist with the reason it is open to a task token. Three route reviews in
a row found the same shape of hole — a route that should have been device-only was mounted at
`requireUser` because nobody wrote the line, and nothing failed when they didn't. Adding a route under
an already-gated prefix is still free; adding one anywhere else is now a decision someone writes down.
The test reads a trailing `/*` strictly, as not covering the bare path, which is why every gate below
is written in both forms: the Hono this repo pins does match the bare path, that behaviour has moved
between versions, and a gate that is correct only on today's version rots quietly.

Two core lists are filtered rather than gated, the same answer terminal's session roster gives:
`GET /v1/core/tasks` and `GET /v1/core/task-statuses`. A task-scoped caller has a legitimate reason to
ask about its own task and no reason to be handed every other active task's title, branch, absolute
worktree path and dirty count. `task-statuses` filters before it runs any Git, so a confined caller
polling it cannot make the node do work for tasks it may not see. The `task-statuses` filter closes a
second caller too, since plugin frames reach that path under `core.tasks:read`.

Plugin routers registered with `prefix: ''` sit outside every core mount gate and have to carry their
own. GitHub's OAuth device-flow pair (`/auth/device/start`, `/auth/device/poll`) did not, so a
task-scoped token could open a device window, show the owner a code for an account the agent controls,
and end up with that account's token stored as the owner's GitHub connection — a confused deputy, with
every later GitHub call made on the attacker's behalf. Both are `requireDevice` now: connecting an
account is always a person at a keyboard. Notes' workspace routes are the same shape and the same
answer, in `plugins/notes`.

Both gates, and the task-scope and provider-access gates below them, are applied to a router's mount
path in `server/index.ts` rather than inside each handler. A route added later under an already-gated
prefix inherits the gate automatically instead of depending on someone remembering to add a check to
it. An adversarial review found the per-route form of this check applied at exactly one call site out
of six for task scope, leaving `/v1/core/tasks/<other>/preview-url` reachable by another task's
credential for arbitrary shell execution in that task's worktree; mounting the gate is what keeps a
newly added route safe by default instead of by memory.

The task-scope gate matches a task id out of the URL, so it only reaches routes that carry one. Real
plugins mount two shapes: `prefix: '/tasks'` with `/:id/...` underneath (changes, database, editor),
or `prefix: ''` with `/tasks/:id/...` underneath (memory, workflows, docker). A route addressed by an
opaque id instead, such as terminal's `/sessions/:sid`, agents' `/sessions/:sessionId`, or workflows'
`/runs/:runId`, carries no `:id` for the gate to match, so its own router has to resolve the owning
task and enforce the scope itself. That is a named exception to "mount the gate, don't check by hand,"
not an oversight, so a route on this list has its own scope check to show for it.

Terminal's routes (`plugins/terminal/src/server/routes/terminal.ts`) show what that self-check has to
get right. The guard resolves the owning task for a session id before any handler runs, and answers an
unknown session id with the same 404 as a foreign one, so a task-scoped caller cannot use the response
to learn which session ids exist. Before the fix, a task-scoped credential could `POST
/sessions/<any-id>/send` and type a shell command into another task's terminal. The session roster is
filtered rather than gated, since a caller may legitimately list its own task's sessions; unfiltered,
`list()` handed every caller every task's session titles and ids, the same shape of leak as an
unguarded `/devices` route. One ordering rule matters too: a missing PTY engine (`dev:node` without
one wired) must still answer with the bridge's 503, not the ownership guard's 404, because the
client's degraded-mode handling keys on the 503 and the two failures are not interchangeable.

The WebSocket hub (`server/transport/wsHub.ts`) had the same class of gap. `authorize()` verified a task-scoped
internal token and returned its claims, but the connection object built afterward discarded them, so
the `term:` dispatch routed by session id alone and every other channel, plus the broadcast path, ran
with no scope check at all. A task-scoped credential could open the socket itself and reach
`docker:exec:open`/`docker:exec:in`, which spawn an interactive shell in any container on the machine:
arbitrary command execution as the owner, from inside another task's context. The scope check now runs
once, before a frame reaches any channel handler or the `term:` dispatch, and it fails closed on an
unknown stream id rather than allowing it, since failing open would make the check bypassable by
racing session creation.

A task-confined connection also receives none of `wsBroadcast`'s frames. No broadcast channel is
task-addressed: `workflow:step:event` carries another task's raw agent stream (assistant text and tool
results), `workflow:notice` carries another task's title, `agent:session`/`agent:event` carry another
task's session, and `term:status`/`docker:changed` are content-free cache-dirty pings whose only value
is to a UI. With nothing to narrow the frame to, the filter withholds everything rather than guessing
at what would be safe to keep. A task-confined socket is not otherwise deaf: its own session's output
still reaches it, through the per-session sink rather than through broadcast.

## Credential handling

Provider credentials are encrypted at rest with `SESSION_ENC_KEY`, submitted write-only, and never
returned in API responses, client persistence, logs, events, or error envelopes. The GitHub token is
read only by the GitHub plugin's credential accessor. The HTTP client is device-principal-only and
does not expose encrypted request material to internal callers.

**A Sentry DSN is a credential, and it is the only one the exporter asks for.** `sentry-telemetry`
stores it through the connection seam, so it is encrypted at rest with `SESSION_ENC_KEY`, submitted
write-only, and lent back to the plugin for the length of one flush through
`ctx.providers.withConnection`. The manifest declares `secrets: false`, which is Rollbar's and
Linear's posture and is accurate: the plugin never calls `ctx.core.secrets`, because core resolves
the row inside its own secret scope. The DSN authenticates ingestion into one project and can read
nothing, which is why an organisation token is not asked for: release health and source-map upload
would need one, and both are out of scope
([integrations.md](./integrations.md) § Sentry). The exporter puts the DSN in the request's
`X-Sentry-Auth` header and in the envelope's own header, and nowhere in a payload; the connection's
label is host and project, never the key.

Child environments are built by the process broker. They do not inherit `SESSION_ENC_KEY`, GitHub
credentials, arbitrary `ACORN_*` values, or the parent process environment. They receive a task-scoped
internal token, the current data-root path, and the TLS trust material needed to call the Node.

**A harness generate spends the CLI's own login, and never a key acorn holds.** A Generate control
can be pointed at an agent CLI installed on the machine instead of at a stored API key
([integrations.md](./integrations.md) § Model providers), and the child that runs it gets no
credential at all. Its environment is the broker's base allowlist plus `AGENT_TOOL_PASSTHROUGH`
(`server/agentProfiles/toolEnv.ts`), which is configuration only: `XDG_CONFIG_HOME`, the npm prefix,
the proxy variables, and the TLS trust files. `ANTHROPIC_*` and `OPENAI_*` are absent from that list
deliberately, because those globs would carry API keys, and a CLI authenticates through its own
stored login under `XDG_CONFIG_HOME`. The child also gets no acorn token, no task, and no MCP server,
so a key held on this node cannot reach it and a tool cannot ask for one. A CLI that is installed but
signed out fails the generate, which is the honest outcome.

The stderr of a failed harness generate goes to the node log with the profile id, the status and the
duration, and never to the client. A CLI writes its own diagnostics there, and those can quote a
config file path, a home directory, or whatever else it read while failing.

Internal tokens are stateless HMAC credentials. A signing key persists across restarts so a
tmux-reattached agent session can keep authenticating after the Node restarts; rotating the key
revokes every outstanding token. Tokens carry no expiry of their own, so scope and key rotation are
the only lifetime controls. Two scopes exist: `service`, for the node's own loopback calls (a
firing schedule, the measure sampler, notes seeding), minted in-process and never placed in a
child's environment; and `task`, for everything handed to a child process, PTYs, agent sessions,
workflow steps, the MCP server. A `task`-scoped token carries the task id it was minted for, and
route handlers compare that id against the task named in the URL before acting. It may also carry a
session id and a server-computed tool ceiling. Both claims are covered by the signature.

Minting a token is not exposed on `CoreServices`: any plugin could then request a token for any
scope, which defeats the point of scoping them at all. Instead the composition root builds a scoped
credential factory and hands it to the plugins that spawn children, terminal and agents, as a
constructor dependency. The factory closes over the signing key and the listener's own address,
neither of which exists until every plugin's `init` has run, so only the composition root can build
it, and only after the fact. A plugin calls it once per child with the scope that child needs, for
example `{ scope: 'task', taskId, sessionId, toolCeiling }` for one managed-agent session. Workflow
and delegated sessions persist the ceiling in their session configuration before the runtime mints
the token. Later general configuration updates retain that field rather than accepting a wider value.

The agent-tool route reads session identity and tool limits only from the verified principal. The
`x-acorn-session-id` and `x-acorn-tool-ceiling` headers are transport metadata and grant no authority.
Session-required orchestration tools disappear from `tools/list` without a signed session claim. A
per-call UUID is transport metadata too, but it is used only after the signed owner and tool name
scope it as an idempotency key.

The node-owner identity is opaque, explicit, and persisted at first boot. It is independent of
provider connections, and internal auth fails closed if it is unset. A task-scoped token cannot use
another task's task-addressed routes, terminal streams, preview tunnel, or worktree operations.
Provider-credential restrictions are route-specific; the current GitHub routes can be reached by an
authenticated internal principal and therefore can spend the active owner's GitHub credential.
Routes that administer or spend a provider connection use a middleware gate one step wider than
`requireDevice`: device principals plus the node's own `service`-scope internal calls, which need
provider reads to warm a mirror. A `task`-scoped token still cannot reach these routes.

Core's own code reads a stored secret through `SecretService.use()`
(`packages/node-core/src/server/core/secrets.ts`), not through a raw decrypt call. Before this
existed, `decryptSecret(row.authRef, c.env.SESSION_ENC_KEY)` appeared at six sites across core and
three plugins, and each site both held the plaintext and had `SESSION_ENC_KEY` itself in scope.
`use()` passes the plaintext into a caller-supplied function and, if that function throws, scrubs the
plaintext out of the thrown error before it leaves the call. That matters because some providers echo
a credential back in a malformed-header error response, and that response gets logged, wrapped in an
`ApiError`, and sometimes returned to a client; scrubbing at the one point that sees both the secret
and the failure closes that leak. `use()` does not stop a caller from returning the plaintext out of
its own scope, since TypeScript cannot express that restriction; the containment that matters, an agent
reaching a credential at all, comes from internal-token scoping, not from this shape.

`reveal()` is the named escape hatch for a call site that hands the credential to a long-lived
consumer whose lifetime this scope cannot bracket, such as a database connection pool or a driver's
child-process environment. Every call to `reveal()` sits outside the scrub-on-throw guarantee.

## Process, path, and configuration controls

- Plugins use CoreServices for filesystem access and Git. The filesystem service applies one
  symlink-aware data-root/worktree confinement policy
  (`packages/node-core/src/server/core/fs.ts`). Four call sites used to each check
  this on their own: `server/worktrees/taskWorktree.ts`'s lexical-plus-symlink check, `server/worktrees/pathGuards.ts`'s lexical-only
  check, the agents plugin's own realpath-and-relative pass, and the editor plugin's `confine()`
  wrapper. Lexical-only is not enough on its own: a worktree holds arbitrary checked-out content,
  including a symlink an untrusted branch added that points at `~/.ssh`, and a lexical check lets that
  through. `resolveInRoot` stayed the one implementation everywhere except the Docker plugin's
  container-label matcher, which compares paths reported by the daemon inside a container namespace;
  resolving those against this host's filesystem would be wrong, not merely redundant.
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
- Executable configuration is hash-gated: the repository's own files (`.acorn/config.toml`, workflow
  files, and URL scripts) **and the project row's script columns**. The exact snapshot must be
  acknowledged before execution; a changed snapshot fails closed with `needs-trust`/`config-changed`.
- A workflow definition stored as a `workflow_defs` row is executable configuration with no committed
  bytes, so it is owner-typed instead of hashed. Every route under `/v1/p/workflows/defs` is
  device-only, and a start by id refuses a row to a task-confined caller while still allowing a
  committed file, which the snapshot does cover. Save to repo turns the row into a file and hands it
  back to the snapshot: the write is a slug of the definition name, confined to `.acorn/workflows/`
  by `resolveInRoot`, and the next start from that file asks for the acknowledgement
  ([workflows.md](./workflows.md) § Database definitions).
- A child workflow is resolved in its parent task's workspace and project before any child task is
  created. Repository definitions re-enter the configuration trust check; database definitions stay
  device-owned. The child receives its own task-confined token, never the parent's token. Its tool
  ceiling, turn and token limits, cost limit, and deadline can only narrow the root's approved
  authority. The resolved graph and effective limits are persisted so restart recovery cannot gain
  authority from an edited definition. Cancellation closes admission before it stops descendants,
  which prevents a late child creation from escaping the tree-wide cancel.
- Docker matching configuration is declarative; Docker and run-target execution remains subject to
  the appropriate trust gate.
- External URLs opened through the OS pass a scheme allowlist. Preview navigation is limited to
  HTTP(S) URLs without userinfo.

**Force push, and the abort verb.** The Changes pane's branch bar can replace what a branch's upstream
points at, and it does so with `--force-with-lease` and never a bare `--force`
(`plugins/changes/src/server/localDiff.ts` § `pushArgs`). The lease compares the remote ref against
this node's remote-tracking ref, so a commit somebody else pushed since the last fetch makes the push
fail with a reason rather than disappear. Three things have to agree before a remote commit is
replaced: the reader arms the menu item and presses it a second time, the lease holds, and no
`changes:before-push` handler vetoes — the payload carries `force`, so a branch-protection plugin can
refuse that push alone ([plugins.md](./plugins.md) § Hooks). The abort verb beside it is offered only
while the node's own status read says a merge or a rebase is in flight, and which of the two to abort
is read off the worktree rather than taken from the request: `merge` and `rebase` are argv, and a
subcommand chosen over HTTP is one the panel cannot vouch for.

The untrusted input the trust gate hashes is the repo config **and the project row**
(`server/repoConfigTrust.ts`). The gate started on the premise that the checkout is untrusted and the
database is trusted, and that premise only holds while nothing but the owner can write the database.
`PUT /v1/core/projects/:id/config` is device-only now, so it holds again; the row is in the snapshot as
the belt behind that gate. A write the owner did not make changes the hash, and the next thing that
asks for trust shows the owner the script instead of running it. `run_targets` is hashed with the five
script columns: what that JSON holds is `command`, `stop` and `restart` strings the run pane executes,
so leaving it out would put the same hole one column over.

Widening the snapshot changes the hash, so a project that already has script columns set will ask for
one re-acknowledgement the next time something gated runs. That is the correct answer rather than a
migration: the owner is being shown a snapshot that now covers more than the one they approved.

Which paths ask. The three call sites that assert trust are the ones where the *checkout* authored what
runs: a run target whose winning layer was the repo's config file, a `db_url_script` from the same
place, and a workflow defined in the repo. The setup and teardown scripts run from the project row
without asking, because the owner typed them into the settings form. That is the honest scope of the
gate: extending the snapshot makes a change to the row visible wherever trust is asked, and does not by
itself put a prompt in front of a script the owner wrote.

Two things `.acorn/config.toml` no longer does. `[scripts] setup` and `[scripts] archive` are parsed
and reported as unread rather than merged: they were merged over the project row for a while and
nothing consumed the result, so a repo could declare a setup script and watch it do nothing. They are
not wired instead of dropped because wiring them would make a committed file run a command on worktree
creation and on archive, and neither path asks this gate first — that is a new execution surface, not a
fix. The `[docker]` table is still read without the gate; the comment on
`plugins/docker/src/server/dockerConfig.ts` now names the two invariants that make that safe, which are
that exec is ref-addressed rather than matcher-addressed and that the WebSocket hub refuses docker
channels to a task-confined socket. If either changes, that table needs the gate.

**A known limit.** `resolveInRoot` is check-then-use: nothing re-validates between the containment
check and the open, so an agent that can write in its own worktree can swap a path component for a
symlink in the window between them. Real, hard to hit, and the honest fix is an `O_NOFOLLOW`-style
open rather than a tighter check, so it is recorded here rather than papered over. The per-task sandbox
(`docs/future/sandbox/sandbox.md`) is the layer that eventually subsumes it.

Before the broker (`packages/node-core/src/server/core/proc.ts`) existed, about sixteen call sites
spawned or exec'd children with their own ad hoc handling, and the inconsistency was not cosmetic.
`plugins/terminal`'s preview capture ran a repo-configured script through `/bin/sh -c` with no `env`
option, so it inherited the node's full environment, `SESSION_ENC_KEY` and `INTERNAL_TOKEN` included,
and had no output cap. The agents plugin's Claude driver spread `process.env` into its child the same
way. The Docker plugin denylisted six named secrets, and the "keep in sync" comment above the list
pointed at a file that no longer existed; a denylist silently misses any binding nobody remembered to
add. Only one site, `server/headless.ts`, killed the child's process group, so everywhere else a hung
child's grandchildren survived and kept the stdio pipes open. The broker fixes this by building a
caller's environment from an allowlist and never spreading `process.env`; a caller that needs more
passes `passthrough: ['DOCKER_*']`, visible at the call site and additive rather than "everything
except what we remembered."

## The control plane, and the inversion it costs

A Node can be provisioned by something other than a person: a control plane creates the machine,
passes an enrollment token in through the environment, and the Node introduces itself on first boot.
That path is off by default, inert when unconfigured, and fully described in
[the enrollment doc](./node-enrollment.md). What belongs here is what it costs.

**A control plane learns a device token for every Node it provisioned, so trusting your control plane
is the whole game.** A device token is full owner authority on that Node ([authentication](./authentication.md)
§ Device tokens): there are no per-token scopes, because this is single-owner software. So enrolling is
not "registering an inventory record". It is handing a service the same credential a paired client of
yours holds.

That is the same inversion the web client already records as its sibling. When a Node serves the app,
the Node is the origin, and per-bundle consent stops being the real consent surface because whoever
controls the Node controls the page that asks. Both cases come down to one sentence: the thing you
chose to trust is the thing you are trusting, and no mechanism further down rescues a bad choice
there.

Four buy-backs, because each is cheap and together they keep the cost bounded:

- **Two tokens, not one.** The enrollment token is single-use and short-lived; the device token is
  the durable credential. A leaked provisioning secret does not become a standing one.
- **The attachment is visible where the owner already looks.** Settings → Nodes names the control
  plane a Node is attached to, since when, and under which enrollment token, read from that Node's
  own `node.json`.
- **Detaching is one button, and it revokes.** It deletes the control plane's device row, so the
  credential stops working immediately, and it changes nothing else about the Node. A detached Node
  keeps working standalone, which is the open-source promise stated as a mechanism.
- **`node.enrolled` and `node.detached` are on the audit trail**, with the failures recorded too: a
  provisioned Node that could not reach its control plane says so rather than looking ordinary.

Deliberately not bought: an allowlist of permitted control-plane URLs. Whoever set the environment
variable made that decision, and a list acorn ships would be security theatre over a choice it cannot
see. What is enforced is the scheme — plaintext http is refused for anything but loopback, because a
durable credential must not cross a network in the clear.

The second seam, a plugin-contributed node provider, has its own consequence and it is smaller: a
provider vouches for a Node's fingerprint, and the desktop host then probes that endpoint and refuses
a certificate whose fingerprint is not the one vouched for. So a provider substitutes for the owner's
eyes at the pairing step and for nothing else. The device token still never reaches the renderer; the
host fetches it from the Node that listed the record. See [plugins](./plugins.md) § Node providers.

**Where the provider's own credential lives, and why that is a caveat rather than a bug.** A node
provider is a plugin, its connection to the control plane is an ordinary connection, and a connection
is held by the Node the plugin runs on. On a desktop install that is the local Node, so the cloud
account credential sits on the owner's machine beside every other integration token. That is the
right answer while every client has a local Node. It stops being one for the web client, which has
no local Node to hold anything, and the credential has to move to a Node the owner picked. Three
constraints already in the code keep that move additive rather than a redesign. Fleet-shaped reads
fan out over every Node and union the results, so a provider answering from a different Node changes
no caller. Node providers register node-side and have no client-side seam, so nothing on the client
holds provider state that would have to follow. And `providerNodeId`, not the endpoint, is the
control plane's identity for a Node, so the same record survives being reached from somewhere else.
The work that moves the credential is [remote access](./future/remote.md). Until it lands, resist
the shortcut of a client-side provider: it would put the credential in the renderer, which is the one
design all three constraints exist to prevent.

## Third-party plugin bundles

A plugin installed on a Node is distributed by that Node: its client bundle travels the existing
broker pipe to every paired device. That makes a Node a source of executable code, so the bundle is
gated twice — once on content, once on consent.

**Trust binds to bytes, not to claims.** The hash a Node advertises in `/v1/core/plugins` is
untrusted input. The helper fetches the bundle itself (the bytes never pass through the renderer),
hashes what arrived, and stores it content-addressed under that hash. A mismatch against the
advertised value is refused and reported, never re-keyed. Every acknowledgement therefore binds a
plugin id to a hash no one but this device computed.

The terminal client has no helper to do that, so it does it itself, with the same two stores
(`@acorn/custody`'s `PluginCache` and `PluginTrustStore`, pointed at `$XDG_CONFIG_HOME/acorn/plugins/`
instead of the app's data directory). Same schemas, same `(pluginId, hash)` key, same refusal on a
mismatch, same file discipline of a `0700` directory and `0600` files. A second implementation would
have been a second set of security decisions, so there is one — and `apps/tui/src/plugins/custody.ts`
is the only file in that package permitted to name either class.

**Storing a bundle is idempotent, and the application's own bundles go through the same door.** The
shell caches and acknowledges the bundles in its own resource directory at every launch, because that
grant covers bytes the build produced and nothing else writes there. Doing it at every launch does not
mean writing at every launch. `putBundled` hashes the bytes, and when the cache already holds that
hash and the file is on disk it returns and touches nothing. The index is rewritten only when a row is
added, the boot sweep rewrites it only when it evicted something, and the trust store compares the
stored acknowledgement field by field, ignoring `decidedAt`, and writes only on a difference. So five
bundled plugins cost five bundle writes and ten fsynced rewrites on the launch after an app update, and
zero on every launch after that. The two disagreement cases still self-heal: a row whose file is gone
is rewritten because the file is checked as well as the row, and a file with no row is deleted by the
sweep.

Skipping a write is not skipping a decision. The hash is still computed from the bytes on every
launch, so a bundle whose contents changed produces a hash the cache does not hold and takes the full
path, and an acknowledgement whose permissions moved is written and re-prompted the same as before.

**Consent is per device and per bundle.** First sight of a `(plugin, hash)` pair prompts, naming the
Node it came from and the permissions the manifest declared. An update arrives as a new hash and
prompts again, showing what the permissions gained. A rejection is remembered. Pairing a new machine
re-prompts, exactly as it re-pairs — the decision is about code this machine will run, so it is this
machine's to make. This mirrors repo-config trust one level out: that binds a project to the hash of
a config the Node will execute and is stored on the Node; this binds a plugin to the hash of a bundle
the device will execute and is stored beside the device token.

**What "gained" means.** Each rendered permission line carries a stable grant key, separate from its
sentence (`packages/client-core/src/host/trust/permissions.ts`). The update diff compares keys, not
copy, so tightening a sentence's wording never re-prompts an existing owner as though the plugin had
grown its reach. Only a key that did not exist before does that. A grant's severity (`icon`, `high`)
rides beside the key as data, not something parsed back out of the copy.

The threats this closes, and the ones it does not:

- **A compromised or hostile paired Node serving malicious JavaScript** — hash-verified bytes, a
  per-device acknowledgement that names the Node, and (phase 3) the sandbox the bundle runs in.
  Nothing a Node pushes runs unprompted. The sandbox is one of three, and the trust decision covers all
  of them because they are the same bytes: the iframe at `app-plugin://<hash>` for a bundle that draws
  its own pixels, a Web Worker for one that draws a tree (`docs/shell.md § The plugin worker`), and — in
  the terminal, where there is no iframe and no CSP — a `node:worker_threads` thread under
  `--permission`. No path asks a second question, and none can start without an accepted hash.
- **A Node lying in its listing** about hash, version or permissions — the hash is recomputed from the
  bytes. The permissions shown are the manifest as the Node's own loader read it; a Node that lies
  there also controls the bytes, so the containment rather than the disclosure is what bounds it.
- **Cache poisoning** — only main writes the cache, and content addressing means a poisoned entry
  cannot masquerade under a previously accepted hash.
- **Downgrade** — resolution prefers the highest version whose plugin-API major this client speaks. A
  Node offering an older bundle adds a candidate; it cannot evict a newer accepted one.
- **CSS injection through a contributed theme** — a `themes` entry is the only manifest field whose
  content ends up inside the shell's own stylesheet, so it is validated at both ends and the values are
  refused rather than escaped. A token value must match a hex literal or a flat colour function whose
  argument alphabet excludes `(`, `)`, `;`, `{`, `}`, `<`, `\`, quotes and every control character;
  the token NAMES are host constants matched by set membership, and the generated selector is rebuilt
  from a bounded id alphabet rather than from any string a manifest supplied. A value that cannot close
  a declaration, close a block, open a nested function or open a tag has nothing left to sanitise —
  which is the same argument brand marks make for shipping path data instead of an SVG document, and
  the reason the host generates the theme block rather than accepting a stylesheet
  (`docs/ui-design.md § Plugin themes`).
- **A contributed harness spawning something else.** A `harnesses` entry names a program acorn will
  run, so it is disclosed under `Enforced` rather than `Declared`: the host spawns exactly the declared
  command with the declared arguments and nothing else, and the plugin gets no process of its own — a
  data-only harness package needs no `exec` grant because it never spawns anything. The whole spawn plus
  the environment passthrough is the grant key, so swapping the binary, changing its arguments or
  widening a glob all read as newly requested. What this does not bound is the agent itself: an agent
  CLI a person installed and acorn started is code that person is running, which is the same trust class
  as running it in their own terminal (`docs/managed-agents.md § Harnesses`).
- **The Node half is isolated.** Each loaded node bundle runs in its own permission-scoped worker
  realm. Its context is an owner-bound RPC projection, its package is read-only, and only its own
  database paths plus explicitly accepted local-file resources are writable. Its environment is
  scrubbed to a credential-free base plus individually accepted names. Direct `node:sqlite`, raw
  network modules, nested workers, native addons, and undeclared child processes are unavailable.
  `docs/security.md` holds the full model and the remaining OS-isolation ceiling.

The only way a package reaches a Node's install directory is the owner-authenticated install route
(`POST /v1/core/plugins/install`, device principal only, audited). Nothing is distributed to a device
until a Node's owner has installed it, and nothing runs on a device until that device has separately
acknowledged the exact bundle bytes.

**An agent can ask for an install; it cannot perform one.** The `plugin_request` agent tool raises a
request and rings the owner's bell. It holds no credential that can install code — a task-scoped internal
token is refused by every route in the `/v1/core/plugins/*` family, and the module implementing the tool
imports no installer, no data root and no filesystem, which a test pins so a later convenience import
fails the build rather than the boundary. On approval **the device** performs the install with its own
principal. The owner decides in the shell's own chrome, which a plugin frame cannot draw over, and the
answer route is permanently unmappable from a frame for the same reason the install route is: a frame that
could post an approval would answer the question that exists because an agent must not install.

Because the installer only validates a manifest after fetching, the approval is two screens: the agent's
ask (action, source, its stated reason) gates the *fetch*, and a second screen shows the real manifest read
back off disk before anything runs — install never starts a plugin — with a No that uninstalls it again.
`docs/plugins.md § What the owner can know before the download` records why that ordering was chosen over
downloading first.

### Installing from a folder

`{ path }` — an absolute directory on the node's own filesystem — is a first-class install source on
**every** build, packaged included. It was dev-build-only for most of the plugin system's life, gated on
an `allowLocalPath` flag each composition root answered from its own evidence. That gate is gone, and
since removing a gate is the kind of change that should have to argue for itself, here is the argument.

**What it was costing.** The scaffold (`npm create acorn-plugin`) writes a directory, and the authoring
guide's last step installs it. On a packaged build that step failed, which meant an external author could
write a plugin and not run it — the whole remaining distance between "an afternoon" and "an afternoon on a
machine that is not a dev checkout". Every downstream ambition (discovery, a listing, distribution) is
worth nothing while the local case does not close, so this was the first thing to fix and it never
depended on containment landing first.

**Why widening it is sound.** A folder install is the owner naming bytes that are already theirs, by
absolute path, on a filesystem the node process already reads and writes as the user who runs it. Compare
what an attacker gains:

- **For a folder only the node's own user can write** — a home-directory checkout, which is where an
  author's working tree normally lives — whoever can write it can also write the install root beside it
  (`<data>/plugins/<id>/`, created `0700`), the node's own binary, or the user's shell profile. There the
  symlink hands out no authority that account did not already have.
- **That is an assumption, not a guarantee, and it is the one real cost.** The install root is `0700`;
  the folder the owner names is whatever mode it happens to have. A group-writable checkout, a shared or
  network mount, a synced folder, `/tmp` — each is a strictly wider write surface than the install root,
  and pointing acorn at one converts write access to that directory into durable code execution as the
  node's user, re-established at every restart, without ever needing the data root. acorn does not check
  the mode and should not pretend to; a mode check would be a boundary shaped like advice, and the owner
  chose the path. What it does instead is say so — the install form carries its own sentence about a
  folder being linked rather than copied. **Point acorn at a directory only you can write.**
- The **node half** gets the same isolated realm for every source. `{ path }` is not a hole in that
  boundary; it receives the same manifest-shaped RPC context and runtime grants as a `{ url }` install.
- The **client half** is genuinely unaffected. Device consent is keyed on the hash of the bytes that
  arrive, computed by the device, so editing the client file in place produces a new hash and re-prompts.
  The one mechanism that could have been undermined here already handles it.

**What it does not get, and must not claim.** The directory is symlinked rather than copied — that is the
point, it is what makes edit-in-place work — so the bytes are live and there is nothing to pin. The
lockfile records `archiveSha256: null` and an empty `entrypoints` map, and a test asserts it stays that
way: a digest captured at install would go stale on the author's next keystroke and would read as
provenance it is not. So a folder install is outside the supply-chain story in § Supply chain. It is not
hash-pinned, signing will never cover it, and the settings form says so in its own sentence rather than
letting the general install hint imply otherwise. The honest summary is that the owner vouched for a
directory, not for a version.

**What is deliberately still refused.** The path must be absolute — a relative one would resolve against
whatever the node's working directory happens to be. And the picker in Settings is offered only for a
*local* node, because the dialog browses this device's filesystem while the node resolves the path on its
own; for a remote node the owner types a path they know. That is a correctness gate, not a trust one.

### The dev grant

Per-hash consent is right for distribution and wrong for iteration, so a plugin the owner is actively
developing can be put into **development mode**: a grant stored per `(pluginId, nodeId)` on the device,
beside the acknowledgements, that auto-accepts future bundles of that plugin from that node. The node half
of the key is not in the design note and is deliberate — fleet resolution picks a winner across every
paired node, so a grant keyed on the plugin name alone would auto-trust a bundle a *different* node started
serving under it.

The grant writes ordinary accepted acknowledgements, in the helper, beside the hash it computed
itself; nothing in the renderer can turn a bundle into an accepted one with or without a grant. Each such
row is marked `dev` so revocation can find it, and `partial` because nobody read a disclosure — so it can
never become the baseline of a later "what changed" diff.

**The honest cost, stated so it is weighed rather than discovered: while a plugin is in dev mode, the node
half the agent writes is accepted on next load without a per-save human read.** It still runs in the same
permission-scoped worker realm as any other loaded plugin, but the owner has waived the bundle-by-bundle
review for this `(plugin, node)` pair. That is exactly the risk the owner accepted by entering dev mode.

Three things keep it bounded:

- **Visible.** Settings → Plugins badges the row *in development — bundle changes are auto-trusted*. The
  moment dev-mode behaviour is indistinguishable from a normal install, the trust story has rotted.
- **Revocable, and revocation means something.** Ending dev mode drops the grant *and* every
  acknowledgement it wrote. What survives is whatever the owner answered by hand, so with nothing left the
  current bundle is undecided again and the normal per-hash prompt fires on the next distribution pass —
  which is what "promoting out of dev mode re-enters per-hash trust at the current bundle" means. Revoking
  and promoting are one operation.
- **Auditable.** Every approval that entered dev mode is a `plugins.request.decided` row on the Node's
  audit trail, carrying the action, the decision, the dev flag and the task whose agent asked.

Dev mode widens nothing in a packaged build, and no longer needs to: the local-path source it hangs off
is allowed everywhere now (§ Installing from a folder above), so a packaged app gets the same in-place
directory a dev checkout does. The grant itself is a device-side trust decision, independent of source,
so over a remotely-sourced plugin it still means only "future versions of this one do not re-prompt" —
and each iteration there is still an explicit update, because there is no directory to edit.

Frame key capture is also manifest-bounded. A frame already sees key events delivered to its own
document, but it may suppress shell forwarding only for modified chords listed in `claimsKeys`; those
claims are shown in the trust prompt and Settings. Runtime code may narrow the list, never extend it,
and the palette, settings, task-switching, and Escape chords are unclaimable.

A loaded plugin may declare a host-owned webview. Unlike its sandboxed interface frame, the remote
page has live network access and its own cookies/login state for the life of the process. The trust
prompt names the declared hosts as a separate grant. The shell enforces that allowlist across requested
navigations and redirects, and gives each surface an isolated ephemeral partition. The plugin gets no
page preload, CDP driver, devtools, tunnel headers, script injection, or `postMessage` path, so it can
choose the URL but cannot inspect or operate the page.

## Node-half plugin security

<a id="rung-1--permission-shaped-context-phase-1-shipped-with-the-loader"></a>

For the full contract, see [Node plugin security](./security/node-plugin-security.md#node-half-plugin-security).

## The renderer's policy and its dangerous sinks

The privileged webview — the one that holds a capability, so `invoke` works — loads from `app://acorn`
and gets its Content-Security-Policy as a response header from `apps/desktop/src-tauri/src/app_scheme.rs`.
`docs/shell.md § Renderer origin and protocol handler` owns the directive list and the reason for each
exception. A Rust test pins it, the same way `plugin_scheme.rs` pins the frame policy.

`tauri.conf.json` sets `"csp": null`, and that is not a gap: the value there governs Tauri's built-in
asset protocol, which this app does not use. A security review read the config and concluded the
privileged webview had no policy. It has one; the config is simply not where it lives. Worth stating
plainly, because the next reader will look in the same place.

What the policy is a second layer behind. The renderer displays text this app did not author — agent
transcripts, GitHub `bodyHTML`, Linear descriptions, Rollbar payloads, notes an agent wrote — and two
bindings pass GitHub's `bodyHTML` to `innerHTML` verbatim, trusting GitHub's sanitizer:

- `packages/client-core/src/host/components/ProviderHtml.tsx`, the host component every provider-rendered
  body now goes through: github's description, its comments and its review threads
- `packages/client-core/src/kit/diff/DiffRows.tsx`

The first was three hand-written bindings inside the github plugin until phase 7 of the layout
programme. Neither is a known bug. They are listed because each one is a place where a sanitizer being wrong once
would put script in a webview that can call into Rust, and the policy is what stands behind them if
that ever happens.

The Markdown renderer (`packages/client-core/src/kit/lib/markdown.ts`) is the other sink, and it is the app's
own. It escapes first and builds tags afterwards, which holds. What did not hold was its sentinel: it
reserved U+E000 to protect code spans and images across the escaping pass, on the stated grounds that
real text never contains it. The input decides what is in it, so a source that spelled the sentinel
forged an index into the token tables and crashed the render. `renderMarkdown` strips U+E000 on the way
in now, at the one entry point, which kills the class rather than the two probes that found it: after
the strip there is no way to write a sentinel the renderer did not write itself.

## Host-owned webviews and browser automation

The desktop view service owns every `WebContentsView`, with an ephemeral session, no preload,
navigation checks, denied permission requests, and browser chrome outside the guest page. Loaded
plugin surfaces add a manifest host allowlist enforced on redirects. The remote preview tunnel accepts
only declared task ports and authenticates its local loopback request with a per-tunnel secret before
forwarding it to the Node.

Agent browser tools drive a separate browser of the node's own, through `plugins/browser`, rather than
the person's preview pane. That separation is deliberate: the pane a person is looking at is not a
surface an agent steers. Each task gets its own browsing context, so cookies, storage, and any login
one task's work established never reach another's. Fills go through the resolved accessibility node
rather than a selector, so a page cannot substitute a different element between the snapshot an agent
read and the value it writes. The tools expose no arbitrary JavaScript evaluation.

Screenshots are rows in the plugin's own database, keyed to the task, served back only through
`/v1/p/browser/captures/:id` behind the same auth as every other node route. The newest twenty per
task are kept.

## Untrusted provider data

Rollbar occurrences and other provider payloads are parsed into bounded, allowlisted projections
before persistence or rendering. Raw payloads, request headers, cookies, bodies, IPs, and arbitrary
provider objects are discarded. Normalization failure rejects the item rather than widening the
surface automatically.

The allowlist runs even when the source SDK already scrubbed common secret keys before sending the
payload: that scrubbing is the sender's choice and acorn's storage and rendering path cannot rely on
a filter it does not control.

AI authoring treats source metadata and opted-in preview records as untrusted prompt content. A model
can request only the closed metadata operations parsed by `@acorn/protocol/authoring.ts`. The Node
checks the selected workspace and project on each request, uses the source runtime for provider
authorization, and limits one turn to eight metadata requests and two candidate attempts. Record
samples require device opt-in and are limited to three records and 16 KiB. The authoring routes accept
only device principals and expose no publish, run, schedule, provider-write, or credential operation.
Task-scoped agents receive the separate read-only metadata tools through the normal tool-permission
and MCP projection.

Workflow schedule authoring and approval routes require a device principal. At approval and before
each root task creation, the workflows plugin resolves the published graph and rechecks repository
trust, source availability, connection ownership, and destination scope through core and source
capabilities. A client cannot provide an internal principal, an intended task ID, or a frozen graph.
The schedule target contains only the workflow-owned binding ID. Loaded plugins cannot register user
schedule target kinds or call the intended root-task creation seam.

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
plugin toggles, plugin install/update/uninstall/reload, the owner's answer to an agent-raised plugin
request, backup, and attaching to or detaching from a control plane. The Settings → Security surface
reads it. The trail is not tamper-evident against someone who already controls the database file.

### The vocabulary is closed, and a plugin can add to it

Core's seventeen verbs are a closed union in `server/audit.ts`. That set exists because the settings
surface groups and filters on it and an action nobody can enumerate is one nobody reviews — the same
argument as the error-code set in [api-reference.md](./api-reference.md) § Errors.

Until 2026-08-28 that also meant nothing a plugin did reached the trail. For a product where the
expensive, unattended work is a plugin's — a workflow run spending money, a schedule sending an
outbound request with the owner's credentials — the events most worth reviewing were the ones the
surface built for review could not see.

A plugin now declares its verbs, in its manifest's `contributions.auditActions` or through
`ctx.audit.declare`, and writes rows with `ctx.audit.record`. Four rules keep the closed-set argument
intact:

- **The host qualifies every verb as `<pluginId>:<actionId>`.** No core action contains a colon, so a
  package can never take a core verb's place or file under another plugin's name. The id is minted
  from the plugin, never read off the descriptor.
- **An undeclared action writes nothing.** `recordAudit` refuses it and warns. Fail closed, because
  a trail that accepts arbitrary strings is one nobody can enumerate.
- **The vocabulary is still enumerable.** `auditVocabulary()` lists every declared verb with the label
  its plugin chose, and it rides out on each audit page so Settings → Security can name a row it has
  never seen. A row whose plugin has since been removed draws as its raw qualified verb, which is the
  honest answer: the row is still evidence of something that happened.
- **The actor is `system`, with the plugin id as `actorId`.** Nothing asked for a plugin's row over a
  request, so it is the node acting, and the qualified verb already says which package.

`details` stays what it was for core: allowlisted scalars decided at the call site, never a request
body, a credential, or a file's contents. `plugins/http` is the worked example — it declares
`request.sent` and records it only from its workflow step, with the target's origin and not the URL,
because a query string is where a token ends up when someone puts one there.

#### The same rule for what a plugin can reach into

Cross-plugin extension has the same closed-vocabulary shape, and for the same reason: a grant nobody
can enumerate is a grant nobody reviews. `extensionPoints[].kind` is a closed union of five
([plugins.md](./plugins.md) § Cooperative extension points), and both directions of every one of them
appear in the trust prompt under **Enforced** with copy the host owns. A kind this build cannot name is
still disclosed — "reach into X's Y" — because the disclosure is that this package reaches into that
one, and a shell that cannot describe the kind must not therefore say nothing.

Three things are minted by the host and cannot be stated by a manifest: the point's public name, the
provenance stamped on everything delivered, and the confinement of every route a contribution reads or
answers on. A contribution that runs the contributor's own code — a `remote` tree in a worker, an
`inline` rectangle in an iframe — additionally needs this device to have accepted that bundle, exactly
as a pane does. Standing inside another plugin's pane grants a frame none of that plugin's reach: its
bridge is bound from its own manifest.

Hooks are the one kind that changes what another plugin *does* rather than what it shows, so their
grants read differently and two of the three modes are marked **high**: "can change a prompt before the
agents plugin sends it" and "can stop a push in the changes plugin" are recorded against the trust
decision with the mode in the key, so a package that starts vetoing where it used to observe reads as
newly requested. The chain itself fails open — a handler that throws or stalls is skipped — because a
plugin that stops answering must not be able to brick a push. The exception is `core:before-tool-call`,
which is an approval gate and denies on timeout: a gate that opens when its keeper goes quiet is not
one.

Secret *use* is not recorded, only creation, replacement and deletion. Every credential read goes
through `SecretService.use` (`server/core/secrets.ts`), which holds only an encryption key and nothing
else, no database, no request, no connection id, so a row written from there could only name the
credential by a hash of its ciphertext. Recording every read would also turn the table into a request
log, since a mirror refresh reads a provider token on a timer, and would bury the handful of decisions
an owner actually reviews. Auditing only the single GitHub read site was considered and rejected too:
partial coverage that reads as complete would let an owner conclude nothing else spends a credential,
which is worse than recording nothing.
