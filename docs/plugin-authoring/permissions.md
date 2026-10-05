# Permissions

This page is the reference for a manifest's `permissions` block: what the node half may reach, what a
frame may call, and which channels it may hear. It's part of [the manifest](./the-manifest.md).

## Permissions

There are three groups, each enforced at the boundary that owns it:

- `permissions.node` shapes the `ctx` your node half receives and its permission-scoped worker realm.
- `permissions.api` is the frame's scope list, enforced by the bridge.
- `permissions.events` names the channels your node half and frames may subscribe to.

[The node realm](../security/plugin-node-realm.md) covers how the worker enforces the node grants.

## Node permissions

`permissions.node` gates by omission. An undeclared host facet is absent from `ctx.core`, so the first
call is a `TypeError` you see at once (`server/plugins/permissions.ts`). Filesystem, environment,
process, and network access are also absent unless declared.

- `core` lists facets: `fs`, `git`, `tasks`, `context`, `models`, `identity`, `prefs`, `telemetry`,
  `agent-tool-provenance`, `data:query`, `data:write`, `projects:read`, `projects:config`, and
  `projects:write`. `projects:config` and `projects:write` each imply `projects:read`.
  `checkouts()` returns where every codebase on the machine lives, and `config()` returns shell
  commands the Node runs, so they're separate grants. An unknown token is skipped, not rejected, so a
  manifest naming a facet from a newer build loses only that grant.
- `capabilities` lists capability ids this plugin may `get` or `require`. `provide` is never filtered,
  because exporting a capability is a contribution, not an access grant.
- `secrets` and `exec` are Booleans, separate from `core`, because a reviewer should see them spelled
  out. `secrets` gives use-scoped credential access through `ctx.core.secrets`, and `exec` gives the
  process broker, `ctx.core.proc`.
- `net` lists exact hostnames or `*.domain` patterns the worker's `fetch` may reach. A pattern matches
  one subdomain label, not the parent domain or deeper subdomains. `'*'` allows any hostname, permits
  redirects, and appears as broad network access. With a host-scoped grant, redirects are returned,
  not followed, so fetching the next location checks its host again.
- `sockets` grants unrestricted raw sockets, for protocols that can't use the `fetch` broker. It's a
  broad, high-risk grant with no hostname list. Raw network modules stay unavailable without it.
- `env` lists parent-environment variable names the worker may inherit, beyond the process broker's
  credential-free base. Each is a high-risk trust line.
- `files` lists local path grants resolved from environment variables, as
  `{ "env": "MY_PLUGIN_FILE", "access": "read" | "read-write" }`. The value must be absolute and outside
  acorn's data root. A read-write grant includes one fixed `.acorn-tmp` file beside it, so you can
  replace the file atomically.

`agent-tool-provenance` lets your plugin verify the proof an agent tool call carries, that it came
from a given task and session.

## Telemetry, models, and data

`telemetry` is the one grant that hands you other packages' data. It gives you
`ctx.core.telemetry.onBatch`, and a sink sees every record this Node collects from every owner:
core's request timings, other plugins' schedule and hook runs, and other packages' log lines. The
trust prompt draws it high. Writing telemetry about your own work needs nothing
([telemetry](./telemetry.md)).

```json
{ "permissions": { "node": { "core": ["telemetry"] } } }
```

```js
export function init(ctx) {
  ctx.core.telemetry.onBatch((batch) => queue.push(batch))
}
```

Return quickly. The collector calls sinks on a timer, awaits none of them, and contains a throw, so
buffering, retry, and sampling are yours ([writing a sink](../telemetry/plugins-and-sinks.md)). A sink
can check `ctx.core.telemetry.enabled()` before retrying a queued export. It reports the collector's
consent, updated within five seconds. Don't read `telemetry.enabled` through `ctx.core.prefs`, which
is scoped to your own namespace.

`models` is one token, and it doesn't choose what gets spent. The trust prompt reads "Generate text
with your model providers and installed agent CLIs", because the list holds both a connected API key
and any agent CLI that declares a one-shot mode ([model providers](../integrations/model-providers.md)).
The person picking from the list decides which runs. You can't name a CLI the owner doesn't have, or
make one run with tools or in a worktree.

`data:query` supplies `ctx.core.data`: connect or disconnect a task's configured PostgreSQL source,
inspect its catalog or schema description, and run a bounded read. Core resolves the URL, applies the
repo-config trust gate, owns the pool, normalizes cells, caps rows and timeouts, and runs reads in a
read-only transaction. Your plugin never sees the URL or opens a socket. `data:write` adds
`query(..., { readOnly: false })` and draws as a separate high-risk line. Put parameters in
`options.parameters`, never in the SQL text. Identifiers can't be parameters, so check them against
`catalog()` before quoting them.

A derived source's `inputs` work as a grant too, though they live on the source, not in
`permissions`. The person approves the list of sources your plugin reads, and a handle refuses any
input the grant doesn't cover. Each panel still picks the account for each input. For the rules, see
[derived sources](../data-sources/derived-sources.md).

## Frame scopes

`permissions.api` is enforced by an allowlist of path shapes and methods in
`packages/client-core/src/host/frames/scopes.ts`. Your own `/v1/p/<id>/` namespace needs no scope and is
always allowed. Another plugin's namespace is always denied. Everything else needs one of six scopes:

```text
core.projects:config   core.projects:read   core.projects:write
core.tasks:read        core.tasks:write     core.workspaces:read
```

That's the whole grantable list (`GRANTABLE_SCOPES`, derived from the table). Much of core can't be
granted to a frame at all, including the plugin install route. An unknown scope parses, and the bridge
denies it.

## Event channels

`permissions.events` names the channels you may subscribe to. Subscribing doesn't create a channel.
There are four kinds:

- **Core events**, for your node half's `ctx.events.on`, such as `project:changed`
  ([hearing a core event](../plugins/events.md#hearing-a-core-event)).
- **Five shell channels** for frames, listed in `client-core/host/frames/channels.ts`. Four say that
  something a frame may show has gone or moved: `runtime:task-archived`, `runtime:workspace-removed`,
  `runtime:node-removed`, and `runtime:node-switched`. `runtime:focus-changed` says which pane and
  region of this window has the keyboard, as `{ taskId, paneId, regionId }`. All five are about one
  window, so a Node never broadcasts one.
- **Another plugin's channel**, `plugin:<other-id>:<verb>`, when that plugin lists the verb in its
  `emits`. If it isn't installed, you hear nothing and get no error, so treat a frame as "read again",
  never as the only way you learn something.
- **Your own channel**, `plugin:<your-id>:<verb>`, which your node half broadcasts on with
  `ctx.events.send({ channel, ...payload })`. Verbs are lowercase, start with a letter, and hold no
  colon.

Your own channel is how a frame gets live data without polling, and it also refreshes your
descriptors faster than the 30-second floor a declared `refresh` allows ([the live
channel](../plugins/freshness.md#the-live-channel)).
