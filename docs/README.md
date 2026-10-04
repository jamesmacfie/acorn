# Documentation

This page lists every document under `docs/`, grouped by purpose. Nothing else indexes them, so add a
new file here in the same commit that creates it.

## Start here

Read these pages in order:

1. [Architecture overview](./architecture-overview.md): the runtimes, who owns what, and which doc
   owns each contract.
2. [Features](./features.md): what the product does, so the rest has something to hang on.
3. [Frontend](./frontend.md) or [API reference](./api-reference.md), whichever side you're about to
   change.
4. [Conventions](./conventions.md): where a file goes and what to call it.
5. [Write and maintain docs](./writing-docs.md), before you add, move, or cite a doc.

If your first task is a plugin, read the [plugin map](./plugin-map.md) instead of step 3. It covers
the whole plugin system in one page.

## Architecture and contracts

| Document | What it holds |
| --- | --- |
| [architecture-overview.md](./architecture-overview.md) | Runtime topology, process ownership, the product model, and which doc owns each contract. Read it first. |
| [architecture/packages.md](./architecture/packages.md) | Package boundaries: what each package may import and publish, and how the rules are enforced. |
| [architecture/node-api.md](./architecture/node-api.md) | Route families, the platform seam, and wire validation. |
| [architecture/fleet.md](./architecture/fleet.md) | Client state, connection states, fan-out, deadlines, and the Fleet view. |
| [architecture/control-plane.md](./architecture/control-plane.md) | The three parties, and what a control plane may hold. |
| [conventions.md](./conventions.md) | The naming rules: files, folders, exports, state, contributions, packages. |
| [api-reference.md](./api-reference.md) | The map of the `/v1` API and which page owns each route, header, and frame. |
| [api-reference/transport.md](./api-reference/transport.md) | Namespaces, the broker deadline, pairing, protocol versioning, request processing, idempotency, and the error envelope. |
| [api-reference/core-routes.md](./api-reference/core-routes.md) | Every `/v1/core` route with its gate. |
| [api-reference/plugin-routes.md](./api-reference/plugin-routes.md) | Each first-party plugin's route families, and the GitHub and Changes diff contracts. |
| [api-reference/workflow-routes.md](./api-reference/workflow-routes.md) | The workflows plugin's run, processing history, definition, and schedule binding routes. |
| [api-reference/websocket.md](./api-reference/websocket.md) | `/v1/events`, logical viewers, the preview tunnel, and the Node event channels. |
| [data-layer.md](./data-layer.md) | The map of Node storage, and the ownership rules for provider data, identity, and blobs. |
| [data-layer/data-root.md](./data-layer/data-root.md) | The data root's location, contents, `node.json`, and how it opens. |
| [data-layer/core-database.md](./data-layer/core-database.md) | Core tables, the external-item read model, the merged run list, and task script history. |
| [data-layer/plugin-databases.md](./data-layer/plugin-databases.md) | Each plugin's SQLite file, opening a handle, cross-database ledgers, and the GitHub mirror. |
| [data-layer/migrations.md](./data-layer/migrations.md) | Generating migrations, chain locations, the applied-history check, and loaded plugin storage. |
| [data-layer/backup-and-retention.md](./data-layer/backup-and-retention.md) | Backup archives and restore, retention, `VACUUM`, and the storage report. |
| [data-layer/typed-data.md](./data-layer/typed-data.md) | The shared typed-value contract, and data sources as projections. |
| [state-ownership.md](./state-ownership.md) | Which state the node owns, which the device owns, and what is disposable. |
| [state-ownership/scope-rules.md](./state-ownership/scope-rules.md) | Where client state is stored: the scope table, the three mechanisms, eviction, and drafts. |
| [state-ownership/reading-places.md](./state-ownership/reading-places.md) | List, timeline, and diff reading places, heights, and parsed rows. |
| [caching.md](./caching.md) | The client cache, its keys, and the serve-then-revalidate policy. |
| [authentication.md](./authentication.md) | Device pairing, tokens, principals, and the internal-call scopes. |
| [security.md](./security.md) | The trust boundaries, what is out of scope, and which page owns each control. |
| [security/transport-and-auth.md](./security/transport-and-auth.md) | TLS and pins, broker limits, the auth gates, mount coverage, task scope, and the WebSocket hub. |
| [security/credentials.md](./security/credentials.md) | Provider credentials, `SecretService.use`, child environments, and internal token scopes. |
| [security/process-and-paths.md](./security/process-and-paths.md) | Path confinement, the process broker, config trust, workflow authority, and force push. |
| [security/control-plane.md](./security/control-plane.md) | What enrollment and node providers cost, and what bounds it. |
| [security/renderer.md](./security/renderer.md) | The renderer CSP, the HTML and markdown sinks, and untrusted provider and authoring input. |
| [security/webviews.md](./security/webviews.md) | Host-owned webviews, the preview pane's remote refusal, and agent browser tools. |
| [security/audit.md](./security/audit.md) | The audit trail, plugin audit verbs, on-disk permissions, and backups. |
| [node-enrollment.md](./node-enrollment.md) | How a provisioned node introduces itself to a control plane, and the versioned protocol it speaks. |
| [security/node-plugin-security.md](./security/node-plugin-security.md) | The owner of plugin security: the threat model, the containment ladder, and the summary table. |
| [security/plugin-bundles.md](./security/plugin-bundles.md) | Hash-bound consent for client bundles, custody, and the threats it closes. |
| [security/plugin-install.md](./security/plugin-install.md) | The install route, agent install requests, folder installs, and development mode. |
| [security/plugin-client-sandbox.md](./security/plugin-client-sandbox.md) | Rung 0: the iframe, tree worker, and terminal worker sandboxes. |
| [security/plugin-node-realm.md](./security/plugin-node-realm.md) | Rungs 1 to 3: the permission-shaped context, the isolated worker realm, and OS sandboxing. |
| [security/plugin-secrets-and-routes.md](./security/plugin-secrets-and-routes.md) | How plugins borrow credentials, task-token reach, and agent tool rules. |
| [security/plugin-storage-and-supply-chain.md](./security/plugin-storage-and-supply-chain.md) | Plugin SQLite policy, install integrity, and the boundary design rules. |
| [security/review-2026-10-01.md](./security/review-2026-10-01.md) | Ten-area security review, completed remediation ledger, verification evidence, and remaining limits. |

