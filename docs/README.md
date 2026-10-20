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
| [api-reference/transport.md](./api-reference/transport.md) | Namespaces, the broker deadline, pairing, request processing, idempotency, and the error envelope. |
| [api-reference/versioning.md](./api-reference/versioning.md) | The protocol major, the tolerant handshake, mixed builds and their 90-day window, and how a route is removed. |
| [api-reference/core-routes.md](./api-reference/core-routes.md) | Every `/v1/core` route with its gate. |
| [api-reference/plugin-routes.md](./api-reference/plugin-routes.md) | Each first-party plugin's route families, and the GitHub and Changes diff contracts. |
| [api-reference/editor.md](./api-reference/editor.md) | Editor file reads, guarded writes, task-addressed file actions, and mixed-version behavior. |
| [api-reference/workflow-routes.md](./api-reference/workflow-routes.md) | The workflows plugin's run, processing history, definition, and schedule binding routes. |
| [api-reference/websocket.md](./api-reference/websocket.md) | `/v1/events`, logical viewers, and the Node event channels. |
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
| [security/security-diagnostics.md](./security/security-diagnostics.md) | Passive, device-only Node security evidence, scope, and limits. |
| [security/instruction-review.md](./security/instruction-review.md) | Hidden-character checks, changed instruction approval, first-time setup, and blocked-turn recovery. |
| [security/transport-and-auth.md](./security/transport-and-auth.md) | TLS and pins, broker limits, the auth gates, mount coverage, task scope, and the WebSocket hub. |
| [security/credentials.md](./security/credentials.md) | Provider credentials, `SecretService.use`, child environments, and internal token scopes. |
| [security/process-and-paths.md](./security/process-and-paths.md) | Path confinement, the process broker, config trust, workflow authority, and force push. |
| [security/control-plane.md](./security/control-plane.md) | What enrollment and node providers cost, and what bounds it. |
| [security/renderer.md](./security/renderer.md) | The renderer CSP, the HTML and markdown sinks, and untrusted provider and authoring input. |
| [security/webviews.md](./security/webviews.md) | Host-owned webviews, the preview pane's remote refusal, and agent browser tools. |
| [security/secret-publication.md](./security/secret-publication.md) | The local secret detector, the optional publication gate, one-operation allowances, and coverage limits. |
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
| [security/review-2026-10-19.md](./security/review-2026-10-19.md) | Review of agent-built apps: each way a program could reach beyond its plans and host tools, what stops it, and the one open finding. |
| [security/review-2026-10-11.md](./security/review-2026-10-11.md) | Follow-up review: the TOML parser cap, release-build renderer origin, idempotency query strings, plugin route gates, and the dependency audit. |

## The renderer

