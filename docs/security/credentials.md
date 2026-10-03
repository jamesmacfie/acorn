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

Internal tokens are stateless HMAC credentials. The signing key persists across restarts, so a
tmux-reattached agent session keeps authenticating after the Node restarts. Rotating the key revokes
every outstanding token. Tokens carry no expiry, so scope and rotation are the only lifetime controls.

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

The agent-tool route reads session identity and tool limits from the verified principal only. The
`x-acorn-session-id` and `x-acorn-tool-ceiling` headers grant nothing. Session-required tools drop
out of `tools/list` without a signed session claim. A per-call UUID is used only after the signed
owner and tool name scope it as an idempotency key.

## Owner identity and provider access

The node-owner identity is opaque, explicit, and persisted at first boot. It's independent of
provider connections, and internal auth fails closed if it's unset. A task token can't use another
task's routes, terminal streams, preview tunnel, or worktree operations.

Provider-credential limits are route-specific. A GitHub route reachable by an internal principal can
spend the owner's GitHub credential. Routes that administer or spend a connection sit behind
`requireProviderAccess`, which admits devices and `service` calls and refuses a task token
([the gates](./transport-and-auth.md#the-gates)).
