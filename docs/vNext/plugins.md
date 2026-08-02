# Plugins

A plugin is one workspace package under `plugins/` that contributes a feature: node routes and
services, client UI, its own database, settings, and events. All plugins are first-party,
compiled into the release, and versioned with the app. There is no runtime installation.

## Package shape

```text
plugins/<name>/
├── package.json           @acorn/plugin-<name>
├── src/
│   ├── node/              node-side: routes, services, jobs, migrations
│   │   └── index.ts       exports the NodePlugin
│   ├── client/            client-side: panes, sources, palettes, settings UI
│   │   └── index.ts       exports the ClientPlugin
│   ├── contract/          the ONLY cross-plugin import surface
│   │   └── index.ts       types + capability/event IDs other plugins may use
│   └── shared/            types shared between this plugin's node and client parts
└── tests/
```

`apps/node` imports every plugin's `node/index.ts`; `apps/desktop` imports every plugin's
`client/index.ts`. Plugins with no node part (pure UI) or no client part (headless) omit that
entrypoint.

## The plugin API

`@acorn/plugin-api` defines two interfaces. They are deliberately close to what V1's registries
already do — this is a formalization, not an invention.

```ts
interface NodePlugin {
  name: string;                                // "github"
  required?: boolean;                          // github, terminal, agents
  migrations?: MigrationSet;                   // for this plugin's own sqlite
  init(ctx: NodePluginContext): Promise<void>; // register everything
}

interface NodePluginContext {
  db: PluginDatabase;              // this plugin's sqlite, already migrated
  routes: RouteRegistry;           // mount under /v2/p/<name>/
  events: EventBus;                // publish `<name>.*` events; subscribe to others
  capabilities: CapabilityRegistry;// export/consume typed cross-plugin functions
  tools: AgentToolRegistry;        // contribute agent tools (see below)
  core: CoreServices;              // process broker, git, files, secrets, http, scheduler, blobs, config-trust
  settings: SettingsAccessor;      // read node/workspace/repo/task-scoped settings
  log: Logger;
}

interface ClientPlugin {
  name: string;
  init(ctx: ClientPluginContext): void;        // register contributions
}

interface ClientPluginContext {
  panes: PaneRegistry;             // task panes: id, order, chord, min width, component
  sources: SourceRegistry;         // rail sources (fleet-aware: single- or multi-node)
  palette: PaletteRegistry;        // commands + palette rows
  settingsPages: SettingsRegistry;
  contextSections: ContextSectionRegistry; // for the context plugin's projection
  slots: SlotRegistry;             // render a component into a named slot another
                                   //   plugin (or the shell) hosts — slot IDs are
                                   //   exported from the host's contract/ (or client-core
                                   //   for shell slots: topbar, notice bell, overlays)
  attention: AttentionRegistry;    // contribute items to the attention inbox
  api: NodeApiClient;              // typed fetch/WS to a given nodeId (via the broker)
  events: ClientEventBus;          // node events, already demultiplexed per node
  desktop: DesktopServices;        // client-core services wrapping Electron capabilities
                                   //   (browser-view host for preview, dialogs, clipboard)
}
```

Slots are how client-to-client collaboration works without imports: the host renders whatever
was registered under its slot ID (linear registers a panel into github's PR-detail slot; agents
and workflows register into the task activity slot; terminal registers the topbar drawer toggle).

Plugins never import Electron. Plugin code that needs native capability (preview's
`WebContentsView` host, dialogs) consumes a `DesktopServices` API implemented in
`@acorn/client-core` — the only place outside `apps/desktop` that touches Electron.

## Agent tools and MCP

V1's `AgentToolContribution` registry carries over as `tools` above: a plugin declares named,
schema-validated, risk-tiered tools (notes read/append, memory search/propose, preview browser
driving, terminal send). Core projects the registry three ways, as in V1:

1. an **MCP server** per agent process (stdio), which proxies calls to the Node over `/v2` using
   that session's internal token;