| Document | What it holds |
| --- | --- |
| [frontend.md](./frontend.md) | Renderer composition, the package layout, and how the shell is put together. |
| [frontend/acorn-links.md](./frontend/acorn-links.md) | External Acorn addresses, Copy link, desktop and terminal behavior, safety, and test recipes. |
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
| [agent-tools.md](./agent-tools.md) | Agent tool contributions, permissions, the MCP projection, managed-session orchestration, and workflow tools. |
| [dashboards.md](./dashboards.md) | Published dashboard panels over typed data sources, placements, datasets, coverage, and measure history. |
| [agent-built-apps.md](./agent-built-apps.md) | Apps an agent builds in a conversation: OpenUI Lang programs over dashboard plans, their files, tools, checks, cards, and what they can reach. |
| [Dashboard followups](./future/dashboards-gaps.md) | Filter diagnostics, AI preview/review controls, and the GitHub branch-source decision after the implemented studio and derived sources. |
| [integrations.md](./integrations.md) | Connections, providers, the external-item store, and project links. |
| [data-sources.md](./data-sources.md) | Typed source registration, scoped invocation, completeness, and client query caching. |
| [github-integration.md](./github-integration.md) | Pull requests, reviews, checks, the mirror, and the importer. |
| [gitlab-integration.md](./gitlab-integration.md) | gitlab.com merge requests, approvals, pipelines, the mirror, and the importer. |
| [bitbucket-integration.md](./bitbucket-integration.md) | Bitbucket Cloud pull requests, API token sign-in, build statuses, the mirror, and the importer. |
| [git-client/worktrees.md](./git-client/worktrees.md) | Git worktree inventory, task ownership, and guarded cleanup in both clients. |
| [git-client/history.md](./git-client/history.md) | Pinned history pages, read-only revision diffs, limits, and routes in both clients. |
| [git-client/stashes.md](./git-client/stashes.md) | Stash browsing and guarded task checkout writes in both clients. |
| [git-client/refs-remotes-settings.md](./git-client/refs-remotes-settings.md) | Guarded refs and remotes, pinned comparison, scoped identity, and Node scheduled fetch. |
| [git-client/operations.md](./git-client/operations.md) | Task merge, rebase, cherry-pick, and revert, with continue, skip, abort, and manual recovery. |
| [git-client/conflicts.md](./git-client/conflicts.md) | Three-way conflict resolution that shares Editor's draft, with stale and unsupported refusals. |
| [git-client/explanations.md](./git-client/explanations.md) | Explicit Git explanations and first-release replacement guidance. |
| [schedules.md](./schedules.md) | Node-owned periodic work. |
| [schedules/plugin-schedules.md](./schedules/plugin-schedules.md) | How a plugin declares a schedule, overrides, lifecycle, and trust. |
| [schedules/user-schedules.md](./schedules/user-schedules.md) | User schedule targets, consent, workflow schedules, routes, and Settings. |
| [workflows.md](./workflows.md) | Declarative orchestration: runs, gates, budgets, branching, joins, the two stores a definition lives in, the editor that writes one, and the pane a run is watched in. |
| [notes-and-memory.md](./notes-and-memory.md) | Task notes, direct memory writes, standing context, and Undo. |
| [http-client.md](./http-client.md) | The HTTP request pane, sending, and the workflow step. |
| [docker.md](./docker.md) | The Docker pane and the archive-time teardown. |
| [database.md](./database.md) | The database plugin: the Postgres browser and SQL editor. |
| [mcp.md](./mcp.md) | The MCP server: a stdio child that calls the node over loopback. |
| [mcp/managed-servers.md](./mcp/managed-servers.md) | Exact npm MCP installation, consent, and live tool catalogue review. |
| [mcp/result-size.md](./mcp/result-size.md) | The 32 KiB cap on agent tool results, the saved full text, and how each harness reads it. |
| [mcp/sign-in.md](./mcp/sign-in.md) | Signing in to a remote MCP server once per Node, the token relay, and the browser's return trip. |

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

## Building, running, shipping

