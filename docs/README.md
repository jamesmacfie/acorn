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
| [editor.md](./editor.md) | The host-owned document surface: why the host draws the editor and what it lends. |
| [notifications.md](./notifications.md) | What an agent is doing, which changes are worth interrupting for, and the gate every channel hangs off. |
| [ui-design/appearance.md](./ui-design/appearance.md) | Themes, style packs, and the appearance token axes. |
| [ui-design/closed-kit.md](./ui-design/closed-kit.md) | The closed component kit and its extension rules. |

## Features

| Document | What it holds |
| --- | --- |
| [features.md](./features.md) | The shipped product surfaces, one line each. |
| [workspaces-and-tasks.md](./workspaces-and-tasks.md) | The product model: workspaces, projects, tasks, and worktrees. |
| [managed-agents.md](./managed-agents.md) | Agent sessions acorn drives: the ledger, harnesses, managed delegation, approvals, artifacts, and usage. |
| [managed-agents/client-surfaces.md](./managed-agents/client-surfaces.md) | Agent Center, task panes, transcript storage, and search. |
| [terminal.md](./terminal.md) | The terminal drawer: raw PTY sessions, run targets, and provider profiles. |
| [agent-tools.md](./agent-tools.md) | Agent tool contributions, permissions, the MCP projection, and managed-session orchestration. |
| [dashboards.md](./dashboards.md) | User-composed panels over typed record collections. |
| [integrations.md](./integrations.md) | Connections, providers, the external-item store, and project links. |
| [data-sources.md](./data-sources.md) | Typed source registration, scoped invocation, completeness, and client query caching. |
| [github-integration.md](./github-integration.md) | Pull requests, reviews, checks, the mirror, and the importer. |
| [schedules.md](./schedules.md) | Node-owned periodic work. |
| [schedules/plugin-schedules.md](./schedules/plugin-schedules.md) | How a plugin declares a schedule, overrides, lifecycle, and trust. |
| [schedules/user-schedules.md](./schedules/user-schedules.md) | User schedule targets, consent, workflow schedules, routes, and Settings. |
| [workflows.md](./workflows.md) | Declarative orchestration: runs, gates, budgets, branching, joins, the two stores a definition lives in, the editor that writes one, and the pane a run is watched in. |
| [workflows/execution.md](./workflows/execution.md) | Workflow graph execution, retries, recovery, and child tasks. |
| [workflows/authoring.md](./workflows/authoring.md) | Workflow editor, scheduling, generation, drafts, and publication. |
| [notes-and-memory.md](./notes-and-memory.md) | Task notes, direct memory writes, standing context, and Undo. |
| [http-client.md](./http-client.md) | The HTTP request pane and the outbound-request gap. |
| [docker.md](./docker.md) | The Docker pane and the archive-time teardown. |
| [database.md](./database.md) | The database plugin: the Postgres browser and SQL editor. |
| [mcp.md](./mcp.md) | The MCP server: a stdio child that calls the node over loopback. |

## Plugins

Start with the plugin map, then follow the authoring guide or API reference.

| Document | What it holds |
| --- | --- |
| [plugin-map.md](./plugin-map.md) | **Read this first.** The orientation map: every surface a plugin can reach, one line each, with two worked examples. |
| [extensibility.md](./extensibility.md) | The reasoning: why two tiers, where the line is, and which constraints are deliberate. Read before widening a seam. |
| [plugins.md](./plugins.md) | Topic index for package layout, APIs, lifecycle, UI, and collaboration. |
| [plugin-authoring.md](./plugin-authoring.md) | Third-party authoring guide, manifest reference, and examples. |
| [contribution-kinds.md](./contribution-kinds.md) | The table of every contribution kind and its two carriers. Test-enforced. |
| [first-party-plugins.md](./first-party-plugins.md) | Which first-party plugins have to be, and which are only first-party by history. |
| [loaded-plugin-migration.md](./loaded-plugin-migration.md) | The record of moving plugins out of the binary: what each move cost and what it found. |

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
| [tui/interaction.md](./tui/interaction.md) | Terminal key handling, focus, scrolling, and interaction telemetry. |
| [tui/chrome-and-plugins.md](./tui/chrome-and-plugins.md) | Terminal chrome, loaded plugins, and their host fallbacks. |
| [node-distribution.md](./node-distribution.md) | The standalone node tarball and how it boots without a desktop. |
| [release-notes.md](./release-notes.md) | What is in the current release. |

## Subfolders

- [future/](./future/README.md): designs, analyses, and plans for work that hasn't shipped, plus
  delivery records kept while acceptance is open. Its README indexes every programme and single file,
  including the [documentation overhaul](./future/documentation/README.md). Shipped behavior belongs
  in an owning doc above.
- `schemas/`: generated, versioned JSON Schemas that a test pins and that never change once
  published. The one schema is `docs/schemas/enrollment-v1.json`.

## Documentation ownership

Keep one owning page for each contract. Link to it from other pages instead of copying its details.
Group long references by topic in a subfolder. Keep the original landing page when source comments
or external links depend on its path, and update relative links when moving a section.

Describe implemented behavior in reference pages. Put proposed application changes in
[Future work](./future/README.md), and label dated measurements as historical evidence.
Update this index when adding a page. `tools/arch/docPaths.test.ts` checks file paths and relative
links, and `tools/arch/docCitations.test.ts` checks the source comments that cite a doc. Review the
implementation to verify API signatures and behavior.

## Plugin reference topics

### Plugin contracts

- [Activation](./plugins/activation.md)
- [Client authoring and the UI kit](./plugins/client-authoring-and-the-ui-kit.md)
- [Cooperative extension points](./plugins/cooperative-extension-points.md)
- [Descriptors for facts, trees for UI, rectangles for pixels](./plugins/descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md)
- [Descriptors](./plugins/descriptors.md)
- [Forward compatibility](./plugins/forward-compatibility.md)
- [Frames](./plugins/frames.md)
- [Node-side extension points](./plugins/node-side-extension-points.md)
- [Package shape](./plugins/package-shape.md)

### Authoring guides

- [CLI commands](./plugin-authoring/cli-commands.md)
- [Events and capabilities](./plugin-authoring/events-and-capabilities.md)
- [Installing a hand-written package](./plugin-authoring/installing-a-hand-written-package.md)
- [Start from the scaffold](./plugin-authoring/start-from-the-scaffold.md)
- [The manifest](./plugin-authoring/the-manifest.md)
- [The node half](./plugin-authoring/the-node-half.md)