2. HTTP routes for managed-agent harnesses; and
3. the renderer's tool-permission UI (the `agent-tools` and `mcp` settings pages keep parity).

Tool authorization = the session's internal-token scope ∩ the user's per-tool permission prefs.

Contribution rules carried over from V1: panes keep their IDs, order numbers, and chords (see
ui.md); unknown persisted pane IDs render as placeholders; registration happens only in the two
composition roots — a plugin that isn't registered there doesn't exist.

## Cross-plugin collaboration

Three mechanisms, all typed, all optional-by-default:

1. **Capabilities** — a plugin exports named typed functions on the node
   (`agents.sessionExecute`, `terminal.runTargets`, `linear.detectReferences`,
   `modelProviders.generate`). Consumers declare them optional and degrade when absent (plugin
   disabled). Signatures live in the provider's `contract/` entrypoint.
2. **Events** — plugins subscribe to each other's events by type string
   (`agents.session.completed` → memory's review hook).
3. **Contract imports** — client components may import another plugin's `contract/` entrypoint
   for types and IDs, never its `client/` or `node/` internals.

The known V1 couplings and their resolutions:

| V1 edge | vNext resolution |
| --- | --- |
| App.tsx imports GitHub views, onboarding modal, terminal panel | shell renders registered contributions only |
| TaskView imports terminal run/terminal clients | terminal contributes the drawer + run integration via slots/capabilities |
| Palette imports agents workflow client + terminal recipes | palette rows contributed by each plugin |
| Notes pane imports context model | context exports its types in contract/; notes contributes a section |
| Changes → GitHub diff components | diff viewer moves to `@acorn/client-core` (shared UI), both consume it |
| Database → editor Monaco setup | Monaco/editor kit moves to `@acorn/client-core` |
| Context → Memory UI + Notes client | notes/memory export context sections + capabilities |
| Memory → Notes store (knowledge bridge) | notes owns its storage; memory consumes `notes.read` capability |
| GitHub → Linear panel/scan | linear exports `detectReferences` + a PR-panel contribution; github hosts a generic slot |
| Preview → Terminal run targets | terminal exports `runTargets` capability |
| Workflows settings → Agents client | workflows owns its UI; consumes `agents.sessionExecute` |
| Agents sidebar → Terminal | terminal exports session-roster capability + handoff |

Shared **UI kit** (diff viewer, Monaco setup, data grid, markdown, xterm wrapper, form/wizard
primitives) lives in `@acorn/client-core`. Sharing rendering code is good; sharing feature
internals is what's banned.

## Required plugins

`github`, `terminal`, `agents` are `required: true`: they cannot be disabled, and core assumes
their capabilities exist. Everything else can be toggled off in Settings → Plugins; disabling
unregisters contributions at next startup and leaves data in place. That's the entire lifecycle:
enabled or disabled, per node, one boolean. No install/update/quarantine state machines.

## Boundary enforcement

A single boundary test (evolution of V1's `boundaries.test.ts`) asserts over the import graph:

1. only `apps/`, `packages/`, `plugins/` contain workspace packages;
2. no plugin imports another plugin outside `*/contract`;
3. no plugin imports from `apps/*`;
4. `apps/desktop` doesn't import `apps/node` and vice versa;
5. nothing imports Electron outside `apps/desktop` (and `@acorn/client-core`'s explicitly
   Electron-facing modules);
6. `@acorn/protocol` imports nothing but Zod.

The V1 ledger of grandfathered violations starts at zero in vNext — new violations fail CI, no
baseline.

## Testing a plugin

- **Node side**: vitest against a real temp-dir data root — plugin DB, real core services with
  fakes only at true externals (GitHub API, provider CLIs, Docker daemon). V1's pattern.
- **Client side**: contribution registration is testable in node; rendered UI is covered by the
  desktop e2e (Playwright) suite, since vitest can't render Solid components (V1 gotcha, still
  true).
- **Contract**: Zod schemas in `@acorn/protocol` + `contract/` exports are exercised by both
  sides' tests by construction — there is no drift for a schema both sides import.