| Document | What it holds |
| --- | --- |
| [local-development.md](./local-development.md) | Getting the app running, the dev loops, the environment, and the database commands. |
| [local-development/agent-drivers.md](./local-development/agent-drivers.md) | Driving an isolated desktop window or terminal client, native control, and the large-surface flow. |
| [local-development/remote-node.md](./local-development/remote-node.md) | Starting a Node in a Linux container and pairing a desktop window to it, for remote Node checks. |
| [local-development/streaming-replay.md](./local-development/streaming-replay.md) | Generated ACP replies, per-process desktop sampling, and alternating renderer comparisons. |
| [local-development/extension-dev-loop.md](./local-development/extension-dev-loop.md) | `pnpm dev:extension`: an isolated browser with the extension loaded and reloading, its native host and Node, and the sidebar driver. |
| [local-development/profiling.md](./local-development/profiling.md) | Timing a cold start and a task switch. |
| [local-development/packaged-stacks.md](./local-development/packaged-stacks.md) | Finding the source line behind a stack from a minified, packaged build. |
| [local-development/formatting.md](./local-development/formatting.md) | The oxfmt formatter, `pnpm format`, the `git blame` ignore file, and carrying a branch across a formatting commit. |
| [site.md](./site.md) | The public site in `apps/site`: running, building, checking, and deploying it, and adding a page. |
| [site/agent-outputs.md](./site/agent-outputs.md) | The public site's search palette, page titles and descriptions, social cards, the Markdown copy of each docs page, `llms.txt`, and the agent guide. |
| [site/built-in-plugins.md](./site/built-in-plugins.md) | The public site's list of the plugins acorn ships, each plugin's facts box, and the test that keeps both whole. |
| [site/design.md](./site/design.md) | How the public site looks: its stylesheet on acorn's tokens, the mark, the light and dark themes, the dark stage that opens and closes a marketing page, components, motion, and the contrast checks. |
| [site/design/fonts.md](./site/design/fonts.md) | The public site's faces: JetBrains Mono and its subsets, Inter for marketing paragraphs and its fallback, and the preloads. |
| [site/design/lighthouse.md](./site/design/lighthouse.md) | The landing page's Lighthouse target, the command that checks it, and its scores. |
| [site/marketing-copy.md](./site/marketing-copy.md) | How the marketing pages read: the landing page's one joke, and the marks of a generated page they leave out. |
| [site/specimens.md](./site/specimens.md) | Specimens on the public site: plugin tree code both hosts draw, the generators that commit and check it, and the scoped stylesheet. |
| [site/plugin-guides.md](./site/plugin-guides.md) | The public site's plugin guides: the example plugins in `examples/plugins/`, the harness that installs and runs them, and how a guide shows their code and pictures. |
| [site/references.md](./site/references.md) | The public site's generated reference pages: command-line help, keyboard shortcuts, configuration files, environment variables, and the published schemas, and the check behind each. |
| [site/releases.md](./site/releases.md) | What the public site reads from GitHub at build time, the download page's release files, and the hand-written changelog and its feed. |
| [site/snapshots.md](./site/snapshots.md) | Shell snapshots on the public site: the invented fixture, the scenes, how the capture drives the running apps, and adding a scene. |
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
| [testing/ui-extension-acceptance-2026-10-10.md](./testing/ui-extension-acceptance-2026-10-10.md) | Dated UI extension acceptance: regression commands, the host matrix, the example's real-host check, and open checks. |
| [testing/terminal-and-palette.md](./testing/terminal-and-palette.md) | Terminal keyboard and shared command palette checks. |
| [testing/changes-and-large-surfaces.md](./testing/changes-and-large-surfaces.md) | Changes tab, large diff, transcript, and task restoration checks. |
| [testing/editor-delivery-2026-10-08.md](./testing/editor-delivery-2026-10-08.md) | Dated Editor implementation and verification notes from the retired six phase plans. |
| [testing/editor-phase06-2026-10-08.md](./testing/editor-phase06-2026-10-08.md) | Dated Editor phase 06 fixture and acceptance evidence. |
| [testing/editor-phase06-follow-up-2026-10-08.md](./testing/editor-phase06-follow-up-2026-10-08.md) | Review fixes, connected desktop/terminal checks, and measured Editor acceptance. |
| [testing/claude-steering-spike-2026-10-13.md](./testing/claude-steering-spike-2026-10-13.md) | Dated check that Claude Code takes a second prompt into its running turn through the ACP adapter. |
| [testing/workflows.md](./testing/workflows.md) | Workflow authoring, execution, child runs, schedules, and data-source checks. |
| [testing/agents-and-providers.md](./testing/agents-and-providers.md) | Onboarding, model generation, delegation, and harness checks. |
| [testing/rail-and-annotations.md](./testing/rail-and-annotations.md) | Rail layout, task marker, and appearance checks with dated results. |
| [testing/performance-baseline-2026-10-09.md](./testing/performance-baseline-2026-10-09.md) | Dated startup timings, startup graph bytes, and installed bytes taken before the October 2026 startup and size work. |
| [testing/streaming-replay-2026-10-13.md](./testing/streaming-replay-2026-10-13.md) | Dated ACP replay check and the missing visible-window baseline. |
| [testing/incremental-markdown-parse-2026-10-13.md](./testing/incremental-markdown-parse-2026-10-13.md) | Dated Markdown parse cost at the end of a 50 KB streamed reply, measured in Node, and the real-window numbers still to take. |
| [testing/session-revisit-2026-10-13.md](./testing/session-revisit-2026-10-13.md) | Dated cost of returning to a long agent session, measured in jsdom, and the real-window numbers still to take. |
| [testing/idle-cost-2026-10-13.md](./testing/idle-cost-2026-10-13.md) | Dated count of the work an idle desktop window asks for, measured in tests, and the real-window idle numbers still to take. |
| [testing/rail-artwork-2026-10-19.md](./testing/rail-artwork-2026-10-19.md) | One desktop check of a plugin's live rail artwork and tooltip words, using the acme-tracker example. |
| [testing/context-references-2026-10-19.md](./testing/context-references-2026-10-19.md) | One check of `#` context references in the desktop and terminal clients, with real Claude Code and Codex sessions. |
| [testing/sentry-baseline-2026-10-13.md](./testing/sentry-baseline-2026-10-13.md) | A day of Sentry telemetry from real use: git calls, session-open timing, agent process and renderer memory, and response sizes. The before numbers for UI performance phases 06 to 10. |
| [testing/ui-performance-open-checks-2026-10-14.md](./testing/ui-performance-open-checks-2026-10-14.md) | The real-window and Sentry checks still to run for all ten UI performance phases. |
| [testing/runtime-packaging-2026-10-09.md](./testing/runtime-packaging-2026-10-09.md) | Dated bytes removed from desktop staging and a standalone install by the October 2026 runtime packaging work. |
| [testing/production-minification-2026-10-09.md](./testing/production-minification-2026-10-09.md) | Dated startup graph bytes, installed bytes, and boot timings from minifying the Node service and loaded plugins. |
| [testing/selective-renderer-loading-2026-10-09.md](./testing/selective-renderer-loading-2026-10-09.md) | Dated renderer and terminal startup graph bytes, roster bytes, and real-app checks from loading renderer implementations on first use. |
| [testing/selective-server-loading-2026-10-09.md](./testing/selective-server-loading-2026-10-09.md) | Dated Node startup graph bytes, the cuts chosen and refused, and real-app route checks from loading server routes and operations on first use. |
| [telemetry.md](./telemetry.md) | The map of telemetry: the record kinds, the switch, and which page owns each seam. |
| [telemetry/model.md](./telemetry/model.md) | The switch, the five kinds, span admission, attributes, privacy, and traces. |
| [telemetry/plugins-and-sinks.md](./telemetry/plugins-and-sinks.md) | Writing telemetry from a plugin or frame, writing a sink, and the Sentry sink. |
| [telemetry/runtimes.md](./telemetry/runtimes.md) | The collector, ambient attribution, Node seams, and the terminal client, helper, and shell. |
| [telemetry/node-boot.md](./telemetry/node-boot.md) | The Node's boot as `node.boot` spans, and when they're sent. |
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
| [cli/browser-host.md](./cli/browser-host.md) | `acorn browser install`, `status`, and `uninstall`: registering the extension's native host. |
| [browser-extension.md](./browser-extension.md) | The Chrome and Firefox extension, its native bridge, the native messaging contract, pairing, and sidebar states. |
| [browser-extension/native-messaging.md](./browser-extension/native-messaging.md) | The frames, operations, and events between the extension's background and its native host, and the frame limits the host enforces. |
| [browser-extension/setup.md](./browser-extension/setup.md) | Installing the extension's development builds and native bridge on macOS, pairing, repair and removal, and every sidebar state with its next step. |
| [browser-extension/navigation.md](./browser-extension/navigation.md) | The extension sidebar's three levels, Home, a task with its tabs, and a conversation, with the top bar, Back, and the strip under the bars. |
| [browser-extension/conversations.md](./browser-extension/conversations.md) | The extension's agent operations, change hints, conversation window, send retries, and browser storage. |
| [browser-extension/transcript.md](./browser-extension/transcript.md) | One conversation in the extension sidebar: the transcript, folded tool calls, the state line with Stop, and the message box's keys. |
| [browser-extension/page-capture.md](./browser-extension/page-capture.md) | The extension's link, selection, and screenshot captures, page access, sending them, and the attachment operations. |
| [browser-extension/element-picker.md](./browser-extension/element-picker.md) | The extension's element picker: asking a task's agent about an element on its page, with the element's cleaned HTML, CSS path, and screenshot, and the checks behind it. |
| [browser-extension/handoffs.md](./browser-extension/handoffs.md) | The task chips plugins put on websites, the extension's handoff card, and the operations that resolve a page and create a linked task. |
| [browser-extension/task-pages.md](./browser-extension/task-pages.md) | How the extension matches a page to its task in the browser from the `tasks.pages` list, and the four states of Home's This page section. |
| [browser-extension/project-sites.md](./browser-extension/project-sites.md) | Web addresses tied to a project on the Node, the extension's project suggestions and overrides, and the site operations. |
| [browser-extension/notifications.md](./browser-extension/notifications.md) | The extension's toolbar badge, waiting list, and opt-in OS notifications for requests agents are waiting on, and the `requests.pending` operation. |
| [node-distribution.md](./node-distribution.md) | The standalone node tarball, the self-contained platform archives, and how a Node boots without a desktop. |
| [node-distribution/dependency-security.md](./node-distribution/dependency-security.md) | How the standalone Node's runtime dependencies are pinned, audited, and locked. |
| [node-distribution/install.md](./node-distribution/install.md) | The archive installers, where they put the Node, starting it at login with `acorn node service`, upgrades, and removal. |
| [node-distribution/keep-awake.md](./node-distribution/keep-awake.md) | How a Node keeps its computer awake while agents work or workflows run, the inhibitor on each platform, and the setting. |
| [node-distribution/reaching.md](./node-distribution/reaching.md) | How a person chooses the addresses a Node answers other machines on, and why the port stays fixed. |
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
- [agent-built-apps.md](./agent-built-apps.md): [Project apps](./agent-built-apps/project-apps.md).
- [panes.md](./panes.md): [Pane contributions](./panes/contributions.md),
  [Pane layouts](./panes/layout.md), [Pane models](./panes/models.md),
  [Pane regions](./panes/regions.md).
