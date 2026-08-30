# Target layout: the end-state trees

Part of [docs/future/structure/](./README.md). One tree per package kind. Target paths are written
without a workspace prefix on purpose; the path checker only chases rooted paths, and these files do
not exist yet. Where a tree names a current file it uses the rooted form.

## Plugins

Every plugin, compiled or loaded, has this shape and declares only the subpaths it has. This replaces
`docs/plugins.md` lines 16 to 30 in phase 1 and is enforced by a folder-shape arch rule in phase 6.

```
plugins/<name>/
  acorn-plugin.config.mjs   loaded tier only; the build script generates the manifest from it
  migrations/               drizzle output, paired with src/node/schema.ts
  src/
    node/                   index.ts (the NodePlugin factory) and schema.ts. Nothing else.
    server/                 routes/*.ts (Hono routers), engines, stores, drivers, the vendor client.
                            This is today's main/ and server/ merged.
    client/                 index.ts(x), components, <plugin>Client.ts, *Store.ts, contributions
    tree/                   loaded tier only: the remote component tree the host draws
    contract/               only modules another package imports. No tests.
    shared/                 wire types, api.ts route builders, anything both halves read
    testkit/                index.ts for node-side tests elsewhere, client.ts for client-side
```

Exports map, five kinds, a plugin declares the ones it has:

| Subpath | For |
| --- | --- |
| `./node/index.ts` | the Node activation entrypoint |
| `./client/index.ts` | the client activation entrypoint |
| `./contract/*` | the cross-plugin surface |
| `./testkit` | node-side test helpers |
| `./testkit/client` | client-side test helpers |

`./main/index.ts` is gone. `./server/index.ts` stays on linear and rollbar for the `vi.mock`
constraint the arch test already records, and that list stays at two.

Grouping inside a large `client/` or `server/routes/` is by feature, not by kind. `agents/src/client`
becomes `client/composer/`, `client/sessions/`, `client/usage/`, `client/settings/`,
`client/center/`. `github/src/server/routes` becomes `routes/pulls/`, `routes/repos/`,
`routes/checks/`, `routes/mirror/`.

## packages/node-core

`main/` merges into `server/`. The merged folder is the node library; `server/` is kept because it is
the name every plugin uses for the same side (see [refused.md](./refused.md) for `domain/`).

```
packages/node-core/
  migrations/
  scripts/                 migrate.ts, locateDb.ts
  src/
    server/
      index.ts             the Hono app factory (unchanged)
      transport/           listener (today's main/server.ts), tls, wsHub, tunnel, tunnelPorts, advertise
      storage/             sqlite, dataRoot, backup, archive, storageFootprint
      plugins/             the ten lifecycle modules without the prefix:
                           manifest, loader, installer, migrations, permissions, reload, storage,
                           bundled, bundledState, disabled
      pluginHost/          today's server/plugin/, prefixes stripped inside (state.ts, schedules.test.ts)
      worktrees/           worktrees, taskWorktree, the git seam
      core/                the service seams, one file each, facades deleted:
                           tasks.ts, secrets.ts, prefs.ts, proc.ts, fs.ts, git.ts, context.ts,
                           identity.ts, models.ts, projects.ts, index.ts
      routes/
        auth/              pairing, deviceTokens, requireUser test beside middleware instead
        projects/          projects, workspaces, tasks, worktree, membership
        plugins/           plugins, harness, agentTools
        security/          security, audit, backup, configTrust
        (the rest flat)
      agentTools/ auth/ collections/ dashboards/ db/ integrations/ middleware/ modelProviders/
      nodeProviders/ runs/ schedules/ sync/    (unchanged)
      enrollment, headless, notify, mcpRegister, bindings, runConfig ...   (flat, from main/)
    mcp/                   library code only; the executable entry moves to apps/node
    testkit/
```

Single-file folders that flatten: `server/nodeActions/registry.ts` becomes `server/nodeActions.ts`;
`server/integrations/providers/shared.ts` becomes `server/integrations/providerShared.ts`. Two-file
folders (`collections/`, `nodeProviders/`, `runs/`) stay; each has a registry and its test and a
planned third file in the schedules design.

## packages/desktop-helper

```
packages/desktop-helper/src/
  index.ts                 createHelper(), the composition root (today's main/index.ts)
  broker/                  nodeBroker, nodeRequest, nodePairing, fleetStore
  custody/                 deviceTokenStore, legacyCustody
  plugins/                 pluginCache, pluginTrustStore, bundledPluginTrust, pluginRequests
  supervision/             serviceHost, crashBudget, previewTunnel
```

