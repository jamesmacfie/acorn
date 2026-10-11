# Security model

This page is the map of acorn's security model: the trust boundaries, what's out of scope, and which
page owns each control. Read it before you change anything that crosses a boundary.
For the device-only **Check this node** report, see [security diagnostics](./security/security-diagnostics.md). For advisory npm and pnpm change review, see [the Changes pane](./diff-rendering/changes-pane.md#the-file-list).
Managed MCP needs device consent for execution and separate actual-connection catalogue approval; installed code retains device authority. See [managed MCP servers](./mcp/managed-servers.md).
Acorn checks for likely secrets before its own commit, push, transcript export, and attachment send, and an optional per-Node setting blocks them. See [secret checks before publication](./security/secret-publication.md).
acorn is single-owner software. A paired device has full owner authority for its Node. So the controls
protect the transport, credential custody, process boundaries, repository data, and untrusted provider
and preview content, rather than implementing multi-user roles.

Dashboard named actions send an action ID and full source reference. The Node checks scope, account
authority, current eligibility, and confined route ownership before dispatch. The host confirms write
and execute risk before sending anything, and a device-scoped idempotency key replays a completed
press. [Plugin routes](./security/plugin-secrets-and-routes.md) owns the dispatch boundary.
Board moves use the same `act` gate with a source field, expected value, and target. The Node
rechecks the registered source, account, field declaration, live value, target set, and plugin-owned
route. A device principal and host confirmation are required before dispatch. One move intent keeps its device-scoped
idempotency key across retries; a changed intent gets a new key. Plugin frames do not receive this
capability.

Datasets store copies of provider and workflow data at rest in core SQLite. Definition, version,
correction, and deletion routes require a device principal and are absent from plugin frame
bridges. Capture schedules also require device consent. Dataset sources enforce workspace and
optional project scope; task-scoped workflow and agent writes derive that scope from the task.
Deleting a workspace removes its datasets. Row and byte caps plus retention bound local storage.

## Trust boundaries

- **The renderer** runs UI code and third-party preview content. It holds no device token,
  certificate, database handle, process object, or direct network access.
- **The desktop shell and its helper** hold the native host, the broker, certificate pins, device
  tokens, window policy, and the preview webview host.
- **The Node** owns the authoritative data and the execution environment. It runs developer tools on
  purpose. A compromised Node can compromise its own host, but its replies and plugin offers stay
  untrusted input to a connecting client.
- **A Node child** is a task-scoped internal caller. It gets an allowlisted environment and a scoped
  token, and the Node checks its routes and task identity.
- **A loaded reviewer** on `agents:turn-follow-up` sees a workflow step's or a delegated turn's
  address, never its transcript, and reads the turn through `agents.reviewInput.v1` like any reader.
  Its notes join only the operation of a turn in the same session, inherit that turn's model and the
  session's tool ceiling, and are refused once the window or the operation closes
  ([unattended follow-ups](./managed-agents/unattended-follow-ups.md)).
- **A loaded plugin with `agents.sessionControl`** can stop a session's turn and change its model or
  effort, a high grant because it changes what a session spends. It can pick only values the harness
  advertised, never in an archived or terminal-held session, and the transcript names it beside each
  change from an id the host binds ([session control](./managed-agents/session-control.md)). Its
  activity feed carries no tool output, message text, reasoning, or command line, and a note it draws
  on a request card can't answer the request.
- **A loaded plugin on `agents:before-tool` or `agents:after-tool`** sees every tool call a bridged
  harness makes, with its command line and paths, and can refuse one, hold it for the person, or add
  a note the model reads. It can't approve a call: every bridge reply is a deny, a note, or no
  decision, and a broken bridge leaves the harness's own checks in charge. The bridge program posts
  with the session's own task token, and the route answers only for the session that token names.
  Acorn adds the bridge to the flag settings of the session it starts and writes nothing to the
  person's harness settings files ([harness bridges](./managed-agents/loop-hooks.md)).
- **The terminal client** collapses the shell and helper into one process. UI code and the broker share
  a realm, so what the desktop holds as a process boundary this holds as a module boundary. The device
  token lives in the broker's module, the plugin cache and acknowledgements in one custody module, and
  an architecture rule refuses an import of either from any `apps/tui` module that draws a cell. A
  loaded plugin still gets a worker thread of its own under `--permission`.

acorn doesn't defend a Node host against root, other users, or a compromised Node account, and doesn't
sandbox first-party compiled plugin code. A client still treats a paired Node as an untrusted source of
replies, events, content, and plugin offers until an owner authorizes code.

The shell's application ACL grants its own Tauri commands only to the `main` webview, and dispatch
checks that webview's top-level renderer URL. [Host-owned webviews](./security/webviews.md) describes
the plugin iframe's separate cross-origin boundary and the ACL's subframe limit.

The shell's Rust dependency patch and remaining upstream advisories are in
[Rust dependency security](./shell/packaging.md#rust-dependency-security). The dated review of October 1, 2026
is [review-2026-10-01.md](./security/review-2026-10-01.md), and its follow-up on October 11, 2026 is
[review-2026-10-11.md](./security/review-2026-10-11.md).

## What task scope does and doesn't protect against

A task token reaches only its own task's routes and can't spend a provider credential. That holds at
the Node's HTTP surface. It doesn't stop an agent from reading files: an agent runs shell commands as
the same OS user as the Node, and file modes don't stop the owner's own processes.

What a Node the desktop app starts keeps from its agents:

- The signing key and the session key. Neither is in plain form on disk or in the Node's start
  environment. The helper seals both under its keychain data key and sends them in the start message
  ([Node keys](./security/credentials.md#node-keys)).
- Tokens signed before that change. The first start after the upgrade rotates the signing key, so a
  key an agent read earlier stops working. Live sessions get new token files from the Node, not by
  re-signing old ones.

What stays readable to an agent:

- Its own token. An agent can always read the token it was given, which reaches only its task.
- Everything else in the data root, including other sessions' token files under
  `internal-credentials/`, `core.sqlite` with task and transcript data, and the TLS private key. Acorn
  starts no harness with a read block on the data root. Claude Code blocks a shell command's reads
  only inside its sandbox, which also sends network traffic through an allowlist that starts empty
  and limits writes to the working directory and a temporary directory.
- The sealed keys, wherever the desktop's data key is a plain `data.key` file. That's every
  development build, and a packaged build whose keychain refused the item.
- Every key on a standalone Node, which has no keychain and warns about this at boot.

What it doesn't stop is an agent that plants a file and waits for a restart. It can delete
`node-keys.sealed` and leave its own `session.key`, which the next start treats as an upgrade, or
write a `.env` into the data root, which the helper loads. That's persistence as the person's own
user, which no desktop app can rule out. The audit trail records a key check that fails, and
**Check this node** shows a plain key file in the data root.

**Check this node** shows which case applies to the Node it checks
([security diagnostics](./security/security-diagnostics.md)).

## Instruction file checks and review

[Instruction checks and review](./security/instruction-review.md) covers hidden characters, changed
instructions, first-time approval, and recovery when a managed turn is blocked.

## Pages

<a id="transport-and-auth"></a>

[Transport and auth](./security/transport-and-auth.md) covers TLS and pins, broker limits, the
`requireUser`, `requireDevice`, and provider-access gates, the mount coverage test, task scope, and
the WebSocket hub.

<a id="credential-handling"></a>

[Credential handling](./security/credentials.md) covers encrypted provider credentials,
`SecretService.use`, child environments, harness generation, and internal token scopes.

<a id="process-path-and-configuration-controls"></a>

[Process, path, and configuration controls](./security/process-and-paths.md) covers `resolveInRoot`,
the process broker, config trust, workflow authority, Docker, and force push.

<a id="the-control-plane-and-the-inversion-it-costs"></a>

[The control plane](./security/control-plane.md) covers what enrollment and node providers cost, and
what bounds it.

<a id="third-party-plugin-bundles"></a>
<a id="installing-from-a-folder"></a>
<a id="the-dev-grant"></a>
<a id="node-half-plugin-security"></a>
<a id="rung-1--permission-shaped-context-phase-1-shipped-with-the-loader"></a>
<a id="the-same-rule-for-what-a-plugin-can-reach-into"></a>

[Plugin security](./security/node-plugin-security.md) owns the plugin threat model, the containment ladder, and the
summary table. Its topic pages cover [client bundle trust](./security/plugin-bundles.md),
[installing plugins](./security/plugin-install.md), [the client sandbox](./security/plugin-client-sandbox.md),
[the node realm](./security/plugin-node-realm.md),
[secrets, routes, and agent tools](./security/plugin-secrets-and-routes.md), and
[storage and supply chain](./security/plugin-storage-and-supply-chain.md). A plugin that sends notes to
agent sessions spends turns on the person's provider, so it holds a disclosed, high grant of its own,
separate from any veto it holds ([client bundle trust](./security/plugin-bundles.md)).

A plugin's skills are text an agent follows, so they're a prompt-injection path by design. The device
trust hash doesn't cover them, because it covers only a client bundle. The Node approves each skill at
the digest of its whole folder, a changed byte asks again, and the folder may hold no symlinks. A harness
gets read access to each delivered skill folder and nothing else: no data root, no write access, and
nothing in the worktree ([skills](./managed-agents/skills.md#approval)). Claude Code and Codex load a
per-process copy of the approved bytes natively. Codex's skill roots stay in its memory, and its home and
login are never moved ([native delivery](./managed-agents/native-skills.md)).

<a id="the-renderers-policy-and-its-dangerous-sinks"></a>
<a id="untrusted-provider-data"></a>

[The renderer and untrusted content](./security/renderer.md) covers the CSP, the provider HTML and
markdown sinks, provider payload projections, and AI authoring input.

<a id="host-owned-webviews-and-browser-automation"></a>

[Host-owned webviews and browser automation](./security/webviews.md) covers child webviews, the
preview pane's remote refusal, and agent browser tools.

<a id="filesystem-and-backup"></a>
<a id="audit"></a>
<a id="the-vocabulary-is-closed-and-a-plugin-can-add-to-it"></a>

[Audit](./security/audit.md) covers the audit trail, plugin audit verbs, why secret use isn't
recorded, and on-disk permissions and backups.