- [command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md): [Palette commands](./command-palette-and-shortcuts/commands.md),
  [Focus and typing](./command-palette-and-shortcuts/focus-and-typing.md),
  [Palette data](./command-palette-and-shortcuts/palette-data.md),
  [The palette session](./command-palette-and-shortcuts/palette.md),
  [Shortcuts](./command-palette-and-shortcuts/shortcuts.md).
- [diff-rendering.md](./diff-rendering.md): [The Changes tab](./diff-rendering/changes-pane.md),
  [The diff document](./diff-rendering/document.md),
  [Diff row geometry and modes](./diff-rendering/geometry.md),
  [Diff loading and highlighting](./diff-rendering/loading.md),
  [Diff review threads and marks](./diff-rendering/review.md).
- [editor.md](./editor.md): [Composed panes](./editor/composed-panes.md),
  [The document surface](./editor/document-surface.md), [The editor pane](./editor/editor-pane.md),
  [File annotations](./editor/file-annotations.md), [File navigation](./editor/file-navigation.md),
  [Editing controls](./editor/editing-controls.md),
  [File renderers](./editor/file-renderers.md),
  [Find in files](./editor/find-in-files.md), [Line annotations](./editor/line-annotations.md),
  [Line markers](./editor/line-markers.md),
  [Saving and recovery](./editor/save-and-recovery.md).
