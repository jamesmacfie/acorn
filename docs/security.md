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

The application does not defend against root/other-user access to the host, a compromised Node
account, or malicious first-party plugin code. Those are OS/deployment concerns.

## Transport and auth

- Nodes bind to `127.0.0.1` over TLS 1.3 and reject unexpected `Host` values.
- The certificate is self-signed, persisted in the Node data root, and pinned by fingerprint in the
  helper's broker. A changed fingerprint is a hard stop.
- Every protected HTTP route passes request-id, principal resolution, the auth gate, and then the
  idempotency middleware before reaching a router.
- `/v2/node` and `/v2/pair` are the only pre-auth routes. Device management, plugin toggles, audit,
  security, backup, schedules, preferences, projects, and workspaces are device-only.
- `/v2/events` authenticates the upgrade and rechecks device activity for long-lived streams.
- Revoking a device (`DELETE /v2/core/devices/:id`) closes that device's live sockets immediately and
  fails its in-flight requests. A device can revoke its own row; that is the same effect as unpairing
  itself.
- There is no cookie or ambient browser credential, so CSRF middleware is not part of the protocol.

`requireUser` is the single gate mounted over `/v2/*`. It accepts either credential kind, device or
internal, because product routes such as the MCP server and agent sessions legitimately read and
write task data as the owner. `requireDevice` is narrower and sits in front of surfaces an
agent-spawned child must never reach: pairing, device management, plugin administration, audit,
security, backup, and schedules. Before `requireDevice` existed, the internal token injected into
every PTY and agent session environment was a complete privilege escalation: a prompt-injected agent
could call `POST /v2/core/pair/start`, read the pairing code back out of the response body, pair
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
read its own project's configuration, that is a task-addressed route under `/v2/core/tasks/:id/...`,
not a widening of this gate.

`server/mountCoverage.test.ts` is what keeps the list from drifting again. It builds the app, reads
every route under `/v2/core` off it the way a request does, and fails unless each one is covered by a
gate mount or named in an allowlist with the reason it is open to a task token. Three route reviews in
a row found the same shape of hole — a route that should have been device-only was mounted at
`requireUser` because nobody wrote the line, and nothing failed when they didn't. Adding a route under
an already-gated prefix is still free; adding one anywhere else is now a decision someone writes down.
The test reads a trailing `/*` strictly, as not covering the bare path, which is why every gate below
is written in both forms: the Hono this repo pins does match the bare path, that behaviour has moved
between versions, and a gate that is correct only on today's version rots quietly.

Two core lists are filtered rather than gated, the same answer terminal's session roster gives:
`GET /v2/core/tasks` and `GET /v2/core/task-statuses`. A task-scoped caller has a legitimate reason to
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
answer, in `plugins/notes` and in the compatibility alias `plugins/memory` keeps for the old paths.

Both gates, and the task-scope and provider-access gates below them, are applied to a router's mount
path in `server/index.ts` rather than inside each handler. A route added later under an already-gated
prefix inherits the gate automatically instead of depending on someone remembering to add a check to
it. An adversarial review found the per-route form of this check applied at exactly one call site out
of six for task scope, leaving `/v2/core/tasks/<other>/preview-url` reachable by another task's
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

The WebSocket hub (`main/wsHub.ts`) had the same class of gap. `authorize()` verified a task-scoped
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

Child environments are built by the process broker. They do not inherit `SESSION_ENC_KEY`, GitHub
credentials, arbitrary `ACORN_*` values, or the parent process environment. They receive a task-scoped
internal token, the current data-root path, and the TLS trust material needed to call the Node.

Internal tokens are stateless HMAC credentials. A signing key persists across restarts so a
tmux-reattached agent session can keep authenticating after the Node restarts; rotating the key
revokes every outstanding token. Tokens carry no expiry of their own, so scope and key rotation are
the only lifetime controls. Two scopes exist: `service`, for the node's own loopback calls (a
firing schedule, the measure sampler, notes seeding), minted in-process and never placed in a
child's environment; and `task`, for everything handed to a child process, PTYs, agent sessions,
workflow steps, the MCP server. A `task`-scoped token carries the task id it was minted for, and
route handlers compare that id against the task named in the URL before acting.

