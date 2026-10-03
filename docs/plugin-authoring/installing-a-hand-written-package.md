# Install a hand-written package

This page covers installing a package you wrote by hand, getting an agent to install one, reading a
load failure, and what this no-build profile refuses. It's part of
[plugin authoring](../plugin-authoring.md).

## Installing a hand-written package

The install route can't be reached from plugin code: `POST /v1/core/plugins/install` takes an owner or
device principal, requires an `Idempotency-Key` header, and is audited. For a folder you wrote, the
source is a local path:

```json
{ "source": { "path": "/absolute/path/to/my-plugin" } }
```

In the app, use **Settings > Plugins > Installed > Install…**, pick the Node, choose **Local folder**,
and select the folder with **Choose…**. **Choose…** appears only when the Node is this computer, and it
works on every build, packaged included.

`linkLocal` (`server/plugins/installer.ts`) links the folder instead of copying it, so you edit in
place and the next start runs what you edited. The path must be absolute. Uninstalling removes the
link and doesn't follow it into your working tree. A folder is the one source acorn can't pin: the
lockfile records no archive hash and no entrypoint digests, because the bytes keep changing by design
([installing from a folder](../security/plugin-install.md#installing-from-a-folder)).

Installing writes a lockfile and reports `installed-restart-required`. A loaded plugin's routes,
tables, and jobs wire at init, so the package isn't live until the Node runs it. Restart the Node.
Under the desktop, use **Restart node** in **Settings > Plugins > Installed**, which also reloads the
renderer.

If the package has a client file, each device asks its own owner before running those bytes, keyed by
`(pluginId, hash)`. Rewriting `client.js` changes the hash and prompts again. A package with no
`client` has nothing to trust and registers its descriptors directly.

## If an agent writes the package

An agent should call the `plugin_authoring` agent tool first. It answers with this contract plus the
connected Node's current manifest vocabulary, action verbs, and bridge messages, read from the Node's
own schemas ([agent tools](../agent-tools.md)).

An agent can't call the install route, because no task-scoped token reaches it. It asks with the
`plugin_request` agent tool, the owner approves in the shell, and the device installs. Asking with
`dev: true` also puts the plugin in development mode on the approving device, which trusts its later
bundles without asking, so the loop becomes edit and reload instead of edit, prompt, and restart
([agent installs and development mode](../plugins/agent-install.md)).

## When the package doesn't load

The roster row says why. The manifest reason names the failing field paths, up to three, then "and N
more". `stage` separates `'load'`, a package that never ran, from `'init'` and `'ready'`
([failures are contained](../plugins/loaded-plugins.md#failures-are-contained)). The plugin's page
under **Installed** shows the reason, and so does the attention inbox.

Two common load failures come from the machine, not the package:

- The Node runs loaded plugins only on a patched Node release:
  `>=22.23.2 <23 || >=24.18.1 <25 || >=26.5.1 <27`. An older release fails every loaded plugin with a
  reason that names both versions.
- A bare import that resolved on your machine from a parent `node_modules` fails on another machine
  ([the node half](./the-node-half.md)).

## Updating

Keep the plugin id stable, and append migrations instead of editing applied ones
([storage and migrations](./storage.md)). The installer rejects a lower version unless the caller asks
for a downgrade. An agent's install and update requests go through `plugin_request` and device
approval, and a development grant changes only the client trust loop.

## What this profile refuses, and why

- **A bundler in the Node.** A bundler costs size, supply chain, and a compile step inside the trusted
  process, permanently. If a plugin needs a dependency or JSX, build it in a repository checkout with
  `build:plugin`, or bundle it yourself before installing.
- **Multi-file plugin origins.** Serving a file tree at `app-plugin://<hash>/` would make the hash cover
  a directory instead of a file, which is harder to audit for nothing an inlined `data:` URI can't do.
- **Editor internals.** A document region exposes text through the host's editor, not the editor's
  API. Use trees for shared UI and frames for browser-specific rendering.

The profile is a contract versioned with the plugin API major. When the loader's tolerance changes,
update this page on purpose.
