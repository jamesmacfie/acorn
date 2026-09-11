# Documentation

Every document under `docs/` is listed here, grouped by what it is for. Nothing else indexes them, so
a new file belongs in this list on the same commit that creates it.

## Start here

Read these pages in order:

1. [architecture-overview.md](./architecture-overview.md) — the runtimes, who owns what, and how a
   request crosses them.
2. [features.md](./features.md) — what the product actually does, so the rest has something to hang on.
3. [frontend.md](./frontend.md) or [api-reference.md](./api-reference.md) — whichever side you are
   about to touch.
4. [conventions.md](./conventions.md) — where a file goes and what it is called.

If your first task is a plugin, read [plugin-map.md](./plugin-map.md) instead of 3. It is the
orientation map over the whole plugin system and it is much shorter than the reference.

## Architecture and contracts

| Document | What it holds |
| --- | --- |
| [architecture-overview.md](./architecture-overview.md) | Runtime topology, process ownership, package boundaries, and the product model. The one to read first. |
| [conventions.md](./conventions.md) | The naming rules: files, folders, exports, state, contributions, packages. |
| [api-reference.md](./api-reference.md) | Overview of `/v2` routes, authentication, errors, and transport. |
| [data-layer.md](./data-layer.md) | The data root, the core database, plugin databases, migrations, backup, and retention. |
| [state-ownership.md](./state-ownership.md) | Which state the node owns, which the device owns, and what is disposable. |
| [caching.md](./caching.md) | The client cache, its keys, and the serve-then-revalidate policy. |
| [authentication.md](./authentication.md) | Device pairing, tokens, principals, and the internal-call scopes. |
| [security.md](./security.md) | The threat model, the trust boundaries, the containment ladder, and the audit trail. |
| [node-enrollment.md](./node-enrollment.md) | How a provisioned node introduces itself to a control plane, and the versioned protocol it speaks. |

## The renderer

| Document | What it holds |
| --- | --- |
| [frontend.md](./frontend.md) | Renderer composition, the package layout, and how the shell is put together. |
| [ui-design.md](./ui-design.md) | The closed component kit, the appearance axes, and the design tokens. |
| [panes.md](./panes.md) | The layout model and the pane vocabulary. |
| [command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) | The palette, the keymap, focus, and typing. |
| [diff-rendering.md](./diff-rendering.md) | The diff model, the virtualizer, hydration, and the find pass. |
| [editor.md](./editor.md) | The host-owned document surface: why the host draws the editor and what it lends. |
| [notifications.md](./notifications.md) | What an agent is doing, which changes are worth interrupting for, and the gate every channel hangs off. |

## Features

| Document | What it holds |
| --- | --- |
| [features.md](./features.md) | The shipped product surfaces, one line each. |
| [workspaces-and-tasks.md](./workspaces-and-tasks.md) | The product model: workspaces, projects, tasks, and worktrees. |
| [managed-agents.md](./managed-agents.md) | Agent sessions acorn drives: the ledger, harnesses, managed delegation, approvals, artifacts, and usage. |
| [terminal.md](./terminal.md) | The terminal drawer: raw PTY sessions, run targets, and provider profiles. |
| [agent-tools.md](./agent-tools.md) | Agent tool contributions, permissions, the MCP projection, and managed-session orchestration. |
| [dashboards.md](./dashboards.md) | User-composed panels over typed record collections. |
| [integrations.md](./integrations.md) | Connections, providers, the external-item store, and project links. |
| [github-integration.md](./github-integration.md) | Pull requests, reviews, checks, the mirror, and the importer. |
| [schedules.md](./schedules.md) | Node-owned periodic work. |
| [workflows.md](./workflows.md) | Declarative orchestration: runs, gates, budgets, branching, joins, the two stores a definition lives in, the editor that writes one, and the pane a run is watched in. |
| [notes-and-memory.md](./notes-and-memory.md) | Task notes and the memory proposals loop. |
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
| [local-development.md](./local-development.md) | Getting the app running, the dev loops, and the environment. |
| [testing.md](./testing.md) | Where tests live, the tiers, the testkit, and the manual smoke checklist. |
| [performance.md](./performance.md) | The record of the performance programme: what was decided about the shape of the system, what was refused and on what exit condition, and every number it measured. |
| [telemetry.md](./telemetry.md) | The five record kinds, the switch, the collector, the scrubber, and what a sink can see. |
| [shell.md](./shell.md) | The Tauri shell: schemes, custody, webviews, the helper, and packaging. |
| [tui.md](./tui.md) | The terminal client: `acorn` in a terminal, its process model, its host switch, how it draws a frame, and its chrome. |
| [node-distribution.md](./node-distribution.md) | The standalone node tarball and how it boots without a desktop. |
| [release-notes.md](./release-notes.md) | What is in the current release. |

## Subfolders

- [future/](./future/README.md) — designs, analyses, and sequenced plans for work that has not shipped,
  plus the refusals that keep it from being re-argued. Its README indexes every programme and single
  file. Behaviour that ships moves out of here into an owning doc above.
- `schemas/` — generated, versioned JSON Schemas that are pinned by a test and immutable by rule.
  Today that is `docs/schemas/enrollment-v1.json`.

## Documentation ownership

Keep one owning page for each contract. Link to it from other pages instead of copying its details.
Group long references by topic in a subfolder. Keep the original landing page when source comments
or external links depend on its path, and update relative links when moving a section.

Describe implemented behavior in reference pages. Put proposed application changes in
[Future work](./future/README.md), and label dated measurements as historical evidence.
Update this index when adding a page. `tools/arch/docPaths.test.ts` checks file paths and relative
links; review the implementation to verify API signatures and behavior.

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

- [Events and capabilities](./plugin-authoring/events-and-capabilities.md)

- [Installing a hand-written package](./plugin-authoring/installing-a-hand-written-package.md)
- [Start from the scaffold](./plugin-authoring/start-from-the-scaffold.md)
- [The manifest](./plugin-authoring/the-manifest.md)
- [The node half](./plugin-authoring/the-node-half.md)

### Performance archive

- [2026-09-03 — phase 10, the re-measurement](./performance/2026-09-03--phase-10-the-re-measurement.md)
- [2026-09-03 — phase 2](./performance/2026-09-03--phase-2.md)
- [2026-09-03 — phase 5](./performance/2026-09-03--phase-5.md)
- [2026-09-03 — phase 8](./performance/2026-09-03--phase-8.md)
- [Added 2026-09-03](./performance/added-2026-09-03.md)
- [What was measured this time](./performance/what-was-measured-this-time.md)