Minting a token is not exposed on `CoreServices`: any plugin could then request a token for any
scope, which defeats the point of scoping them at all. Instead the composition root builds a scoped
credential factory and hands it to the plugins that spawn children, terminal and agents, as a
constructor dependency. The factory closes over the signing key and the listener's own address,
neither of which exists until every plugin's `init` has run, so only the composition root can build
it, and only after the fact. A plugin calls it once per child with the scope that child needs, for
example `{ scope: 'task', taskId, sessionId }` for one managed-agent session.

The node-owner identity is opaque, explicit, and persisted at first boot. It is independent of
provider connections, and internal auth fails closed if it is unset. A task-scoped token cannot use
another task's task-addressed routes, terminal streams, preview tunnel, or worktree operations.
Provider-credential restrictions are route-specific; the current GitHub routes can be reached by an
authenticated internal principal and therefore can spend the active owner's GitHub credential.
Routes that administer or spend a provider connection use a middleware gate one step wider than
`requireDevice`: device principals plus the node's own `service`-scope internal calls, which need
provider reads to warm a mirror. A `task`-scoped token still cannot reach these routes.

Core's own code reads a stored secret through `SecretService.use()`
(`packages/node-core/src/main/core/security/secrets.ts`), not through a raw decrypt call. Before this
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
  (`packages/node-core/src/main/core/filesystem/confinement.ts`). Four call sites used to each check
  this on their own: `taskWorktree.ts`'s lexical-plus-symlink check, `pathGuards.ts`'s lexical-only
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
- Docker matching configuration is declarative; Docker and run-target execution remains subject to
  the appropriate trust gate.
- External URLs opened through the OS pass a scheme allowlist. Preview navigation is limited to
  HTTP(S) URLs without userinfo.

The untrusted input the trust gate hashes is the repo config **and the project row**
(`main/repoConfigTrust.ts`). The gate started on the premise that the checkout is untrusted and the
database is trusted, and that premise only holds while nothing but the owner can write the database.
`PUT /v2/core/projects/:id/config` is device-only now, so it holds again; the row is in the snapshot as
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
`plugins/docker/src/main/dockerConfig.ts` now names the two invariants that make that safe, which are
that exec is ref-addressed rather than matcher-addressed and that the WebSocket hub refuses docker
channels to a task-confined socket. If either changes, that table needs the gate.

**A known limit.** `resolveInRoot` is check-then-use: nothing re-validates between the containment
check and the open, so an agent that can write in its own worktree can swap a path component for a
symlink in the window between them. Real, hard to hit, and the honest fix is an `O_NOFOLLOW`-style
open rather than a tighter check, so it is recorded here rather than papered over. The per-task sandbox
(`docs/future/sandbox/sandbox.md`) is the layer that eventually subsumes it.

Before the broker (`packages/node-core/src/main/core/exec/proc.ts`) existed, about sixteen call sites
spawned or exec'd children with their own ad hoc handling, and the inconsistency was not cosmetic.
`plugins/terminal`'s preview capture ran a repo-configured script through `/bin/sh -c` with no `env`
option, so it inherited the node's full environment, `SESSION_ENC_KEY` and `INTERNAL_TOKEN` included,
and had no output cap. The agents plugin's Claude driver spread `process.env` into its child the same
way. The Docker plugin denylisted six named secrets, and the "keep in sync" comment above the list
pointed at a file that no longer existed; a denylist silently misses any binding nobody remembered to
add. Only one site, `main/headless.ts`, killed the child's process group, so everywhere else a hung
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

**Trust binds to bytes, not to claims.** The hash a Node advertises in `/v2/core/plugins` is
untrusted input. The helper fetches the bundle itself (the bytes never pass through the renderer),
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

**What "gained" means.** Each rendered permission line carries a stable grant key, separate from its
sentence (`packages/client-core/src/plugins/permissions.ts`). The update diff compares keys, not
copy, so tightening a sentence's wording never re-prompts an existing owner as though the plugin had
grown its reach. Only a key that did not exist before does that. A grant's severity (`icon`, `high`)
rides beside the key as data, not something parsed back out of the copy.

The threats this closes, and the ones it does not:

- **A compromised or hostile paired Node serving malicious JavaScript** — hash-verified bytes, a
  per-device acknowledgement that names the Node, and (phase 3) the sandbox the bundle runs in.
  Nothing a Node pushes runs unprompted. The sandbox is one of two, and the trust decision covers both
  because both are the same bytes: the iframe at `app-plugin://<hash>` for a bundle that draws its own
  pixels, and a Web Worker for one that draws a tree (`docs/shell.md § The plugin worker`). Neither
  path asks a second question, and neither can start without an accepted hash.
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
- **Not closed: the Node half.** A loaded plugin's node code runs in the Node's process, disclosed and
  acknowledged — the same trust class as an editor extension. Its declared `node` permissions shape
  the context it is handed; they are not enforced against a bundle that imports `node:fs` directly.
  Every surface that renders them says *declared*. `docs/security.md` holds the full
  model and the route to a hard boundary.

The only way a package reaches a Node's install directory is the owner-authenticated install route
(`POST /v2/core/plugins/install`, device principal only, audited). Nothing is distributed to a device
until a Node's owner has installed it, and nothing runs on a device until that device has separately
acknowledged the exact bundle bytes.

**An agent can ask for an install; it cannot perform one.** The `plugin_request` agent tool raises a
request and rings the owner's bell. It holds no credential that can install code — a task-scoped internal
token is refused by every route in the `/v2/core/plugins/*` family, and the module implementing the tool
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
- The **node half** is uncontained for every source, not just this one — that is the disclosure recorded
  above and in § Node-half plugin security, and rung 2 fixes it for all of them at once. `{ path }` is not
  a hole in a boundary; it arrives at the same place a `{ url }` install does.
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
half the agent writes runs with the Node's own access on next load, without a per-save human read.** That
is exactly the risk the owner accepted by entering dev mode, and it is bounded to plugins they chose — but
it is the same in-process access described under "Node-half plugin security" below, arriving without a
prompt. If rung 2 (out-of-process node halves) ships first, dev mode inherits its containment, which is a
good reason to watch that ordering.

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

The section above is about bundles a Node distributes to a device. This one is about the code a
loaded plugin runs *inside the Node*, which is a different trust class and the weaker of the two.

Stated once and bluntly: **a loaded plugin's node bundle runs in-process in the Node and can do
anything the Node process can do.** Everything that shapes or displays its `permissions.node` block
is least privilege for cooperative code and honest disclosure for users — not a security boundary.
Every surface that renders those permissions must label them *declared*, never *enforced*, and must
keep them in a group of their own — a strong claim must not lend credibility to a weaker one sitting
beside it. In the trust prompt the label is the group's name and the legend defines it, carrying two
statements: that the list is unverified ("the plugin's own description of what it touches; acorn
can't check it") and the canonical wording for what that means — "This plugin's server code runs
with the same access as acorn itself." The second must not be softened or dropped; it is drawn at
full contrast rather than as fine print, and `e2e/twoNode.spec.ts` asserts it so its removal cannot
pass as a copy tidy-up.

### The broadcast namespace

One thing in that block *is* enforced, and it is worth separating from everything around it. A loaded
plugin's `ctx.events.send` used to accept any channel name, which meant it could put frames on `term:`
or `workflow:` and impersonate core's own streams — a renderer cannot tell a forged `term:out` from a
real one, because the WS envelope is deliberately open and core routes on the channel alone.

It is now confined to `plugin:<its-id>:*`, and naming anything else throws. This is a real check rather
than a disclosure, and it is cheap precisely because it does not pretend to be more: the same bundle can
still `import('node:net')` and open its own socket. What the confinement buys is that a plugin cannot
lie to the renderer *through core's own transport*, which is a different thing from being contained.

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

Each rung is real, additive, and independently shippable. Rung 0 is the client sandbox, already
shipped; the phases implement rung 1; rungs 2–3 are the "Future work" node-sandbox entry, specified
here so nothing in the shipped phases forecloses them.

#### Rung 0 — The client sandbox (shipped)

Before the node-side ladder starts, the client half of a loaded plugin is already contained, and there
are two containers rather than one. A bundle that draws pixels runs in an iframe on its own
hash-addressed origin under `plugin_scheme.rs`'s policy. A bundle that draws a tree runs in a Web
Worker with no DOM at all, under `PLUGIN_WORKER_CSP` (`docs/shell.md § The plugin worker`). Both have
`connect-src 'none'`, so the transferred `MessagePort` is the only way out, and both reach the host
through the same broker, which decides every call from the manifest's scopes.

The tree path is the stricter of the two, and worth stating as a security property rather than a UI
one: the sandbox never produces markup. It produces names of the host's own components and props that
are checked against the kit's role enums, so `class`, `style`, `innerHTML`, a raw URL and a function
have nowhere to be. A prop that fails validation is dropped and the node still renders; a batch that
fails is dropped whole and recorded; a node name this build does not know draws a labelled
placeholder. What a worker that misbehaves can do to the surface around it is nothing — it is
terminated and its trees show placeholders.

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
- **The `execute` tier denies by default.** A tier the owner has never expressed an opinion about
  falls back to `TOOL_TIER_DEFAULTS` (`@acorn/protocol/toolPermissions.ts`), where `execute` is
  `false`. The fallback used to be `true` for every tier, which meant shipping a new execute tool
  granted it to every existing installation on upgrade, silently: the owner had approved a list that
  no longer described what the agent could do. `read` and `write` stay allowed and are written out
  rather than left implicit, so the next tier added has to say which it is. The node and the settings
  page read the same constant, so an untouched tier draws as off in Settings → Agent tools and is
  denied on the wire.
- **Broadcast hygiene.** `ctx.events.status()` is content-free by design; keep every
  third-party-reachable broadcast content-free or plugin-self-scoped so one plugin's events can
  never carry another's data to a subscribed frame (phase-3 bridge filters by declared channel;
  this rule is what makes that filter sufficient).

