# The node realm

This page covers how a loaded plugin's node half is contained: the runtime floor, the
permission-shaped context, the isolated worker realm, and the OS boundary still to build. Read it
before you add a facet to the plugin context or change the loader. It's part of
[plugin security](./node-plugin-security.md).

## The runtime floor

Before it resolves plugin files, prepares storage, or creates a worker, the host enforces the shared
runtime policy in `packages/protocol/src/runtime/nodeRuntime.ts`: 22.23.2 or later in branch 22,
24.18.1 or later in branch 24, or 26.5.1 or later in branch 26. Other branches and prereleases are
refused. The floors include the
[July 29, 2026 permission model security fixes](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases).
The terminal client applies the same policy to its plugin workers. The desktop bundles Node 24.21.0,
pinned in `node-runtime.json`.

## Rung 1: permission-shaped context

The host builds a loaded plugin's `NodePluginContext` from its manifest's `permissions.node` block. An
undeclared capability id returns `undefined` from `capabilities.get`. An undeclared `CoreServices`
facet is absent from `ctx.core`. `secrets` and `exec`, the process broker, are gated one by one and
off by default. `ctx.events.streams()` and `channel()` are never present for a loaded plugin. Built-ins
keep the full context.

Gating is by omission, not by throwing. An absent facet fails at development time with a `TypeError`
the author sees, and the shape of `ctx` documents the grant. The facet-to-permission mapping lives in
one module with exhaustive tests.

`ctx.core.projects` (`packages/node-core/src/server/core/projectRefs.ts`) is the model for a facet.
Identity and write methods use `ProjectRef` projections, so a plugin can resolve a project without
seeing its config columns or holding the core database. The methods that return executable
configuration, `config`, `setup`, and its trust assertion, need the separate `projects:config` grant.
`checkouts()` returns the local path of every mapped project, which discloses where the user keeps
their code, so the trust prompt says so. Identity, executable config, and writes stay split as
`projects:read`, `projects:config`, and `projects:write`.

`ctx.core.prefs` scopes a raw service that can't be narrowed by projection. A loaded plugin sees only
`plugin:<id>:*`, the same namespace its frame reaches through `state.get` and `state.set`, with the
same 1 MiB value cap. Built-ins keep the raw service for core keys.

`ctx.core.data` does the same for databases. `data:query` exposes connect, catalog, schema, and
bounded reads, while core keeps the URL, driver, socket, and pools. Reads run in a read-only Postgres
transaction with a host-side timeout and row cap. `data:write` is a separate high-risk grant and the
only projection that accepts `{ readOnly: false }`.

### Reading other plugins' data

A loaded plugin's `ctx.dataSources.invoke` reaches only its own sources. It reads another plugin's
source only as a declared input of a derived source, through the `inputs` handles on that source's
request context. The host runs each read with the account the query bound, so the plugin never
holds a credential and can't read outside a request. A handle refuses any input the person's input
grant doesn't cover, and offers no actions or writes. Compiled plugins need no grant.
[Derived sources](../data-sources/derived-sources.md) has the full rules.

The person gives the grant in the trust prompt, which words each input from the input source's
registration and its owner rather than from the plugin. Only a device principal can write or revoke
it, through the device-gated plugin routes, and the Node refuses a grant for a list the installed
version doesn't declare. The handle checks the grant at every read, so a revocation stops the next
read without a restart. A grant never covers an account: each panel still picks the account for each
input.