## The renderer

| Document | What it holds |
| --- | --- |
| [frontend.md](./frontend.md) | Renderer composition, the package layout, and how the shell is put together. |
| [ui-design.md](./ui-design.md) | The closed component kit, the appearance axes, and the design tokens. |
| [panes.md](./panes.md) | The layout model and the pane vocabulary. |
| [native-overlays.md](./native-overlays.md) | Native composition, input routing, presentation authority, supported platforms, and degraded behavior. |
| [command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) | The palette, the keymap, focus, and typing. |
| [diff-rendering.md](./diff-rendering.md) | The diff document and its segments, row geometry, the resident segment cache, find, and what large-surface rendering refuses. |
| [editor.md](./editor.md) | The host-owned editor: the shared surface, what it lends to plugins, and its limits. |
| [notifications.md](./notifications.md) | What an agent is doing, which changes are worth interrupting for, and the gate every channel hangs off. |

## Features

| Document | What it holds |
| --- | --- |
| [features.md](./features.md) | The shipped product surfaces, one line each. |
| [workspaces-and-tasks.md](./workspaces-and-tasks.md) | The product model: workspaces, projects, tasks, and worktrees. |
| [managed-agents.md](./managed-agents.md) | Agent sessions acorn drives: the ledger, harnesses, managed delegation, approvals, artifacts, and usage. |
| [terminal.md](./terminal.md) | The terminal drawer: raw PTY sessions, run targets, and provider profiles. |
| [agent-tools.md](./agent-tools.md) | Agent tool contributions, permissions, the MCP projection, and managed-session orchestration. |
| [dashboards.md](./dashboards.md) | Published dashboard panels over typed data sources, placements, datasets, coverage, and measure history. |
| [Panel studio](./future/dashboards/README.md) | Proposed redesign of how dashboard panels are created, edited, and previewed, plus derived sources that let plugins build panel data from other sources with their own logic. Twelve phases. |
| [integrations.md](./integrations.md) | Connections, providers, the external-item store, and project links. |
| [data-sources.md](./data-sources.md) | Typed source registration, scoped invocation, completeness, and client query caching. |
| [github-integration.md](./github-integration.md) | Pull requests, reviews, checks, the mirror, and the importer. |
| [schedules.md](./schedules.md) | Node-owned periodic work. |
| [schedules/plugin-schedules.md](./schedules/plugin-schedules.md) | How a plugin declares a schedule, overrides, lifecycle, and trust. |
| [schedules/user-schedules.md](./schedules/user-schedules.md) | User schedule targets, consent, workflow schedules, routes, and Settings. |
| [workflows.md](./workflows.md) | Declarative orchestration: runs, gates, budgets, branching, joins, the two stores a definition lives in, the editor that writes one, and the pane a run is watched in. |
| [notes-and-memory.md](./notes-and-memory.md) | Task notes, direct memory writes, standing context, and Undo. |
| [http-client.md](./http-client.md) | The HTTP request pane, sending, and the workflow step. |
| [docker.md](./docker.md) | The Docker pane and the archive-time teardown. |
| [database.md](./database.md) | The database plugin: the Postgres browser and SQL editor. |
| [mcp.md](./mcp.md) | The MCP server: a stdio child that calls the node over loopback. |