- [notifications.md](./notifications.md): [Notification channels and settings](./notifications/channels.md),
  [The notification gate](./notifications/gate.md),
  [Notification rows and targets](./notifications/rows-and-targets.md),
  [Notification states and edges](./notifications/states-and-edges.md).
- [shell.md](./shell.md): [The renderer bridge and the connection broker](./shell/bridge-and-broker.md),
  [The Node child and shell telemetry](./shell/node-child.md),
  [Origins and schemes](./shell/origins.md), [Build and packaging](./shell/packaging.md),
  [The shell process](./shell/process.md), [Test installers](./shell/test-installers.md),
  [Host-owned webviews](./shell/webviews.md).
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
  setup](./workspaces-and-tasks/worktrees.md), [Workspace
  icons](./workspaces-and-tasks/workspace-icons.md).
- [managed-agents.md](./managed-agents.md): [Web activity and file
  changes](./managed-agents/activity.md), [Harness accounts](./managed-agents/accounts.md), [App-access approval](./managed-agents/app-access.md),
  [Context, files, and attachments](./managed-agents/attachments.md), [Background
  commands](./managed-agents/background-commands.md), [Client
  surfaces](./managed-agents/client-surfaces.md), [The composer](./managed-agents/composer.md),
  [Custom agents](./managed-agents/custom-agents.md), [New-session
  defaults](./managed-agents/defaults.md), [Managed delegation](./managed-agents/delegation.md),
  [Harnesses](./managed-agents/harnesses.md), [Harness bridges](./managed-agents/loop-hooks.md), [Keeping agents out of the data
  folder](./managed-agents/read-block.md), [Archived agent
  history](./managed-agents/history-retention.md), [Operations](./managed-agents/operations.md), [Steer a running
  turn](./managed-agents/steering.md), [Repeated tool
  calls](./managed-agents/repeated-tool-calls.md),
  [From the command palette](./managed-agents/palette.md), [Native
  skills](./managed-agents/native-skills.md), [Permission
  policy](./managed-agents/permission-policy.md), [Providers and plan
  usage](./managed-agents/providers.md), [Session control](./managed-agents/session-control.md),
  [Session events and waits](./managed-agents/session-events.md), [Session
  messages](./managed-agents/session-messages.md), [Sessions](./managed-agents/sessions.md),
  [Skills](./managed-agents/skills.md),
  [Subagents](./managed-agents/subagents.md), [Cross-session
  reads](./managed-agents/cross-session-reads.md), [Transcript
  search](./managed-agents/transcript-search.md), [The transcript
  store](./managed-agents/transcript-store.md), [The transcript](./managed-agents/transcript.md),
  [Turn facts](./managed-agents/turn-facts.md), [Agents data
  sources](./managed-agents/turn-facts/data-sources.md),
  [Unattended follow-ups](./managed-agents/unattended-follow-ups.md).
