# Settings groups

This page covers core's settings pages for workspaces and projects, agents, connections, plugins, and
Nodes, and the plugin strip on a plugin's page. It's part of [frontend](../frontend.md).

## Workspaces and projects

Overview (`packages/client-core/src/features/workspaces/WorkspaceProjectAssignments.tsx`) is every
project on the Node in one table, `features/workspaces/ProjectTable.tsx`, grouped under its
workspace. A row's name and chevron open the project's page, and a group's name opens the workspace's
page. Selecting rows opens a bar under the table: **Move to workspace**, whose last option creates a
workspace, **Hide** or **Show**, and **Set colour**. The bar calls the one-project `PATCH` route for each
row and names each project that failed. A workspace's page draws the same table for its projects.

A workspace's page (`features/settings/WorkspaceSettings.tsx`) holds its name, its projects, the
services it follows (`features/settings/ProjectConnections.tsx`), and a danger zone that deletes it. A
project's page (`features/settings/ProjectSettings.tsx`) has five tabs:

- **General**: name, folder, task tab color, workspace, hidden, task branch prefix, and the danger
  zone.
- **Setup and scripts**: setup, its trigger, teardown, the dev script and restart command, and run
  targets. Run targets are a table with a small form under it (`features/settings/RunTargetsTable.tsx`),
  and the stored value is the JSON array the run-targets route checks.
- **Preview**: the URL mode and page rules.
- **Database**: the connection script and the query-generation schema.
- **Connections**: each connection's project map from this project's side
  (`features/settings/ConnectionProjectMap.tsx`), each linking to the connection's page.

The Default workspace can't be renamed or deleted, because a deleted workspace's projects land there.

The pages are addressed by ID: `settings/workspace/<workspaceId>` and `settings/project/<projectId>`,
each taking `#<sectionId>`. A section on a hidden tab lands by picking its tab first. Each step of the
path above the title is a link. ⌘[ goes back: a workspace to Overview, and a project to Overview when
opened from there, otherwise to its workspace.

A settings page registered with `scope: 'workspace'` or `scope: 'project'` has no rail row. It's a tab
on every workspace's or project's page, after core's tabs, and gets that workspace or project in its
context (`settingsDetailTabs`). A loaded frame with `settingsScope: 'project'` gets the project ID in
its binding. Docker's tab is the example (`plugins/docker/src/client/DockerProjectSettings.tsx`).

A value a project's committed `.acorn/config.toml` sets is read-only on the project page, labeled
**From .acorn/config.toml**, with the file's value above this machine's own. The project config read
carries `repoConfig`, only what the file sets (`readCommittedConfig` in
`packages/node-core/src/server/runConfig.ts`), so the page never parses repository files. Those values
are the dev script and restart command when the file declares a `dev` run target, the database
connection script, the preview mode and value, and the run targets. A machine target with a repository
target's name says the repository replaces it. The file wins whether or not it's trusted: trust decides
whether a task may run it. A key the home `~/.acorn/config.toml` sets isn't reported
([repository settings](../workspaces-and-tasks.md)).

## Agents

The Agents group has six pages, and the agents plugin owns four (`plugins/agents/src/client/index.ts`):

| Page | Owner | What it holds |
| --- | --- | --- |
| Harnesses and defaults (`agent-defaults`) | agents | Each harness and whether this machine can run it, usage limits, new-session defaults with the task-context switch, inline diff chats, and the device's **Tool call display** |
| Custom agents (`custom-agents`) | agents | A list, then one agent's editor with a danger zone |
| Tools and permissions (`agent-tools`) | core | The three tiers, then every tool grouped by owner or tier |
| MCP servers (`agent-mcp-servers`) | agents | The servers acorn declares to every session, a list then one server's editor |
| MCP config files (`mcp`) | core | The servers a CLI loads by itself, for the project picked on the page |
| Limits and cost (`agent-limits`) | agents | Turns at once, then prices. `agent-concurrency` and `agent-pricing` are aliases. |

The task-context switch writes core's `startup_context_injection` preference, which the memory
plugin's launch-context handler reads on the Node
(`plugins/agents/src/client/settings/startupContext.ts`). The two MCP pages link to each other, because
acorn can add a server to a session but can't remove one a CLI loads itself ([MCP](../mcp.md)).

## Connections

The Connections group has two core pages, in `features/settings/connections/` and
`features/settings/models/AiModelsSettings.tsx`. [Integrations](../integrations.md) § Settings says
what each holds.

| Page | What it holds |
| --- | --- |
| Services (`integrations`) | Every connection that isn't a model key, one connection's page, and the Add connection gallery |
| AI models (`ai-models`) | **Generate with**, a device row with its own chip, the model keys, and the agent CLIs this machine has |

A connection's page and the gallery are details of the list, drawn by `ConnectionsPage.tsx`, which
both pages share. A link to one from elsewhere goes through `openConnectionPage` in
`connections/connections.ts`: a detail request (`createDetailRequest`) set only once Settings has moved
to the list page. A project's Connections tab, a workspace's page, and a search result for a
connection's name use it. The `needs-auth` dot comes from the attention source
`core.connectionsNeedAuth`, registered in `apps/desktop/src/client/activate.ts`.

## Plugins

The Plugins group has two core pages. **Installed** (`plugins`) lists the Node's plugins and this
device's client-only ones, with **Needs you** and **This device** filters, and opens a plugin's page
with **Overview**, **Settings**, **Permissions**, and **Versions** tabs. **Install…** is one flow for
both targets ([what the owner sees](../plugins/activation.md#what-the-owner-sees)). **Rail and
surfaces** (`rail-surfaces`, device) holds the **Show in left rail** switch for every plugin source
([rail source visibility](./rail-and-routing.md#rail-source-visibility)) and the replaced-surface
picker.

Any settings page opens a plugin's page with `openPluginPage(navigate, pluginId)`
(`features/settings/plugins/installed.ts`). The plugin strip's **Manage plugin** and a tool's owner on
Tools and permissions use it.

### The plugin strip

Every page a plugin contributes carries the host's plugin strip
(`features/settings/plugins/PluginStrip.tsx`), whether the page is compiled, a remote tree, or a frame.
It holds the plugin's name and origin, **Manage plugin**, a **Show in left rail** switch for each source
the page names in `railSourceVisibility`, the **Enabled** switch, and a status line for off, waiting
for approval, failed, and offline. It describes the active Node.

Plugin content can't hide or cover the strip, for four reasons:

1. The strip comes before the box the plugin's content draws in, and on a plugin's own page it sits
   outside the scrolling body.
2. The box around plugin content, `.settings-body[data-plugin]` or `.settings-plugin-content`, sets
   `contain: layout` and `isolation: isolate`, so anything inside is placed and stacked within it.
3. A compiled plugin and a remote tree draw only kit nodes, and no kit node takes a class or a style.
4. A frame is an iframe (`sandbox="allow-scripts allow-same-origin"`), which paints only inside its box.

The strip draws switches only for sources the plugin really registered. A compiled page that names
another plugin's source is refused at registration (`host/registries/extensionPoints/plugin.ts`), a
core page may name none, and a loaded frame's foreign ID is dropped by `host/frames/register.ts`.

## Node management

**Settings → Nodes** (`features/settings/nodes/NodesSettings.tsx`) adds, renames, reconnects, unpairs,
and revokes Nodes. Unpair and revoke are labeled differently on purpose. Unpairing can be undone with the same
pairing code. Revoking means the Node tears up this client's credential, and confusing the two is how
an owner loses access to a remote Node
([Node enrollment](../node-enrollment.md)).