## Plugins

Start with the plugin map, then follow the authoring guide or API reference.

| Document | What it holds |
| --- | --- |
| [plugin-map.md](./plugin-map.md) | **Read this first.** The orientation map: every surface a plugin can reach, one line each, with two worked examples. |
| [extensibility.md](./extensibility.md) | The reasoning: why two tiers, where the line is, and which constraints are deliberate. Read before widening a seam. |
| [plugins.md](./plugins.md) | The plugin reference: package layout, the API, lifecycle, UI, extension points, and collaboration. |
| [plugin-authoring.md](./plugin-authoring.md) | Third-party authoring guide, manifest reference, and examples. |
| [contribution-kinds.md](./contribution-kinds.md) | The table of every contribution kind and its two carriers. Test-enforced. |
| [first-party-plugins.md](./first-party-plugins.md) | Which compiled plugins have to be first-party, and the reason for each. |
| [loaded-plugin-migration.md](./loaded-plugin-migration.md) | A pointer only. The migration record was deleted on October 4, 2026, and lives in Git history. Its open items are in [the compiled tier](./future/compiled-tier.md). |

## Building, running, shipping

| Document | What it holds |
| --- | --- |
| [local-development.md](./local-development.md) | Getting the app running, the dev loops, the environment, and the database commands. |
| [local-development/agent-drivers.md](./local-development/agent-drivers.md) | Driving an isolated desktop window or terminal client, native control, and the large-surface flow. |
| [local-development/profiling.md](./local-development/profiling.md) | Timing a cold start and a task switch. |
| [testing.md](./testing.md) | The way into the tests: the commands, focused runs, and the topic pages. |
| [testing/commands.md](./testing/commands.md) | Every test command, concurrency limits, caching, timeouts, and coverage measurement. |
| [testing/layers.md](./testing/layers.md) | What each runtime's suites cover, composition-root tests, and the testkit. |
| [testing/architecture-rules.md](./testing/architecture-rules.md) | Source-shape rules, kit invariants, loadability, the doc checks, and non-vacuity. |
| [testing/desktop.md](./testing/desktop.md) | The desktop boot test, Rust unit tests, browser smoke test, and the large-surface fixture. |
| [testing/ci.md](./testing/ci.md) | What CI runs, the Turborepo cache, build checks, and reading a red run. |
| [testing/smoke-checklist.md](./testing/smoke-checklist.md) | The alpha release pass, the index of feature checks, and known gaps. |
| [testing/settings.md](./testing/settings.md) | Settings window, custom agent, and MCP server checks. |
| [testing/computer-use.md](./testing/computer-use.md) | Computer Use app-access approval checks. |
| [testing/memory.md](./testing/memory.md) | Memory page, agent write, import, and open usage checks. |
| [testing/manual-checks.md](./testing/manual-checks.md) | Index of numbered, feature-specific manual acceptance checks. |
| [testing/preview-retention.md](./testing/preview-retention.md) | Native preview retention acceptance, process measurements, and platform recovery limits. |
| [testing/desktop-and-plugins.md](./testing/desktop-and-plugins.md) | Packaged shell, plugin installation, host webviews, and loaded plugin lifecycle checks. |
| [testing/native-overlays.md](./testing/native-overlays.md) | Native overlay acceptance scenarios, test evidence, performance targets, and outstanding graphical checks. |
| [testing/terminal-and-palette.md](./testing/terminal-and-palette.md) | Terminal keyboard and shared command palette checks. |
| [testing/changes-and-large-surfaces.md](./testing/changes-and-large-surfaces.md) | Changes pane, large diff, transcript, and task restoration checks. |
| [testing/workflows.md](./testing/workflows.md) | Workflow authoring, execution, child runs, schedules, and data-source checks. |
| [testing/agents-and-providers.md](./testing/agents-and-providers.md) | Onboarding, model generation, delegation, and harness checks. |
| [testing/rail-and-annotations.md](./testing/rail-and-annotations.md) | Rail layout, task marker, and appearance checks with dated results. |
| [telemetry.md](./telemetry.md) | The map of telemetry: the record kinds, the switch, and which page owns each seam. |
| [telemetry/model.md](./telemetry/model.md) | The switch, the five kinds, span admission, attributes, privacy, and traces. |
| [telemetry/plugins-and-sinks.md](./telemetry/plugins-and-sinks.md) | Writing telemetry from a plugin or frame, writing a sink, and the Sentry sink. |
| [telemetry/runtimes.md](./telemetry/runtimes.md) | The collector, ambient attribution, Node seams, and the terminal client, helper, and shell. |
| [telemetry/renderer.md](./telemetry/renderer.md) | The renderer emitter, one trace per interaction, and every renderer seam. |
| [telemetry/logging.md](./telemetry/logging.md) | The two loggers and the `console.*` rule. |
| [telemetry/surface-health.md](./telemetry/surface-health.md) | The numbers a large diff or timeline keeps about itself. |
| [telemetry/diagnosis.md](./telemetry/diagnosis.md) | What Settings → Telemetry shows, diagnosing an unresponsive view, and memory over a day. |
| [shell.md](./shell.md) | The Tauri shell: schemes, custody, webviews, the helper, and packaging. |
| [tui.md](./tui.md) | The terminal client: `acorn` in a terminal, its process model, its host switch, how it draws a frame, and its chrome. |
| [cli.md](./cli.md) | Headless `acorn` commands, Node selection, read resources, output, and exit codes. |
| [cli/workspaces-projects-tasks.md](./cli/workspaces-projects-tasks.md) | CLI core writes, retries, stdin piping, and task script reads. |
| [cli/agents-and-workflows.md](./cli/agents-and-workflows.md) | CLI agent sessions, workflow runs, and the run list. |
| [cli/plugin-commands.md](./cli/plugin-commands.md) | Discovering and running a plugin's CLI commands. |
| [cli/local-service.md](./cli/local-service.md) | The CLI-owned background Node: start, status, and stop. |
| [node-distribution.md](./node-distribution.md) | The standalone node tarball and how it boots without a desktop. |
| [release-notes.md](./release-notes.md) | What is in the current release. |