## apps/node

```
apps/node/
  scripts/                 build-plugin.mjs, dev-plugin.mjs
  src/
    entries/               service.ts (stdio service peer), standalone.ts, mcp.ts
    composition/           composition.ts, plugins.ts, pluginDeps.ts, pluginState.ts, runtime.ts
  test/
    helpers/               registerProviders.ts, golden.ts
    __fixtures__/          fake-agent.sh
    integration/
      lifecycle/           standaloneShutdown, standaloneParity, serviceSpawn, enrollment
      auth/                pairing, internalPrincipal, idempotency
      pluginSystem/        pluginLoader, pluginDisable, mainBarrelLoad, pluginConfigs
      plugins/             rollbar, linear, workflowRunner, workflowFiles, memoryGen, httpLoaded
```

`vite.config.ts` builds three entries, all from `src/entries/`.

## apps/desktop

```
apps/desktop/
  scripts/                 all kebab-case
  src/
    client/                today's app/client/, one level up
    shell/                 bridge.ts, wire.ts, and their tests. Tauri bindings only.
    helper/                helperMain.ts, helperServer.ts (own vite config, own process)
  src-tauri/               unchanged
  test/                    unchanged; vitest includes src/**/*.test.ts so no test is orphaned
```

Whether `App.tsx`, `TaskView.tsx`, and `CommandPalette.tsx` stay in `src/client/` is decided per file
in phase 2 and the reason written in the file header.

## packages/client-core

Four groups. The rule for placing a file: does a plugin draw with it (kit), does it host plugins
(host), does it talk to the machine or the node (infra), or is it a product feature (features).

```
packages/client-core/src/
  kit/                     the closed kit; @acorn/plugin-api/ui/* re-exports from here
    components/            today's ui/*.tsx, primitives.tsx split by family where it helps
    tokens/                today's ui/kit/: support, tokens, focusRoles, props test
    lib/                   today's ui/*.ts utilities plus lib/: anchor, split, markdown, mentions,
                           confirm, dismissable, cx, formatRelativeTime ...
    diff/                  today's ui/diff/
  host/                    the plugin host; @acorn/plugin-api/client re-exports from here
    registries/            subdivided: extensionPoints/, panes/, sources/, palette/, rail/, commands/
    frames/                today's plugins/frames/ (remoteSolid, remoteRoot, sdk, ExtendedPane)
    chrome/                today's plugins/chrome/
    tree/                  today's plugins/tree/
    annotations/           today's plugins/annotations/ plus tasks/taskAnnotations and diff/annotationKey
    trust/                 today's plugins/ root files: approval, bundles, trust
    layouts/               today's layouts/
    keys/                  today's keys/
    palette/               today's palette/
    components/            ProviderHtml, RefPanelBox, RefPanelTaskLink (they read registries)
  infra/
    platform/              the one door to window.acorn (unchanged contents)
    persistence/
    styles/                all CSS that is not feature-local, plus styles.css from the root
    highlight/             messages.ts (was protocol.ts)
    node/                  transport, wsClient, wsChannels, apiClient, hostCapabilities
    queries/               queries.ts, mutations.ts
  features/
    agent/ dashboards/ diff/ editor/ integrations/ notifications/ tabs/ tasks/ workspaces/
    settings/              absorbs configTrust/ and modelProviders/ and AccountMenu.tsx
    projects/              stays, or folds into workspaces/ if still two files
```

Deleted: `packages/client-core/src/kit/components/content/Acorn.tsx` (and its `Acorn` export in
`packages/plugin-api/src/ui/host.ts`). The arch rule "ui/ is pure presentation" becomes "kit/ is pure
presentation": `kit/` may import `kit/` and `infra/highlight`, and nothing else. The four file-level
carve-outs go away because the files that needed them moved to `host/`.

## packages/protocol

```
packages/protocol/src/
  plugin/                  contract, bridge, state, grants, apiVersion (today's plugin*.ts)
  tree/                    unchanged
  (the rest flat)
```

The exports map enumerates modules, so five lines change. The plugin-named baseline
(`browserRules`, `managedAgents`, `terminal`, `notes`, `workflow`) is a shrinking list with its own
rule and is not moved here.

## packages/plugin-api

Bare entrypoint files, one spelling: `node.ts`, `client.ts`, `testkit.ts`, `testkit/client.ts` stays
because the subpath is `./testkit/client`, `ui/*.ts` as today. The exports map changes to match.
