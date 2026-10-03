# Storage and supply chain

This page covers how a loaded plugin's SQLite file is confined, how an install proves what it
fetched, and the design rules that keep the plugin boundary intact. Read it before you change plugin
storage, the installer, or the shape of the plugin API. It's part of [plugin security](./node-plugin-security.md).

## Storage

- **State-file preparation** refuses links and special files at the database, WAL, and SHM names
  before native SQLite opens them. The host creates and chmods through descriptors checked as regular
  files, with no-follow and nonblocking flags on POSIX hosts. The shared `plugins/` directory can't be
  a link. Supported data-root aliases and missing sidecars stay valid. This is a static preflight, so
  a path swap between the check and SQLite's native open is a known limit.
- **Migrations and SQL** run under a native SQLite authorizer, installed before migration history,
  migrations, or any statement, in both the worker adapter and the loader's host fallback. It refuses
  `ATTACH`, `DETACH`, file export through `VACUUM INTO`, filesystem PRAGMAs, and extension and file
  functions. PRAGMAs and virtual table modules have explicit allowlists, and temporary SQL storage
  stays in memory. The native connection is private, so plugin code can't remove the policy. The
  fallback also refuses arbitrary backup destinations. Ordinary schema changes, nested transactions,
  and WAL work.
- **A runtime without `DatabaseSync.setAuthorizer` refuses loaded storage**, including the supported
  floor, Node 22.23.2. Use the bundled Node 24 runtime for loaded plugins with storage. Core and
  compiled plugin SQL policy is unchanged.
- **Backups.** Backups scrub core credentials and device rows, but a plugin that stores tokens in its
  own SQLite defeats the scrub, because its file is copied verbatim. Secrets go through core secret
  storage, never plugin tables.
- **Scope by `projectId`, and store nothing else about the project.** Plugin tables reference a project
  by id only, as `plugins/http`, `plugins/database`, and `plugins/memory` do. A plugin that caches a
  project's path, remote URL, or config columns has copied the two most sensitive parts of the
  `projects` row into a file the backup scrub doesn't treat as sensitive and that survives uninstall
  by default. Read through `ctx.core.projects` each time instead.

[Plugin databases](../data-layer/plugin-databases.md) and [migrations](../data-layer/migrations.md)
cover how a plugin opens its file.

## Supply chain

- **npm integrity is checked.** npm's published `dist.integrity` is compared with the downloaded
  bytes, and a mismatch fails the install with nothing written
  (`packages/node-core/src/server/plugins/installer.ts`). A package the registry publishes no
  integrity string for still installs, and the lockfile records the archive hash either way.
- **The lockfile pins what was fetched.** It records the source, the resolved version, the archive
  hash, and what the source resolved to, such as a release tag or an npm integrity value, so "what
  exactly is running" is answerable later and across a fleet. A `{ path }` folder install is outside
  this, because its bytes keep changing ([installing from a folder](./plugin-install.md#installing-from-a-folder)).
- **Updates are the attack window**, for adversary one in the [threat model](./node-plugin-security.md#threat-model).
  There's no auto-update and no background check, every hash change prompts again, and the permission
  diff draws `node` additions most prominently. "Auto-update trusted plugins" is the feature request
  to refuse until signing exists.
- **Signing and attestation**, in the style of sigstore, would layer on the same lockfile fields.
  Don't invent a format the ecosystem can't verify later.
- **Typosquatting.** Local id-collision rules protect one machine, not discovery. Any browse surface
  would show the repository owner and stars and repeat the unreviewed-listing warning.

## Design rules

These rules made rung 2 possible and keep later API work from punching around it:

1. **Fetch-shaped route handlers** for loaded plugins, because a Hono instance can't cross a process
   boundary. `ctx.routes.fetch(handler)` and the fetch form of
   `ctx.providers.integration(provider, handler)` share one request-context adapter, and a loaded
   plugin passing Hono is rejected. Provider work goes through `PluginProviderRuntime`, never
   `c.env.DB`.
2. **No `streams` or `channel` for loaded plugins**, the one contribution that can't survive the
   boundary.
3. **Prefer async-shaped `ctx` calls.** The worker RPC carries the existing synchronous calls, but a
   new one must justify blocking both realms and staying within the bounded reply size.
4. **No general secret read path.** A provider callback is scoped to one connection visit, and no
   method returns a secret to keep ([secrets](./plugin-secrets-and-routes.md#secrets)).
5. **Structured-clone-safe arguments and results** for every capability a loaded plugin can reach: no
   live objects or class instances. Callback-shaped operations need an explicit request and response
   visitor protocol.
6. **Honest wording** wherever the `node` permission block is drawn. Filesystem, network,
   child-process, and host-context limits are **Enforced**. Scheduled work and task checks are
   **Declared**, because acorn confines when and where they run but can't verify what plugin code
   intends.
