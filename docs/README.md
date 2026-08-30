# The docs

Every document under `docs/` is listed here, grouped by what it is for. Nothing else indexes them, so
a new file belongs in this list on the same commit that creates it.

## If you are new

Read four, in this order, and stop.

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
| [api-reference.md](./api-reference.md) | Every `/v2` route, its shape, and its auth requirement. |
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
| [editor-monaco.md](./editor-monaco.md) | The host-owned document surface: why the host draws the editor and what it lends. |

## Features

| Document | What it holds |
| --- | --- |
| [features.md](./features.md) | The shipped product surfaces, one line each. |
| [workspaces-and-tasks.md](./workspaces-and-tasks.md) | The product model: workspaces, projects, tasks, and worktrees. |
| [managed-agents.md](./managed-agents.md) | Agent sessions acorn drives: the ledger, harnesses, approvals, artifacts, and usage. |
| [terminal.md](./terminal.md) | The terminal drawer: raw PTY sessions, run targets, and provider profiles. |
| [agent-tools.md](./agent-tools.md) | Agent tool contributions, permissions, and the MCP projection. |
| [dashboards.md](./dashboards.md) | User-composed panels over typed record collections. |
| [integrations.md](./integrations.md) | Connections, providers, the external-item store, and project links. |
| [github-integration.md](./github-integration.md) | Pull requests, reviews, checks, the mirror, and the importer. |
| [schedules.md](./schedules.md) | Node-owned periodic work. |
| [workflows.md](./workflows.md) | File-defined orchestration: runs, gates, budgets, branching, joins. |
| [notes-and-memory.md](./notes-and-memory.md) | Task notes and the memory proposals loop. |
| [http-client.md](./http-client.md) | The HTTP request pane and the outbound-request gap. |
| [docker.md](./docker.md) | The Docker pane and the archive-time teardown. |
| [database.md](./database.md) | The database plugin: the Postgres browser and SQL editor. |
| [mcp.md](./mcp.md) | The MCP server: a stdio child that calls the node over loopback. |

## Plugins

Five docs, and they do not overlap. Start at the map.

| Document | What it holds |
| --- | --- |
| [plugin-map.md](./plugin-map.md) | **Read this first.** The orientation map: every surface a plugin can reach, one line each, with two worked examples. |
| [extensibility.md](./extensibility.md) | The reasoning: why two tiers, where the line is, and which constraints are deliberate. Read before widening a seam. |
| [plugins.md](./plugins.md) | The reference: the package shape, the API, activation, the client half, the five contribution kinds, and the collaboration rules. |
| [plugin-authoring.md](./plugin-authoring.md) | Writing a loaded plugin by hand with no build step, including the manifest reference and a complete example. |
| [contribution-kinds.md](./contribution-kinds.md) | The table of every contribution kind and its two carriers. Test-enforced. |
| [first-party-plugins.md](./first-party-plugins.md) | Which first-party plugins have to be, and which are only first-party by history. |
| [loaded-plugin-migration.md](./loaded-plugin-migration.md) | The record of moving plugins out of the binary: what each move cost and what it found. |

## Building, running, shipping

| Document | What it holds |
| --- | --- |
| [local-development.md](./local-development.md) | Getting the app running, the dev loops, and the environment. |
| [testing.md](./testing.md) | Where tests live, the tiers, the testkit, and the manual smoke checklist. |
| [shell.md](./shell.md) | The Tauri shell: schemes, custody, webviews, the helper, and packaging. |
| [node-distribution.md](./node-distribution.md) | The standalone node tarball and how it boots without a desktop. |
| [release-notes.md](./release-notes.md) | What is in the current release. |

## Subfolders

- [future/](./future/README.md) — designs, analyses, and sequenced plans for work that has not shipped,
  plus the refusals that keep it from being re-argued. Its README indexes every programme and single
  file. Behaviour that ships moves out of here into an owning doc above.
- `schemas/` — generated, versioned JSON Schemas that are pinned by a test and immutable by rule.
  Today that is `docs/schemas/enrollment-v1.json`.

## The rules this list follows

The files stay flat. A folder split by kind — `reference/`, `guides/` — was refused on 2026-08-30
because this list groups them by kind without moving anything, every inbound link keeps working, and
the path checker's job stays small. If the count passes 60, the question is open again.

A fact has exactly one owning document, and the others link to it. Where a document under
[future/](./future/README.md) disagrees with one above, the one above wins. When behaviour or a
contract changes, the owning document changes in the same commit —
`tools/arch/docPaths.test.ts` checks that the paths and links in here still resolve, but nothing checks
that the prose is still true except the person changing the code.
