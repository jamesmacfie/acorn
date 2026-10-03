# Loaded plugins

This page covers how a Node loads a plugin's node half from disk: the install route, failure
containment, the context the manifest shapes, and the limits on package input. It's part of the
[plugin reference](../plugins.md).

## Loaded plugins

A Node loads a plugin's node half from `<dataRoot>/plugins/<id>/`, a directory holding an
`acorn-plugin.json` manifest and an ESM entrypoint that default-exports a `NodePlugin`. The manifest
shape is declared once, in `packages/protocol/src/plugin/contract.ts`, because the client registers
contributions from the same shape. `packages/node-core/src/server/plugins/manifest.ts` adds the
cross-field rules that need `id`, such as route confinement and surface reachability, and reads the
file.

Loaded plugins join the same list and the same host passes as compiled ones, so `ready`, late-bound
capabilities, and disposal work the same way. Each loaded node half runs in a permission-scoped
worker realm ([the node realm](../security/plugin-node-realm.md)). The Node refuses to run loaded
plugins on an unpatched Node release. The supported range is `NODE_RUNTIME_RANGE` in
`packages/protocol/src/runtime/nodeRuntime.ts`: `>=22.23.2 <23 || >=24.18.1 <25 || >=26.5.1 <27`.

A loaded plugin differs from a compiled one in three ways, and all three follow from the code not
being acorn's own.

### Installed through the installer

`POST /v1/core/plugins/install` takes an owner or device principal, requires an `Idempotency-Key`,
and is audited. It resolves a GitHub release, an npm package, a tarball URL, or a local folder,
validates the manifest, and places the package with a hash-pinned lockfile beside it. A folder is
symbolically linked and pins nothing ([installing from a folder](../security/plugin-install.md#installing-from-a-folder)).
The installer is `packages/node-core/src/server/plugins/installer.ts`.

Uninstalling removes the package and, by default, leaves its SQLite file. Install, update, and
uninstall each change the disk, not the running plugin. The one exception is
`POST /v1/core/plugins/:id/reload`, which swaps a loaded plugin's node half in the running process
([the dev loop](./dev-loop.md)). Each device then asks its own owner before running the plugin's
client code.

### Failures are contained

A compiled plugin that throws from `init` fails the boot, because a Node that can't assemble its own
code should say so. A loaded plugin that throws has its registrations rolled back, is reported
through the roster as `state: 'failed'` and in the attention inbox, and the Node keeps starting.

A failed roster row carries `reason` and `stage` beside `failedAt`. `stage` is `'init'` or `'ready'`
for a plugin that ran and threw, and `'load'` for a package that never ran:

- A manifest that doesn't parse. The reason names the failing field paths, up to three, then
  "and N more".
- An `apiVersion` this Node doesn't speak.
- A `requires.plugins` entry naming a package this Node doesn't have.
- An id a second directory already claims.
- An entrypoint that throws on import, or a wrong default export.
- A package held for review, or a Node runtime below the supported range.

A load failure raises no restart banner, because restarting re-runs the same failure. A package the
loader dropped before it could be listed still gets a row.

`reason` is a loaded plugin's own text on its way to the owner's UI. The Node caps it, and the client
renders it as text, never as markup. Both fields are optional on the wire, so a client talking to an
older Node shows a generic sentence. A load failure describes the boot that saw it, so fixing the
package on disk leaves the row reading `failed` until the restart that reads it again.

### The context is shaped by the manifest

`permissions.node` decides which `CoreServices` facets and capability ids the plugin can see
([permissions](../plugin-authoring/permissions.md)). Which members it gets isn't a manifest
question: that's the `NodePluginContext` type ([the two contexts](./plugin-api.md#the-two-contexts-one-per-tier)).

A loaded plugin serves routes with `ctx.routes.fetch(handler)`, a
`(Request, PluginRequestContext) => Response` function. A plugin that wants Hono wraps its router in
`portableCarrier(id)` from `@acorn/plugin-api/node`, which returns the `portableFetch` wrapper and the
matching `requestContext(c)` accessor.

The request context projects the authenticated identity and a provider runtime. It exposes
provider-owned resource, connection, and external-item operations without exposing Hono, the core
database, or the secret service. The external-item calls cover one read a per-connection resource
can't: the same cached item across every connection of one provider. The host binds the owner and
the provider ownership check. A loaded integration provider passes a fetch handler to
`ctx.providers.integration`, and passing Hono is an initialization error.

Project access takes three grants. `projects:read` covers identity, checkout paths, and workspace
external-project mappings for the connection providers this plugin registered. `projects:config`
covers executable build, dev, and database configuration. `projects:write` covers creating or
updating projects. The `telemetry` facet is the read side of telemetry and the one grant that returns
other packages' data, so the trust prompt draws it high. The `prefs` facet reads and writes the
`plugin:<id>:*` namespace that the plugin's frame `state.get` and `state.set` verbs use. That's the
supported channel between a node half and its frames, and values are capped at 1 MiB.

## Package input limits

Node installation and device custody share the package reader and archive process:

- Downloads stop at 32 MiB of compressed bytes.
- A disposable process checks the private staged archive with `tar` 7.5.22, then extracts the same
  bytes with that library. The process has a 128 MiB V8 heap, a 120-second deadline, and a 250 ms
  termination grace. Cleanup waits for the process to close.
- The check limits decompressed tar bytes and total declared file bytes to 128 MiB, each file to
  32 MiB, paths to 4,096 bytes and 32 components, and each metadata record to 64 KiB.
- It admits at most 10,000 effective filesystem members and non-empty metadata records, counting
  repeated paths.
- It refuses nested compression, sparse declarations, special files, invalid paths, members that
  descend through archive links, broken links, and aliases outside the package root.
- Extracted files keep owner executable bits and deny group and other access.

Local development folders stay linked and mutable. Validation and review limit directory walks to
10,000 entries and 32 levels, each file to 32 MiB, and the package to 128 MiB. Manifests are limited to
256 KiB, Node entrypoints to 32 MiB, and client bundles to 8 MiB.

Discovery, hashing, bundle serving, and device custody open canonical, package-confined regular
files, inspect the descriptor before reading, and cap the bytes read if a file grows. POSIX
nonblocking and no-follow flags refuse FIFOs and a replaced final path component. Windows lacks those
flags, so its canonical and descriptor checks stay, and directory custody depends on the operator's
ACL. These checks don't give an atomic snapshot of a mutable development folder, and they don't stop
another process running as the owner from replacing an intermediate directory.
