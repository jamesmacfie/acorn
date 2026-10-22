# Credential handling

This page covers how a Node stores and lends secrets, what a child process inherits, and how internal
tokens are scoped. Read it before you add a credential, spawn a child, or mint a token. It's part of
the [security model](../security.md). [Authentication](../authentication.md) owns the token formats.

## Provider credentials

Provider credentials are encrypted at rest with `SESSION_ENC_KEY`, submitted write-only, and never
returned in an API answer, client persistence, a log, an event, or an error envelope. The GitHub
token is read only by the GitHub plugin's credential accessor. The HTTP client is device-only and
doesn't expose encrypted request material to internal callers.

Core reads a stored secret through `SecretService.use()` (`packages/node-core/src/server/core/secrets.ts`),
never a raw decrypt. `use()` passes the plaintext to a callback and, if the callback throws, scrubs
the plaintext out of the error before it leaves. Some providers echo a credential back in an error
answer, and that answer gets logged, wrapped in an `ApiError`, and sometimes returned to a client.
`use()` can't stop a caller from returning the plaintext out of its own scope. The containment that
matters, an agent reaching a credential at all, comes from internal-token scoping.

`reveal()` is the named escape hatch for a consumer whose lifetime one scope can't bracket, such as a
database connection pool or a driver's child environment. Every call to `reveal()` sits outside the
scrub-on-throw protection.