## Renderer, shell, and terminal topic pages

Each landing page in the tables above has topic pages in a folder of the same name:

- [frontend.md](./frontend.md): [Data and startup](./frontend/data-and-startup.md),
  [Rail and routing](./frontend/rail-and-routing.md),
  [Registries and plugins](./frontend/registries.md),
  [Settings groups](./frontend/settings-groups.md), [Settings pages](./frontend/settings-pages.md),
  [Settings](./frontend/settings.md), [Shell state](./frontend/shell-state.md),
  [Startup budget](./frontend/startup-budget.md).
- [ui-design.md](./ui-design.md): [UI appearance](./ui-design/appearance.md),
  [The closed UI kit](./ui-design/closed-kit.md),
  [Every node at 80 by 24](./ui-design/every-node.md), [Icons](./ui-design/icons.md),
  [Interaction rules and menus](./ui-design/interaction.md),
  [How the kit is built](./ui-design/kit-internals.md), [Chrome, overlays,
  and dialogs](./ui-design/overlays.md), [Shell hierarchy](./ui-design/shell-hierarchy.md),
  [States and accessibility](./ui-design/states.md), [Design tokens](./ui-design/tokens.md),
  [Tooltips](./ui-design/tooltips.md), [Two-column panes](./ui-design/two-column-panes.md).