- [terminal.md](./terminal.md): [Activity and delivery](./terminal/activity.md), [The terminal
  drawer](./terminal/client.md), [Run targets](./terminal/run-targets.md), [Terminal
  sessions](./terminal/sessions.md).
- [agent-tools.md](./agent-tools.md): [Browser and task script
  tools](./agent-tools/browser-and-scripts.md), [Context
  sections](./agent-tools/context-sections.md), [Loaded tools and context
  sections](./agent-tools/loaded-tools.md), [Managed-session
  orchestration](./agent-tools/orchestration.md), [Plugin tools](./agent-tools/plugin-tools.md),
  [Tracker and GitHub tools](./agent-tools/tracker-tools.md), [Workflow
  tools](./agent-tools/workflow-tools.md).
- [dashboards.md](./dashboards.md): [Mapping and the editor](./dashboards/mapping-and-editor.md),
  [Panels](./dashboards/panels.md), [Placements](./dashboards/placements.md), [Sampling and
  retention](./dashboards/sampling.md), [Supplied rows](./dashboards/supplied-rows.md), [Views and
  trends](./dashboards/views.md).
- [integrations.md](./integrations.md): [Connection and integration
  contributions](./integrations/contributions.md), [Linear](./integrations/linear.md), [Model
  providers](./integrations/model-providers.md), [Project
  sources](./integrations/project-sources.md), [Provider
  boundaries](./integrations/provider-boundaries.md), [Rollbar](./integrations/rollbar.md),
  [Sentry](./integrations/sentry.md), [Connection settings](./integrations/settings.md).
- [data-sources.md](./data-sources.md): [Data source authoring
  controls](./data-sources/authoring-controls.md), [Source catalog](./data-sources/catalog.md), [Derived
  sources](./data-sources/derived-sources.md), [Provider data
  sources](./data-sources/provider-sources.md), [Workspace query
  library](./data-sources/query-library.md), [Serve a query](./data-sources/serve-a-query.md).
- [github-integration.md](./github-integration.md): [The GitHub
  mirror](./github-integration/mirror.md), [GitHub from the command
  palette](./github-integration/palette.md), [Reads and
  writes](./github-integration/reads-and-writes.md), [GitHub review comments
  source](./github-integration/review-comments.md), [GitHub
  surfaces](./github-integration/surfaces.md), [Tasks and
  references](./github-integration/tasks-and-references.md).
- [workflows.md](./workflows.md): [Agent steps](./workflows/agent-steps.md), [AI
  authoring](./workflows/ai-authoring.md), [Workflow authoring](./workflows/authoring.md), [Running
  child workflows](./workflows/child-runs.md), [Workflow definitions](./workflows/definitions.md),
  [Editor details](./workflows/editor-details.md), [Workflow execution](./workflows/execution.md),
  [File drafts and portable export](./workflows/file-drafts.md), [Polling
  gates](./workflows/polling-gates.md), [Record processing history](./workflows/record-history.md), [What workflows refuses](./workflows/refusals.md),
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
  delivery records kept while acceptance is open. Its README indexes every programme and single file.
  Shipped behavior belongs in an owning doc above.
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
  [Code hosts](./plugins/code-hosts.md), [Self-hosted code hosts](./plugins/self-hosted-code-hosts.md), [Shared review views](./plugins/change-request-ui.md), [Descriptors](./plugins/descriptors.md), [Detail regions](./plugins/detail-regions.md), [The dev loop](./plugins/dev-loop.md),
  [Distribution](./plugins/distribution.md), [Document surfaces and
  webviews](./plugins/document-surfaces.md), [Events](./plugins/events.md), [Forward
  compatibility](./plugins/forward-compatibility.md), [Frames](./plugins/frames.md), [Keeping a
  descriptor fresh](./plugins/freshness.md), [Harnesses](./plugins/harnesses.md),
  [Hooks](./plugins/hooks.md), [Link previews](./plugins/link-previews.md), [Loaded plugins](./plugins/loaded-plugins.md), [Markdown
  fences](./plugins/markdown-fences.md), [Context menus and rail
  markers](./plugins/menus-and-markers.md), [More descriptors](./plugins/more-descriptors.md), [Node
  providers](./plugins/node-providers.md), [Node-side extension
  points](./plugins/node-side-extension-points.md), [Package shape](./plugins/package-shape.md), [The
  plugin API](./plugins/plugin-api.md), [Published packages](./plugins/publishing.md), [Rail presentation and
  artwork](./plugins/rail-presentation.md), [Remote
  points](./plugins/remote-points.md), [Remote trees](./plugins/remote-trees.md), [Replacing a core
  surface](./plugins/replacing-core-surfaces.md), [Rows and
  annotations](./plugins/rows-and-annotations.md), [Search providers](./plugins/search-providers.md),
  [Task checks](./plugins/task-checks.md), [Toolbar actions](./plugins/toolbar-actions.md), [The tree
  contract](./plugins/tree-contract.md), [Choosing how a plugin draws](./plugins/ui-tiers.md).
