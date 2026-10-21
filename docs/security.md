# Security model

This page is the map of acorn's security model: the trust boundaries, what's out of scope, and which
page owns each control. Read it before you change anything that crosses a boundary.
For the device-only **Check this node** report, see [security diagnostics](./security/security-diagnostics.md). For advisory npm and pnpm change review, see [the Changes tab](./diff-rendering/changes-pane.md#the-file-list).
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
- **A paired browser** reaches its Node through the native host, under a device credential of its
  own, and only through the bridge's typed operations, never a general route proxy
  ([browser extension](./browser-extension.md#what-runs-where)). It can run any panel an agent showed
  with `panel_show` in a session that device can read, because the host reads the plan from the call
  and the browser only names it ([panel cards](./browser-extension/native-messaging.md#panel-cards)).
  The desktop's card does the same under its own device, so this changes where the device can run a
  panel from, not what it can run. It can also read an agent-built app and its saved state, run the
  app's plans, save its state, and restore one of its revisions, for an app in a task that device can
  read, as the desktop's app card can ([app cards](./browser-extension/native-messaging.md#app-cards)).
  The host checks that the app belongs to the conversation's task, because the Node doesn't confine a
  device to a task. It can run a data source's action on a row of either card, the bridge's only
  write to a source's records ([row actions](./browser-extension/native-messaging.md#row-actions)).
  The sidebar confirms with the action and the row first. The host runs the card's plan again and
  takes the row and action from that run, never from the browser, so the browser can't name a record
  or an action the source didn't offer, and an older app revision acts on nothing. The Node checks
  the confirmed risk against the action's own.
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
[review-2026-10-11.md](./security/review-2026-10-11.md). The review of agent-built apps on October 19, 2026 is
[review-2026-10-19.md](./security/review-2026-10-19.md). The review of the work since October 11, with the
fixes for it, is [review-2026-10-21.md](./security/review-2026-10-21.md).

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
  `internal-credentials/`, `core.sqlite` with task and transcript data, and the TLS private key.
  **Keep agents out of Acorn's data folder** closes this for Claude Code sessions, using its sandbox,
  and also limits where they can write. It's off by default, and Codex and contributed harnesses
  can't enforce it ([keeping agents out of the data folder](./managed-agents/read-block.md)).
- The sealed keys, wherever the desktop's data key is a plain `data.key` file. That's every
  development build, and a packaged build whose keychain refused the item.
- Every key on a standalone Node, which has no keychain and warns about this at boot.

What it doesn't stop, outside a blocked Claude Code session, is an agent that plants a file and waits
for a restart. It can delete
`node-keys.sealed` and leave its own `session.key`, which the next start treats as an upgrade, or
write a `.env` into the data root, which the helper loads. That's persistence as the person's own
user, which no desktop app can rule out. The audit trail records a key check that fails, and
**Check this node** shows a plain key file in the data root.

**Check this node** shows which case applies to the Node it checks
([security diagnostics](./security/security-diagnostics.md)).

## Agent-built apps

An agent-built app is a program and its plans, not a bundle, so no device asks to trust one
([agent-built apps](./agent-built-apps.md)). Acorn's interpreter, library, and dashboard views draw it,
and the device already trusts those as part of the client. A program reaches its own plans, run under
the viewer's device, the task it's drawn in, row actions, the composer, and web links. The card
confirms each row action and link with the person, and compose only fills the draft.

`app_show` validates a program before it publishes it. That check keeps broken cards out of the
conversation and isn't the security boundary. An agent can write into the data root, so it can plant
a revision that skipped the checks. The boundary is the card: it hands a program only the tools above,
looks up a row action in its own last run rather than trusting the program, and copies every value a
program hands it into plain data before it uses it. A planted revision reaches nothing more than one
that passed. Those checks live in the trellis plugin's `AppRuntime`, which the desktop, the terminal,
and the browser extension all run, and not in a client's `AppHost`, so no client calls a value a
program handed it.

## Instruction file checks and review

[Instruction checks and review](./security/instruction-review.md) covers hidden characters, changed
instructions, first-time approval, and recovery when a managed turn is blocked.

## Pages

[Transport and auth](./security/transport-and-auth.md) covers TLS and pins, broker limits, the
`requireUser`, `requireDevice`, and provider-access gates, the mount coverage test, task scope, and
the WebSocket hub.

[Credential handling](./security/credentials.md) covers encrypted provider credentials,
`SecretService.use`, child environments, harness generation, and internal token scopes.

[Process, path, and configuration controls](./security/process-and-paths.md) covers `resolveInRoot`,
the process broker, config trust, workflow authority, Docker, and force push.

[The control plane](./security/control-plane.md) covers what enrollment and node providers cost, and
what bounds it.

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

[The renderer and untrusted content](./security/renderer.md) covers the CSP, the provider HTML and
markdown sinks, provider payload projections, and AI authoring input.

[Host-owned webviews and browser automation](./security/webviews.md) covers child webviews, the
preview pane's remote refusal, and agent browser tools.

[Audit](./security/audit.md) covers the audit trail, plugin audit verbs, why secret use isn't
recorded, and on-disk permissions and backups.