- [panes.md](./panes.md): [Pane contributions](./panes/contributions.md),
  [Pane layouts](./panes/layout.md), [Pane models](./panes/models.md),
  [Pane regions](./panes/regions.md).
- [command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md): [Palette commands](./command-palette-and-shortcuts/commands.md),
  [Focus and typing](./command-palette-and-shortcuts/focus-and-typing.md),
  [Palette data](./command-palette-and-shortcuts/palette-data.md),
  [The palette session](./command-palette-and-shortcuts/palette.md),
  [Shortcuts](./command-palette-and-shortcuts/shortcuts.md).
- [diff-rendering.md](./diff-rendering.md): [The Changes pane](./diff-rendering/changes-pane.md),
  [The diff document](./diff-rendering/document.md),
  [Diff row geometry and modes](./diff-rendering/geometry.md),
  [Diff loading and highlighting](./diff-rendering/loading.md),
  [Diff review threads and marks](./diff-rendering/review.md).
- [editor.md](./editor.md): [Composed panes](./editor/composed-panes.md),
  [The document surface](./editor/document-surface.md), [The editor pane](./editor/editor-pane.md),
  [Find in files](./editor/find-in-files.md), [Line markers](./editor/line-markers.md),
  [Saving and recovery](./editor/save-and-recovery.md).
- [notifications.md](./notifications.md): [Notification channels and settings](./notifications/channels.md),
  [The notification gate](./notifications/gate.md),
  [Notification rows and targets](./notifications/rows-and-targets.md),
  [Notification states and edges](./notifications/states-and-edges.md).
- [shell.md](./shell.md): [The renderer bridge and the connection broker](./shell/bridge-and-broker.md),
  [The Node child and shell telemetry](./shell/node-child.md),
  [Origins and schemes](./shell/origins.md), [Build and packaging](./shell/packaging.md),
  [The shell process](./shell/process.md), [Host-owned webviews](./shell/webviews.md).
- [tui.md](./tui.md): [Terminal chrome](./tui/chrome.md), [Terminal focus](./tui/focus.md),
  [Terminal footer and key trace](./tui/footer.md), [Terminal host switch](./tui/host-switch.md),
  [Terminal keys](./tui/keys.md), [Terminal navigation](./tui/navigation.md),
  [What a plugin loses in the terminal](./tui/plugin-losses.md),
  [Terminal loaded plugins](./tui/plugins.md), [Terminal client process](./tui/process.md),
  [Terminal rectangles and limits](./tui/rectangles.md), [Terminal rendering](./tui/rendering.md),
  [Terminal reporting and invariants](./tui/reporting.md),
  [Terminal collections and scrolling](./tui/scrolling.md),
  [Terminal sources and settings](./tui/sources-and-settings.md),
  [Terminal client tests](./tui/tests.md), [Terminal dialogs and rectangles](./tui/traps.md),
  [Terminal typing](./tui/typing.md).

## Feature topic pages

Each feature landing page above has topic pages in a folder of the same name:

- [workspaces-and-tasks.md](./workspaces-and-tasks.md): [Archive and
  restore](./workspaces-and-tasks/archive.md), [Project
  configuration](./workspaces-and-tasks/project-config.md), [Projects and
  workspaces](./workspaces-and-tasks/projects.md), [Task creation and
  navigation](./workspaces-and-tasks/task-creation.md), [Task script
  results](./workspaces-and-tasks/task-scripts.md), [Worktrees and
  setup](./workspaces-and-tasks/worktrees.md).