Development mode writes a grant itself, marked `development`, for a plugin installed from a local
folder. Only a device principal can turn it on, the switch is audited, and turning it off deletes
that grant, so the person approves the list again
([development mode](../plugins/dev-loop.md#development-mode-for-a-folder-plugin)).

### The broadcast namespace

A loaded plugin's `ctx.events.send` is confined to `plugin:<its-id>:*`, and naming anything else
throws. Without that, a plugin could put frames on `term:` or `workflow:` and impersonate core's
streams, because a renderer can't tell a forged `term:out` from a real one. A built-in owns real
channel prefixes through `ctx.events.channel`.

### Telemetry sinks

`ctx.telemetry` and `ctx.log` are on every node context with no grant. A plugin measuring its own work
reads nobody else's, and the host binds the owner.

Reading the stream is the opposite. A sink registered through `ctx.core.telemetry.onBatch` sees every
record from every owner: core's request timings and route patterns, another plugin's schedule and hook
runs, and the log lines of unrelated packages. So it's its own `telemetry` grant, and the trust prompt
draws it **high**, saying whose records they are. Three things bound what a sink learns
([what never leaves the machine](../telemetry/model.md#what-never-leaves-the-machine)): attributes are
allowlisted scalars, names are patterns with ids as attributes, and every message passes the scrubber.
`onServerError` sends a name and a code, never a message, because drivers embed bound values there.

## Rung 2: isolated node realm

Each loaded plugin's node half runs in its own `node:worker_threads` realm, started with Node's
permission model on. It reaches the host only through one `MessagePort`. The host exports an
owner-bound, manifest-shaped `ctx` over that port. Registrations, fetch route handlers, capabilities,
and the few synchronous calls keep their published signatures through structured-clone RPC.

The launch grant is narrow:

- The worker may read the installed package and the trusted bootstrap and runtime dependencies. Source
  workers name individual trusted packages, never the containing `node_modules`.
- A plugin with migrations may read and write only its pre-created database, WAL, and SHM paths. The
  worker opens that database itself, checks the migration history, and never receives the host
  database or storage service.
- The environment starts from the process broker's credential-free base. `env` names add single
  values. `files` resolves single absolute paths from named values and refuses anything under acorn's
  data root.
- Direct `node:sqlite` is refused, including through `process.getBuiltinModule`, which would otherwise
  bypass Node's filesystem checks.
- Raw socket modules are refused. `fetch` exists only when `permissions.node.net` is non-empty. Exact
  hostnames and `*.domain` grants, one label deep, return redirects unfollowed so the next request is
  checked again. An explicit `'*'` permits any hostname.
- Child processes exist only with `exec`. Nested workers and native addons are never granted.

The worker's ESM resolver, scoped `require`, and `process.getBuiltinModule` use one builtin family
policy, `@acorn/protocol/plugin/nodeBuiltins.ts`. Internal and unknown families are refused, and
socket and process families need their grants. A dependency must resolve to an approved builtin or a
real file inside the package. Incoming fetch requests have `Authorization`, `x-acorn-internal`,
cookies, and proxy authorization removed before they cross into the worker.

**RPC exports have owners.** Lifecycle contexts, route registrations, subscriptions, disposal handles,
and capability results belong to the realm. A fetch call owns its request context and provider
services. Provider, secret, and telemetry visitors lend their callback only until the operation
finishes. The transport retires exports when their owner finishes, fails, or cancels, and refuses a
further authority call after that. A returned telemetry span owns its own scope until `end`.

Cancellation carries through mount forwarding, worker execution, and body encoding. It stops the host
waiting and suppresses a late reply, but doesn't stop plugin code that ignores the signal. Fetch bodies
stay fully buffered across the seam. Synchronous calls keep nested message draining and a five-second
ceiling, with reply buffers from a 4 MiB pool.

Reload keeps the candidate-then-commit contract. A candidate gets a fresh realm, buffers its
registrations, and replaces the previous realm only after import, dependency checks, and `init`
succeed. A failed candidate is terminated. After a commit the previous realm is disposed.

The acceptance test uses two hostile plugins. One imports `node:sqlite`, and the other asks
`process.getBuiltinModule` for it. Both try to open `core.sqlite` and a peer's database and fail before
they obtain `DatabaseSync`.

A source checkout on Node 24.21.0 can read harmless sibling dependency source and metadata through
workspace symlinks, despite per-package grants. Import provenance is still enforced. The grants don't
prove complete native filesystem confinement.

## Rung 3: OS-level sandboxing

Per-platform confinement of a plugin process: Seatbelt profiles on macOS, Landlock and namespaces on
Linux, and AppContainer on Windows. This is what would enforce a `net` allowlist at the socket and
give crash isolation. It's substantial per-platform work, worth it only if plugins need direct egress.
Design nothing that assumes it, and foreclose nothing that enables it. Moving the RPC contract from a
worker to a process is the migration path.

## Resource abuse

The client side has the bridge rate limiter. The node half has its own event loop, so a busy plugin
doesn't share core's loop, but a worker still shares the process's memory and CPU. Per-plugin
resource limits need rung 3 or a move from workers to processes.
