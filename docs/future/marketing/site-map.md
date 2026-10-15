# The site map

Date: October 15, 2026. Part of [the website programme](./README.md).

This page lists every page on the site and, for each docs page, the internal docs it's written from.
Read it before you add, move, or rename a page. Phase 2 creates every page below as a stub, so the
sidebar is whole from the first preview deploy and each later phase fills pages in.

The rule this page enforces: the internal doc owns the behavior, and the public page explains it to a
person. A public page never says something its sources don't. When behavior changes, the internal doc
changes first, and the report in [keeping the site in sync](./sync.md#rule-3-written-pages-name-their-sources)
lists the public pages to recheck. Each page's sources go in its frontmatter as `sources`.

## Marketing pages

Hand-written Astro pages, outside Starlight:

| Path | What it's for | Phase |
| --- | --- | --- |
| `/` | Say what acorn is, show it, and get it installed. | [8](./08-landing.md) |
| `/features/` | An index of the feature pages, one line and one picture each. | [9](./09-feature-pages.md) |
| `/features/tasks/` | Workspaces, projects, tasks, worktrees, and panes: the model everything hangs on. | [9](./09-feature-pages.md) |
| `/features/agents/` | Claude Code and Codex sessions, approvals, delegation, custom agents, and memory. | [9](./09-feature-pages.md) |
| `/features/review/` | GitHub pull request review, and Git: changes, history, stashes, and conflicts. | [9](./09-feature-pages.md) |
| `/features/desktop-and-terminal/` | One workspace, two clients, and the same plugins in both. | [9](./09-feature-pages.md) |
| `/features/task-tools/` | The editor, database, HTTP, Docker, preview, Linear, and Rollbar panes. | [9](./09-feature-pages.md) |
| `/features/automation/` | Workflows, schedules, dashboards, and the command line. | [9](./09-feature-pages.md) |
| `/features/browser/` | The Chrome and Firefox extension. | [9](./09-feature-pages.md) |
| `/features/nodes/` | Local and remote Nodes, pairing, the fleet, and the standalone Node. | [9](./09-feature-pages.md) |
| `/features/plugins/` | Why plugins work the way they do, and what one can add. | [9](./09-feature-pages.md) |
| `/features/security/` | What acorn keeps from agents and plugins, and how. | [9](./09-feature-pages.md) |
| `/download/` | Every way to get acorn, read from GitHub releases at build time. | [10](./10-download-and-changelog.md) |
| `/changelog/` | What changed, newest first, with an RSS feed. | [10](./10-download-and-changelog.md) |
| `/plugins/` | The plugins acorn ships, each linked to its docs page. | [13](./13-docs-built-in-plugins.md) |
| `/404` | A way back to the docs and the search box. | [2](./02-scaffold.md) |

Machine-readable files, served as they are:

| Path | Source | Phase |
| --- | --- | --- |
| `/schemas/acorn-plugin.schema.json` | `packages/plugin-types/acorn-plugin.schema.json` | [15](./15-plugin-reference.md) |
| `/schemas/acorn-device.schema.json` | `packages/plugin-types/acorn-device.schema.json` | [15](./15-plugin-reference.md) |
| `/schemas/cli/resources-v1.schema.json` | `apps/cli/schemas/resources-v1.schema.json` | [14](./14-docs-nodes-extension-automation.md) |
| `/schemas/cli/error-v1.schema.json` | `apps/cli/schemas/error-v1.schema.json` | [14](./14-docs-nodes-extension-automation.md) |
| `/llms.txt`, `/llms-small.txt`, `/llms-full.txt` | Generated from the docs | [19](./19-search-and-agent-outputs.md) |
| `/agent-guide.md` | Hand-written | [19](./19-search-and-agent-outputs.md) |
| `/<any docs page>.md` | The page's own Markdown | [19](./19-search-and-agent-outputs.md) |
| `/changelog/rss.xml` | The changelog data | [10](./10-download-and-changelog.md) |
| `/sitemap-index.xml`, `/robots.txt` | Generated | [2](./02-scaffold.md) |

Pages under `/lab/` hold wireframes, the design gallery, and the specimen gallery. They build in
development and on preview deploys, and never in production.

## Docs

The docs live under `/docs/`. The sidebar groups below are in the order a reader meets them. A page's
slug is its title in lowercase with hyphens unless the table says otherwise.

### Start here

| Page | Written from |
| --- | --- |
| What is acorn | `docs/features.md`, `docs/architecture-overview.md` |
| Install | `README.md`, `docs/node-distribution.md`, `docs/cli/local-service.md`, `docs/local-development.md` |
| Quick start: first project, first task, first agent | `docs/workspaces-and-tasks/projects.md`, `docs/workspaces-and-tasks/task-creation.md`, `docs/managed-agents/sessions.md` |
| Concepts | `docs/architecture-overview.md`, `docs/workspaces-and-tasks.md`, `docs/state-ownership.md` |
| Desktop and terminal | `docs/tui.md`, `docs/ui-design/shell-hierarchy.md`, `docs/first-party-plugins/terminal.md` |

### Using acorn

| Page | Written from |
| --- | --- |
| Workspaces and projects | `docs/workspaces-and-tasks/projects.md`, `docs/workspaces-and-tasks/workspace-icons.md` |
| Tasks and worktrees | `docs/workspaces-and-tasks/task-creation.md`, `docs/workspaces-and-tasks/worktrees.md`, `docs/git-client/worktrees.md` |
| Task scripts | `docs/workspaces-and-tasks/task-scripts.md` |
| Archive and restore | `docs/workspaces-and-tasks/archive.md` |
| Panes | `docs/panes.md`, `docs/panes/layout.md` |
| The window: top bar, rails, and drawer | `docs/ui-design/shell-hierarchy.md`, `docs/frontend/rail-and-routing.md` |
| The command palette | `docs/command-palette-and-shortcuts/palette.md`, `docs/command-palette-and-shortcuts/commands.md` |
| Keyboard shortcuts | `docs/command-palette-and-shortcuts/shortcuts.md`, `docs/command-palette-and-shortcuts/focus-and-typing.md` |
| Notifications and the inbox | `docs/notifications.md`, `docs/notifications/channels.md` |
| Notes | `docs/notes-and-memory.md` |
| Memory | `docs/notes-and-memory.md`, `docs/notes-and-memory/memory-page.md` |
| Task context | `docs/agent-tools/context-sections.md`, `docs/notes-and-memory.md` |
| Appearance: themes and styles | `docs/ui-design/appearance.md` |
| Links into acorn | `docs/frontend/acorn-links.md` |
| Project configuration | `docs/workspaces-and-tasks/project-config.md` |

### Agents

| Page | Written from |
| --- | --- |
| Agent sessions | `docs/managed-agents/sessions.md`, `docs/managed-agents/transcript.md`, `docs/managed-agents/composer.md` |
| Harnesses and defaults | `docs/managed-agents/harnesses.md`, `docs/managed-agents/defaults.md`, `docs/managed-agents/accounts.md` |
| Permissions and approvals | `docs/managed-agents/permission-policy.md`, `docs/managed-agents/app-access.md`, `docs/security/instruction-review.md` |
| Custom agents | `docs/managed-agents/custom-agents.md` |
| Skills | `docs/managed-agents/skills.md`, `docs/managed-agents/native-skills.md` |
| Delegation and subagents | `docs/managed-agents/delegation.md`, `docs/managed-agents/subagents.md` |
| Steering, queues, and follow-ups | `docs/managed-agents/steering.md`, `docs/managed-agents/operations.md`, `docs/managed-agents/unattended-follow-ups.md` |
| Files, attachments, and context | `docs/managed-agents/attachments.md` |
| Search agent history | `docs/managed-agents/transcript-search.md`, `docs/managed-agents/history-retention.md` |
| Usage and cost | `docs/managed-agents/providers.md`, `plugins/agent-cost/README.md` |
| Agents in the terminal drawer | `docs/terminal.md`, `docs/terminal/run-targets.md` |
| Agent tools and the MCP server | `docs/agent-tools.md`, `docs/mcp.md`, `docs/mcp/managed-servers.md` |
| Model providers and generating text | `docs/integrations/model-providers.md` |

### Security

| Page | Written from |
| --- | --- |
| The trust model | `docs/security.md` |
| Credentials and secrets | `docs/security/credentials.md`, `docs/security/secret-publication.md` |
| Plugin trust and permissions | `docs/security/node-plugin-security.md`, `docs/security/plugin-bundles.md`, `docs/security/plugin-install.md` |
| Files, processes, and project configuration | `docs/security/process-and-paths.md`, `docs/security/instruction-review.md` |
| The preview and webviews | `docs/security/webviews.md`, `docs/shell/webviews.md` |
| The audit log | `docs/security/audit.md` |
| Telemetry and privacy | `docs/telemetry.md`, `docs/telemetry/model.md` |
| Security diagnostics | `docs/security/security-diagnostics.md` |
| What acorn doesn't protect against | `docs/security.md` |

### Settings

One overview page and one page per Settings group, in the app's order. Each group page lists every
page in that group and every setting on it, with what it changes and where the value is stored.

| Page | Written from |
| --- | --- |
| Settings | `docs/features.md`, `docs/frontend/settings.md`, `docs/frontend/settings-groups.md` |
| General, Workspaces and projects, Agents, Connections, Features, Automation, Machines, Plugins, Advanced | `docs/frontend/settings-pages.md`, then the doc that owns each setting |

### Built-in plugins

An overview, then one page per plugin acorn ships, in the fixed shape [phase 13](./13-docs-built-in-plugins.md)
defines. Compiled and loaded plugins sit in one list. The tier is a line on each page, not a heading.

| Page | Written from |
| --- | --- |
| Built-in plugins | `docs/first-party-plugins.md`, `docs/first-party-plugins/terminal.md` |
| Agents | `docs/managed-agents.md` |
| Agent browser | `docs/agent-tools/browser-and-scripts.md` |
| Agent cost | `plugins/agent-cost/README.md`, `docs/managed-agents/providers.md` |
| Context | `docs/agent-tools/context-sections.md` |
| Database | `docs/database.md`, `docs/database/pane.md`, `docs/database/palette-and-workflows.md` |
| Docker | `docs/docker.md` |
| Editor | `docs/editor.md` and its topic pages |
| Git | `docs/git-client/history.md`, `docs/git-client/operations.md`, `docs/git-client/conflicts.md`, `docs/diff-rendering/changes-pane.md` |
| GitHub | `docs/github-integration.md` and its topic pages |
| HTTP | `docs/http-client.md`, `docs/http-client/client.md` |
| Linear | `docs/integrations/linear.md` |
| Memory | `docs/notes-and-memory.md` |
| Model providers | `docs/integrations/model-providers.md` |
| Notes | `docs/notes-and-memory.md` |
| Preview | `docs/shell/webviews.md`, `docs/security/webviews.md` |
| Rollbar | `docs/integrations/rollbar.md` |
| Sentry telemetry | `docs/integrations/sentry.md` |
| Terminal | `docs/terminal.md` and its topic pages |
| Workflows | `docs/workflows.md` |

### Nodes and devices

| Page | Written from |
| --- | --- |
| Nodes | `docs/architecture-overview.md`, `docs/architecture/fleet.md` |
| Pair a device or a remote Node | `docs/authentication.md`, `docs/node-distribution.md` |
| Run a standalone Node | `docs/node-distribution.md`, `docs/cli/local-service.md` |
| The fleet view | `docs/architecture/fleet.md` |
| Where your data lives | `docs/data-layer/data-root.md`, `docs/state-ownership.md` |
| Back up and restore | `docs/data-layer/backup-and-retention.md` |

### Browser extension

| Page | Written from |
| --- | --- |
| Set up the extension | `docs/browser-extension.md`, `docs/browser-extension/setup.md`, `docs/cli/browser-host.md` |
| Talk to an agent from the browser | `docs/browser-extension/conversations.md` |
| Send pages, selections, and screenshots | `docs/browser-extension/page-capture.md` |
| Ask about an element | `docs/browser-extension/element-picker.md` |
| Task chips and handoffs | `docs/browser-extension/handoffs.md`, `docs/browser-extension/task-pages.md` |
| Project sites | `docs/browser-extension/project-sites.md` |
| Workflows and plugin panels | `docs/browser-extension/workflows.md`, `docs/browser-extension/plugin-panels.md` |
| Waiting requests and notifications | `docs/browser-extension/notifications.md` |

### Automation

| Page | Written from |
| --- | --- |
| Workflows | `docs/workflows.md` |
| Write a workflow | `docs/workflows/authoring.md`, `docs/workflows/definitions.md`, `docs/workflows/file-drafts.md`, `docs/workflows/ai-authoring.md` |
| Steps, gates, and budgets | `docs/workflows/execution.md`, `docs/workflows/agent-steps.md`, `docs/workflows/polling-gates.md`, `docs/workflows/typed-data.md`, `docs/workflows/child-runs.md` |
| Start and schedule runs | `docs/workflows/starting-runs.md`, `docs/workflows/scheduled-roots.md`, `docs/schedules/user-schedules.md` |
| Schedules | `docs/schedules.md` |
| Dashboards | `docs/dashboards.md` and its topic pages |
| Data sources and saved queries | `docs/data-sources.md`, `docs/data-sources/query-library.md`, `docs/data-sources/derived-sources.md` |
| The command line | `docs/cli.md` and its topic pages |

### Build plugins

The largest section. [Phase 15](./15-plugin-reference.md) builds the reference, and phases
[16](./16-plugin-guides-ui.md) and [17](./17-plugin-guides-node-and-agents.md) write the guides.
Every guide has a working example package and a picture of what it draws.

Start:

| Page | Written from |
| --- | --- |
| How plugins work | `docs/extensibility.md`, `docs/plugin-map.md`, `docs/extensibility/ui-and-cooperation.md` |
| Build your first plugin | `docs/plugin-authoring/start-from-the-scaffold.md`, `docs/plugin-authoring/complete-example.md`, `docs/plugins/dev-loop.md` |
| Have your agent build it | `docs/plugins/agent-install.md`, `docs/agent-tools/plugin-tools.md` |
| Choose how your plugin draws | `docs/plugins/ui-tiers.md` |

Guides for what a plugin draws, in [phase 16](./16-plugin-guides-ui.md):

| Page | Written from |
| --- | --- |
| Add a pane | `docs/panes/contributions.md`, `docs/plugin-authoring/the-client-half.md`, `docs/plugins/remote-trees.md` |
| Add a source to the left rail | `docs/plugins/descriptors.md`, `docs/frontend/rail-and-routing.md` |
| Put your pane in the right rail | `docs/panes/layout.md`, `docs/panes/contributions.md` |
| Add a reference panel | `docs/plugins/frames.md`, `docs/contribution-kinds.md` |
| Add a settings page | `docs/plugin-authoring/settings-pages.md` |
| Add commands and keybindings | `docs/plugins/commands.md`, `docs/command-palette-and-shortcuts/shortcuts.md` |
| Add rows to context menus | `docs/plugins/menus-and-markers.md` |
| Put a badge in the top bar or task footer | `docs/contribution-kinds.md`, `docs/plugins/more-descriptors.md` |
| Mark tasks, sources, and panes | `docs/plugins/rows-and-annotations.md` |
| Add to another plugin's view | `docs/plugin-authoring/extensions.md`, `docs/plugins/cooperative-extension-points.md`, `docs/plugins/detail-regions.md` |
| Open your view to other plugins | `docs/plugins/cooperative-extension-points.md`, `docs/plugins/remote-points.md` |
| Add a toolbar control | `docs/plugins/toolbar-actions.md` |
| Preview links and draw code fences | `docs/plugins/link-previews.md`, `docs/plugins/markdown-fences.md` |
| View files and agent attachments | `docs/plugins/document-surfaces.md` |
| Replace the top bar, rail, or pane switcher | `docs/plugins/replacing-core-surfaces.md` |
| Draw your own pixels in a frame | `docs/plugins/frames.md`, `docs/plugin-authoring/the-bridge.md` |
| Show a web page | `docs/plugins/document-surfaces.md` |
| Add a theme or a style pack | `docs/plugin-authoring/ui-contributions.md`, `docs/ui-design/appearance.md` |
| Add icons and brand marks | `docs/ui-design/icons.md` |
| Notify the person | `docs/plugin-map.md`, `docs/notifications/rows-and-targets.md` |

Guides for the Node half, agents, data, and the browser, in [phase 17](./17-plugin-guides-node-and-agents.md):

| Page | Written from |
| --- | --- |
| Write the Node half | `docs/plugin-authoring/the-node-half.md` |
| Store data | `docs/plugin-authoring/storage.md` |
| Use events and talk to other plugins | `docs/plugin-authoring/events-and-capabilities.md`, `docs/plugins/events.md` |
| Connect a service | `docs/plugins/node-providers.md`, `docs/integrations/contributions.md` |
| Give agents tools | `docs/agent-tools/loaded-tools.md`, `docs/agent-tools/plugin-tools.md` |
| Add task context | `docs/agent-tools/context-sections.md` |
| Add a harness | `docs/plugin-authoring/harnesses.md`, `docs/plugins/harnesses.md` |
| Ship custom agents and skills | `docs/plugin-authoring/custom-agents.md`, `docs/managed-agents/skills.md` |
| Generate text with a model | `docs/integrations/model-providers.md` |
| Act on agent turns with hooks | `docs/plugins/hooks.md`, `docs/managed-agents/loop-hooks.md` |
| Add a data source | `docs/data-sources.md`, `docs/data-sources/authoring-controls.md`, `docs/plugin-authoring/derived-sources.md` |
| Add a workflow step | `docs/workflows/step-kinds.md` |
| Run work on a schedule | `docs/schedules/plugin-schedules.md` |
| Check a task before it's archived | `docs/plugins/task-checks.md` |
| Add a command-line command | `docs/plugin-authoring/cli-commands.md` |
| Add hover and diagnostics for a language | `docs/editor/document-surface.md` |
| Bring a website's item into a task | `docs/plugin-authoring/browser-handoffs.md` |
| Show a panel in the browser sidebar | `docs/plugin-authoring/browser-panel.md` |
| Log and measure | `docs/plugin-authoring/telemetry.md` |
| Test your plugin | `docs/plugin-authoring/testing.md` |
| Install, update, and share | `docs/plugin-authoring/installing-a-hand-written-package.md`, `docs/plugins/publishing.md`, `docs/plugins/distribution.md` |

Reference, in [phase 15](./15-plugin-reference.md). Pages marked generated come from code, with a short
written introduction:

| Page | Written from |
| --- | --- |
| Manifest reference | Generated from `packages/protocol/src/plugin/contract.ts` |
| Contributions, one page per key | Generated, with examples, and `docs/contribution-kinds.md` |
| Permissions | Generated from the manifest and `NODE_CORE_FACETS`, with `docs/plugin-authoring/permissions.md` |
| The Node context | Generated from the `acorn-plugin-types` declarations |
| The client bridge | Generated from `packages/plugin-sdk/src/public.ts`, with `docs/plugin-authoring/the-bridge.md` |
| Trees and events | `docs/plugins/tree-contract.md` |
| Extension points | Generated from `packages/protocol/src/chrome/publicExtensionPoints.ts` |
| Action verbs | `docs/plugin-authoring/contributions.md` |
| Limits | Generated from the constants in `packages/protocol/src/plugin/` |
| Compatibility and versions | `docs/plugins/forward-compatibility.md`, `docs/plugins/activation.md`, `docs/release-notes.md` |
| What plugins can't do | `docs/extensibility.md`, `docs/ui-design/closed-kit.md` |
| Examples | The example packages from phases 16 and 17 |

### Components

The shared kit, in [phase 18](./18-components.md). Every component has its own generated page with
both hosts' pictures, its props, how each host draws it, and what it does with focus.

| Page | Written from |
| --- | --- |
| One kit, two hosts | `docs/ui-design/closed-kit.md`, `docs/ui-design/every-node.md` |
| Roles and tokens | `docs/ui-design/appearance.md`, `docs/ui-design/tokens.md` |
| Layouts | `docs/panes/layout.md` |
| One page per component, grouped as Grouping, Content, Inputs, Collections, Overlays, and Rectangles | Generated from `NODE_SUPPORT`, `NODE_FOCUS`, the SDK declarations, and `docs/ui-design/every-node.md` |
| Icons | `docs/ui-design/icons.md` |
| Themes and style packs | `docs/ui-design/appearance.md`, `docs/ui-design/tokens.md` |
| Keyboard and accessibility | `docs/ui-design/interaction.md`, `docs/ui-design/states.md`, `docs/tui/keys.md` |
| What the kit refuses | `docs/ui-design/closed-kit.md` |

### Reference

| Page | Written from |
| --- | --- |
| Command line reference | `docs/cli.md`, `apps/cli/schemas/resources-v1.schema.json` |
| Keyboard shortcuts reference | Generated from the default keymap |
| Configuration files | `docs/workspaces-and-tasks/project-config.md`, `docs/workflows/definitions.md`, `packages/plugin-types/acorn-device.schema.json` |
| Environment variables | `docs/node-distribution.md`, `docs/tui/process.md` |
| JSON Schemas | The four schema files listed above |
| Glossary | `docs/conventions.md`, `docs/architecture-overview.md` |

### Help

| Page | Written from |
| --- | --- |
| Troubleshooting | `docs/browser-extension/setup.md`, `docs/plugin-authoring/installing-a-hand-written-package.md`, `docs/security/plugin-bundles.md` |
| FAQ | [Voice](./voice.md#the-faq) and phase 8 |
| Known limits | `docs/release-notes.md` and the limits section of each owning doc |

## What stays internal

- `docs/plugins.md` and its topic pages as a whole. They're the reference manual and design record.
  The public plugin docs take the author-facing part.
- `docs/first-party-plugins.md` tier audits, `docs/future/`, `docs/testing/`, and the dated security
  reviews. Public pages state conclusions, not the argument or the evidence.
- Architecture internals: the broker, custody, the service protocol, migrations, and the package
  boundaries. The Concepts page says what a person needs, and stops there.
- Anything unshipped. The site describes what the current build does.