- [managed-agents.md](./managed-agents.md): [Web activity and file
  changes](./managed-agents/activity.md), [App-access approval](./managed-agents/app-access.md),
  [Context, files, and attachments](./managed-agents/attachments.md), [Client
  surfaces](./managed-agents/client-surfaces.md), [The composer](./managed-agents/composer.md),
  [Custom agents](./managed-agents/custom-agents.md), [New-session
  defaults](./managed-agents/defaults.md), [Managed delegation](./managed-agents/delegation.md),
  [Harnesses](./managed-agents/harnesses.md), [Archived agent
  history](./managed-agents/history-retention.md), [Operations](./managed-agents/operations.md),
  [From the command palette](./managed-agents/palette.md), [Providers and plan
  usage](./managed-agents/providers.md), [Session events and
  waits](./managed-agents/session-events.md), [Sessions](./managed-agents/sessions.md),
  [Subagents](./managed-agents/subagents.md), [Transcript
  search](./managed-agents/transcript-search.md), [The transcript
  store](./managed-agents/transcript-store.md), [The transcript](./managed-agents/transcript.md).
- [terminal.md](./terminal.md): [Activity and delivery](./terminal/activity.md), [The terminal
  drawer](./terminal/client.md), [Run targets](./terminal/run-targets.md), [Terminal
  sessions](./terminal/sessions.md).
- [agent-tools.md](./agent-tools.md): [Browser and task script
  tools](./agent-tools/browser-and-scripts.md), [Context
  sections](./agent-tools/context-sections.md), [Loaded tools and context
  sections](./agent-tools/loaded-tools.md), [Managed-session
  orchestration](./agent-tools/orchestration.md), [Plugin tools](./agent-tools/plugin-tools.md),
  [Tracker and GitHub tools](./agent-tools/tracker-tools.md).
- [dashboards.md](./dashboards.md): [Mapping and the editor](./dashboards/mapping-and-editor.md),
  [Panels](./dashboards/panels.md), [Placements](./dashboards/placements.md), [Sampling and
  retention](./dashboards/sampling.md), [Views and trends](./dashboards/views.md).
- [integrations.md](./integrations.md): [Connection and integration
  contributions](./integrations/contributions.md), [Linear](./integrations/linear.md), [Model
  providers](./integrations/model-providers.md), [Project
  sources](./integrations/project-sources.md), [Provider
  boundaries](./integrations/provider-boundaries.md), [Rollbar](./integrations/rollbar.md),
  [Sentry](./integrations/sentry.md), [Connection settings](./integrations/settings.md).
- [data-sources.md](./data-sources.md): [Data source authoring
  controls](./data-sources/authoring-controls.md), [Provider data
  sources](./data-sources/provider-sources.md), [Workspace query
  library](./data-sources/query-library.md).
- [github-integration.md](./github-integration.md): [The GitHub
  mirror](./github-integration/mirror.md), [GitHub from the command
  palette](./github-integration/palette.md), [Reads and
  writes](./github-integration/reads-and-writes.md), [GitHub
  surfaces](./github-integration/surfaces.md), [Tasks and
  references](./github-integration/tasks-and-references.md).
- [workflows.md](./workflows.md): [Agent steps](./workflows/agent-steps.md), [AI
  authoring](./workflows/ai-authoring.md), [Workflow authoring](./workflows/authoring.md), [Running
  child workflows](./workflows/child-runs.md), [Workflow definitions](./workflows/definitions.md),
  [Editor details](./workflows/editor-details.md), [Workflow execution](./workflows/execution.md),
  [File drafts and portable export](./workflows/file-drafts.md), [Record processing
  history](./workflows/record-history.md), [What workflows refuses](./workflows/refusals.md),
  [Workflow routes and UI](./workflows/routes-and-ui.md), [Scheduled
  roots](./workflows/scheduled-roots.md), [Starting runs](./workflows/starting-runs.md),
  [Contributed step kinds](./workflows/step-kinds.md), [Typed data and
  conditions](./workflows/typed-data.md).
- [notes-and-memory.md](./notes-and-memory.md): [The Memory
  page](./notes-and-memory/memory-page.md).
- [http-client.md](./http-client.md): [HTTP client surfaces](./http-client/client.md).
- [database.md](./database.md): [Database commands and workflow
  steps](./database/palette-and-workflows.md), [The database pane](./database/pane.md).

## Subfolders

- [future/](./future/README.md): designs, analyses, and plans for work that hasn't shipped, plus
  delivery records kept while acceptance is open. Its README indexes every programme and single file,
  including the [documentation overhaul](./future/documentation/README.md) and
  [maintainability and dependency programme](./future/trim/README.md). Shipped behavior belongs
  in an owning doc above.