- [plugin-authoring.md](./plugin-authoring.md): [Browser
  handoffs](./plugin-authoring/browser-handoffs.md), [CLI command
  authoring](./plugin-authoring/cli-commands.md), [A complete
  example](./plugin-authoring/complete-example.md), [Contributions](./plugin-authoring/contributions.md),
  [Custom agents](./plugin-authoring/custom-agents.md), [Derived
  sources](./plugin-authoring/derived-sources.md), [Events and
  capabilities](./plugin-authoring/events-and-capabilities.md),
  [Extensions](./plugin-authoring/extensions.md), [An extension
  example](./plugin-authoring/extension-example.md), [its Node
  half](./plugin-authoring/extension-example-node.md), [its
  trees](./plugin-authoring/extension-example-trees.md), [Harnesses](./plugin-authoring/harnesses.md),
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

## Node, client, and plugin split proposal

- [Keep the Node, client, and plugin splits honest](./future/split/README.md), with phases for [remote
  preview](./future/split/09-remote-preview.md) and [the remote preview
  proxy](./future/split/10-remote-preview-proxy.md).

## Mobile web app proposal

- [Build a mobile web app](./future/mobile/README.md), with phases for [the
  gateway](./future/mobile/01-gateway.md), [the shell](./future/mobile/02-shell.md), [narrow
  mode](./future/mobile/03-narrow-mode.md), [narrow layouts](./future/mobile/04-narrow-layouts.md),
  [Needs you and the conversation](./future/mobile/05-needs-you.md), and [running on a
  phone](./future/mobile/06-on-a-phone.md), then [later work](./future/mobile/later.md).

## Node for other machines proposal

- [Run a Node for clients on other machines](./future/node-tray/README.md), with phases for
  [platform archives](./future/node-tray/04-platform-archives.md), [installing and running at
  login](./future/node-tray/05-install-and-service.md), [tray mode](./future/node-tray/06-tray-mode.md),
  [keeping the machine awake](./future/node-tray/07-keep-awake.md), and [acceptance on real
  machines](./future/node-tray/08-acceptance.md).

## Panels over data an agent found proposal

- [Let an agent chart data it gathered itself](./future/supplied-data/README.md), with phases for
  [supplied rows](./future/supplied-data/01-supplied-rows.md), [keeping a panel up to
  date](./future/supplied-data/02-keep-it-updated.md), and [a code search
  source](./future/supplied-data/03-code-search-source.md).

## Workflow triggers proposal

- [Start a workflow when records change](./future/triggers/README.md), with phases for [clearing the
  ground](./future/triggers/01-clear-the-ground.md), [one trigger
  model](./future/triggers/02-one-trigger-model.md), [saying when data
  changed](./future/triggers/03-say-when-data-changed.md), [record
  triggers](./future/triggers/04-record-triggers.md), [the plugin author
  kit](./future/triggers/05-plugin-author-kit.md), and [first-party triggers and
  acceptance](./future/triggers/06-first-party-triggers.md).

## OpenCode harness proposal

- [OpenCode as a contributed harness](./future/opencode.md), postponed.