**A Sentry DSN is a credential, and it's the only one the exporter asks for.** `sentry-telemetry`
stores it through the connection seam and gets it back for one flush at a time through
`ctx.providers.withConnection`. Its manifest declares `secrets: false`, which is accurate: core
resolves the row inside its own secret scope. A DSN authenticates ingestion into one project and can
read nothing, which is why the exporter doesn't ask for an organisation token
([integrations.md](../integrations/sentry.md#sentry)). The DSN goes in the `X-Sentry-Auth` header and the
envelope header, never in a payload, and the connection's label is the host and project, never the
key.

## Child environments

The process broker builds every child's environment from an allowlist and never spreads
`process.env`. A child doesn't inherit `SESSION_ENC_KEY`, GitHub credentials, arbitrary `ACORN_*`
values, or the parent's environment. It receives a task-scoped internal token, the data-root path, and
the TLS trust material it needs to call the Node. A caller that needs more passes
`passthrough: ['DOCKER_*']`, visible at the call site.

**A harness generate spends the CLI's own login, never a key acorn holds.** A Generate control can
point at an agent CLI installed on the machine ([integrations.md](../integrations/model-providers.md#model-providers)),
and that child gets no credential. Its environment is the broker's base allowlist plus
`AGENT_TOOL_PASSTHROUGH` (`server/agentProfiles/toolEnv.ts`): `XDG_CONFIG_HOME`, the npm prefix, the
proxy variables, and the TLS trust files. `ANTHROPIC_*` and `OPENAI_*` are left out on purpose,
because those globs would carry API keys. The child also gets no acorn token, no task, and no MCP
server. A CLI that's installed but signed out fails the generate.

The stderr of a failed harness generate goes to the Node log with the profile id, status, and
duration, never to the client. A CLI's diagnostics can quote a config path, a home directory, or
whatever else it read while failing.

## Internal tokens

Internal tokens are HMAC credentials with a 48-hour expiry. A task token also carries a credential
ID, which must still be live when it's used ([revoking a credential](#revoking-a-credential)).
Verification returns the same null result for expired, malformed, forged, and revoked tokens. The signing key persists across restarts
([Node keys](#node-keys)). Rotating it revokes every outstanding token. The Node accepts these tokens only from a loopback TCP
peer, even when its listener is advertised. Forwarded headers do not establish that peer.

Two scopes exist:

- `service`, for the Node's own loopback calls, such as a firing schedule, the measure sampler, or
  notes seeding. It's minted in-process and never placed in a child's environment.
- `task`, for everything handed to a child: PTYs, agent sessions, workflow steps, and the MCP server.
  It carries the task id it was minted for, and may carry a session id and a server-computed tool
  ceiling. The signature covers every claim.

`CoreServices` doesn't expose minting, because any plugin could then ask for a token of any scope.
The composition root builds a scoped credential factory and hands it to the plugins that spawn
children, terminal and agents, as a constructor dependency. The factory closes over the signing key
and the listener's address, which don't exist until every plugin's `init` has run. A plugin calls it
once per child with the scope that child needs, for example
`{ scope: 'task', taskId, sessionId, toolCeiling }`. Workflow and delegated sessions persist their
ceiling before the runtime mints the token, and later configuration updates can't widen it.

For a task child, the factory also writes a 0600 token file in the data root and passes
`ACORN_API_TOKEN_FILE`. The Node refreshes session files every 12 hours and at boot, so a tmux session
can reattach after its original environment token expires. The MCP server and task CLI read the file
for each request; a missing explicitly supplied file fails closed. Refresh re-signs only the existing
verified scope, task, session, and ceiling. Files untouched for 30 days while the Node is down are
removed at boot.

When the terminal plugin reattaches a preexisting tmux session, it mints that session's file and updates
tmux's session environment. A running shell retains its old environment, so new MCP and task CLI
processes can also derive the same file path from the existing data root, task ID, and session ID.
Until that file appears, they may use the environment token, which the Node can reject. The task and
its data do not need to be recreated.

A one-shot workflow step gets a separate file while its child runs. The Node refreshes it on the
same timer and removes it when the step ends; orphaned child files are removed at startup.
Node-owned service calls mint on demand. A direct custom loopback client in a long-lived PTY should
read the file for each request instead of retaining `ACORN_API_TOKEN` from its environment.

### Revoking a credential

Each task token carries a random credential ID, and renewal keeps it. HTTP auth and the WebSocket hub
refuse a task token whose ID isn't in the Node's set of live IDs (`ActiveCredentials` in
`packages/node-core/src/server/auth/activeCredentials.ts`). A copy of a token stops working when its
owner goes, rather than up to 48 hours later:

- A workflow step's token is revoked when the step releases its file.
- A session has one live token. Minting it again, when the agent process restarts or a tmux session is
  reattached, revokes the one before.
- Deleting an agent session, removing or dropping a terminal session, a plain shell exiting, and a
  dead tmux session found at boot each revoke that session's token and delete its file.

The set lives in memory. At start, the Node rebuilds it from the session files it renews, and deletes
every workflow file, so a released step's token never comes back. After start, it renews only the
files it wrote, and deletes a token copied back to a removed session's path. A token file planted in
the data root before a restart is adopted, like the other planted files in
[what this doesn't stop](../security.md). A token minted before credential IDs existed has none, so
it fails, and the first start after the upgrade gives each session file a new token with an ID.

A service token never leaves the Node's process, so it carries no ID.

The agent-tool route reads session identity and tool limits from the verified principal only. The
`x-acorn-session-id` header grants nothing. Session-required tools drop
out of `tools/list` without a signed session claim. A per-call UUID is used only after the signed
owner and tool name scope it as an idempotency key.

## Node keys

A Node has two secrets. The session key, `SESSION_ENC_KEY`, encrypts stored credentials. The signing
key signs internal tokens. An agent runs shell commands as the same OS user as the Node, so file modes
don't keep either from it. A key in the data root or in the Node's start environment is one `cat` or
`ps eww` away from any agent.

A Node the desktop app starts keeps neither in plain form:

1. The helper keeps both in `node-keys.sealed` in the data root, encrypted with AES-256-GCM under the
   data key Rust holds in the OS keychain ([keys and custody](../shell/process.md#keys-and-custody)).
2. At each start, the helper unseals the file and sends both keys in the `service.start` message over
   the IPC channel. The Node refuses a start message without them and never reads a key file
   (`packages/custody/src/custody/nodeKeys.ts`).
3. The helper starts the Node without `SESSION_ENC_KEY`, `INTERNAL_TOKEN`, or `GITHUB_CLIENT_SECRET`
   in its environment. A variable a `.env` file supplied whose name ends in `_KEY`, `_SECRET`, or
   `_TOKEN` stays out too. Variables from the environment the app was launched with stay in, because
   every ancestor process already shows them and a harness may pass one to its agent
   (`serviceEnvironment` in `packages/custody/src/supervision/serviceHost.ts`).

A `SESSION_ENC_KEY` from a `.env` file wins over the sealed key, as it won over `session.key`, and
travels the same IPC route.

The sealed file is only as safe as the data key. On a packaged build with the key in the keychain,
another process can't read it without a prompt the person sees. A development build, or a machine
where the keychain refused the item, keeps the data key in a plain `data.key` file in the custody
root, and an agent can read that file unless **Keep agents out of Acorn's data folder** is on
([the read block](../managed-agents/read-block.md)).

The CLI, the terminal client, the phone gateway, and the browser bridge keep the owner's device tokens
as plain files in the client config folder. The read block is what keeps agents from them. Sealing
them with the platform keychain, as the desktop does, is the follow-up; the CLI and the gateway also
run on Linux and beside a standalone Node, where there's no keychain to use.

### Upgrading a Node with plain key files

The first desktop start after the upgrade migrates the plain files:

1. The helper seals the existing `session.key` as it is, because a new session key would leave every
   stored credential unreadable. It mints a new signing key, because any agent that ran before could
   have read the old one. Nothing reads `internal-token` again.
2. The Node boots with the sealed keys. A token signed with the old key fails from then on. The Node
   writes a new token file for each terminal session it reattaches, and an agent session gets one
   when its process starts, so no live session needs the old key. Nothing re-signs with it, so a key
   an agent writes into `internal-token` can't sign a token file the Node then trusts.
3. The Node tries the session key on its stored credentials and reports `ok`, `none`, or `failed` in
   its start result. A standalone Node runs the same check on the key it read, and security
   diagnostics shows the answer.
4. The helper deletes `internal-token`. It deletes `session.key` only when that file holds the key
   the Node used and the check answered `ok` or `none`. On `failed`, the file stays and the Node
   records `keys.check.failed` in the audit trail.

A crash between steps is safe: the next start finds the sealed file and the plain files, and
finishes the same migration. If the helper can't open the sealed file, because the keychain item was lost or the file
was damaged, it refuses to start the Node and says why. It never reseals from a plain `session.key`
on its own, because an agent could plant one. Deleting the sealed file is the person's decision, and
the next start then seals whatever plain `session.key` is left.

A standalone Node has no keychain. It keeps `session.key` and `internal-token` in its data root, or
takes `SESSION_ENC_KEY` from its environment, and warns at boot that agents on it can read them. It
refuses to mint a session key on a root that has a sealed file but no plain `session.key`.
**Check this node** reports where the keys came from and any plain key file still in the data root
([security diagnostics](./security-diagnostics.md)).

## Owner identity and provider access

The node-owner identity is opaque, explicit, and persisted at first boot. It's independent of
provider connections, and internal auth fails closed if it's unset. A task token can't use another
task's routes, terminal streams, or worktree operations.

A task token can't spend a stored provider credential. Core's `providerCredential`
(`server/integrations/credential.ts`) returns the credential only to a device or the Node's own
`service` calls, and an empty string to a task token. A GitHub route that a task token reaches gets no
token, so it can't call GitHub as the owner. Routes that administer or spend a connection also sit
behind `requireProviderAccess`, which admits devices and `service` calls and refuses a task token
([the gates](./transport-and-auth.md#the-gates)).