- `schemas/`: generated, versioned JSON Schemas that a test pins and that never change once
  published. The one schema is `docs/schemas/enrollment-v1.json`.

## Documentation ownership

Keep one owning page for each contract, and add every new page to this index in the same commit.
[Write and maintain docs](./writing-docs.md) covers where a doc goes, the house style, how to split a
long page, how to cite a doc from code, and the checks that enforce it.

## Plugin topic pages

Each plugin landing page above has topic pages in a folder of the same name:

- [plugins.md](./plugins.md): [Activation](./plugins/activation.md), [Adding a plugin
  contribution](./plugins/adding-a-contribution.md), [Agent installs and development
  mode](./plugins/agent-install.md), [Client authoring and the UI
  kit](./plugins/client-authoring-and-the-ui-kit.md), [The client half of a loaded
  plugin](./plugins/client-half.md), [Collaboration rules](./plugins/collaboration.md), [Commands and
  keybindings](./plugins/commands.md), [Cooperative extension
  points](./plugins/cooperative-extension-points.md), [Data ownership](./plugins/data-ownership.md),
  [Descriptors](./plugins/descriptors.md), [The dev loop](./plugins/dev-loop.md),
  [Distribution](./plugins/distribution.md), [Document surfaces and
  webviews](./plugins/document-surfaces.md), [Events](./plugins/events.md), [Forward
  compatibility](./plugins/forward-compatibility.md), [Frames](./plugins/frames.md), [Keeping a
  descriptor fresh](./plugins/freshness.md), [Harnesses](./plugins/harnesses.md),
  [Hooks](./plugins/hooks.md), [Loaded plugins](./plugins/loaded-plugins.md), [Context menus and rail
  markers](./plugins/menus-and-markers.md), [More descriptors](./plugins/more-descriptors.md), [Node
  providers](./plugins/node-providers.md), [Node-side extension
  points](./plugins/node-side-extension-points.md), [Package shape](./plugins/package-shape.md), [The
  plugin API](./plugins/plugin-api.md), [Published packages](./plugins/publishing.md), [Remote
  points](./plugins/remote-points.md), [Remote trees](./plugins/remote-trees.md), [Replacing a core
  surface](./plugins/replacing-core-surfaces.md), [Rows and
  annotations](./plugins/rows-and-annotations.md), [Search providers](./plugins/search-providers.md),
  [Task checks](./plugins/task-checks.md), [The tree contract](./plugins/tree-contract.md), [Choosing
  how a plugin draws](./plugins/ui-tiers.md).
- [plugin-authoring.md](./plugin-authoring.md): [CLI command
  authoring](./plugin-authoring/cli-commands.md), [A complete
  example](./plugin-authoring/complete-example.md), [Contributions](./plugin-authoring/contributions.md),
  [Custom agents](./plugin-authoring/custom-agents.md), [Events and
  capabilities](./plugin-authoring/events-and-capabilities.md),
  [Extensions](./plugin-authoring/extensions.md), [Harnesses](./plugin-authoring/harnesses.md),
  [Install a hand-written package](./plugin-authoring/installing-a-hand-written-package.md),
  [Permissions](./plugin-authoring/permissions.md), [Settings
  pages](./plugin-authoring/settings-pages.md), [Start from the
  scaffold](./plugin-authoring/start-from-the-scaffold.md), [Storage and
  migrations](./plugin-authoring/storage.md), [Telemetry and logging](./plugin-authoring/telemetry.md),
  [Testing a plugin](./plugin-authoring/testing.md), [The bridge](./plugin-authoring/the-bridge.md),
  [The client half](./plugin-authoring/the-client-half.md), [The
  manifest](./plugin-authoring/the-manifest.md), [The node half](./plugin-authoring/the-node-half.md),
  [UI contributions](./plugin-authoring/ui-contributions.md).
- [extensibility.md](./extensibility.md): [The node half and bundled
  plugins](./extensibility/runtime.md), [UI and cooperation](./extensibility/ui-and-cooperation.md).
- [first-party-plugins.md](./first-party-plugins.md): [Plugins to
  copy](./first-party-plugins/examples.md), [First-party plugins in the
  terminal](./first-party-plugins/terminal.md).