### Storage

- **Migrations** run in the Node at boot against the plugin's own file only
  (`packages/node-core/src/main/pluginMigrations.ts`). SQL is data, not code, but verify the
  plugin database factory (`main/pluginStorage.ts`) keeps `load_extension` unavailable
  (the default `main/sqlite.ts` pins) and never grants `ATTACH` reach into other files — an attached
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
  install with nothing written (`main/pluginInstaller.ts`). It used to be recorded into provenance and
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
| Install on an agent's say-so | Prompt-injected agent asking for a hostile package | Request/decision split: the tool cannot install, the device does, the owner decides in shell chrome | Shipped |
| A plugin in dev mode | Its node half runs unread on every reload | Bounded to one (plugin, node) the owner chose; badged, revocable, audited. Not closed until rung 2 | Shipped (disclosure) |

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
transcripts, GitHub `bodyHTML`, Linear descriptions, Rollbar payloads, notes an agent wrote — and four
bindings pass GitHub's `bodyHTML` to `innerHTML` verbatim, trusting GitHub's sanitizer:

- `plugins/github/src/client/PullDetail.tsx`
- `plugins/github/src/client/pullDetail/Conversation.tsx`, twice
- `packages/client-core/src/ui/diff/DiffRows.tsx`

None is a known bug. They are listed because each one is a place where a sanitizer being wrong once
would put script in a webview that can call into Rust, and the policy is what stands behind them if
that ever happens.

The Markdown renderer (`packages/client-core/src/ui/markdown.ts`) is the other sink, and it is the app's
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
`/v2/p/browser/captures/:id` behind the same auth as every other node route. The newest twenty per
task are kept.

## Untrusted provider data

Rollbar occurrences and other provider payloads are parsed into bounded, allowlisted projections
before persistence or rendering. Raw payloads, request headers, cookies, bodies, IPs, and arbitrary
provider objects are discarded. Normalization failure rejects the item rather than widening the
surface automatically.

The allowlist runs even when the source SDK already scrubbed common secret keys before sending the
payload: that scrubbing is the sender's choice and acorn's storage and rendering path cannot rely on
a filter it does not control.

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
through `SecretService.use` (`main/core/secrets.ts`), which holds only an encryption key and nothing
else, no database, no request, no connection id, so a row written from there could only name the
credential by a hash of its ciphertext. Recording every read would also turn the table into a request
log, since a mirror refresh reads a provider token on a timer, and would bury the handful of decisions
an owner actually reviews. Auditing only the single GitHub read site was considered and rejected too:
partial coverage that reads as complete would let an owner conclude nothing else spends a credential,
which is worse than recording nothing.
