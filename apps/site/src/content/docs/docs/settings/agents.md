---
title: Agents
description: Every setting in the Agents group, with what it changes, where it's stored, and its default.
sources:
  - docs/frontend/settings-groups.md
  - docs/managed-agents/defaults.md
  - docs/managed-agents/accounts.md
  - docs/managed-agents/custom-agents.md
  - docs/agent-tools.md
  - docs/mcp.md
  - docs/mcp/managed-servers.md
  - docs/managed-agents/operations.md
  - docs/managed-agents/providers.md
  - plugins/agents/src/client/index.ts
  - plugins/agents/src/shared/sessionDefaults.ts
  - plugins/agents/src/shared/concurrency.ts
  - plugins/agents/src/client/settings/AgentSessionDefaultsSettings.tsx
  - plugins/agents/src/client/settings/CustomAgentsSettings.tsx
  - plugins/agents/src/client/settings/AgentMcpServersSettings.tsx
  - plugins/agents/src/client/settings/mcpServerDraft.ts
  - plugins/agents/src/client/settings/AgentPricingSettings.tsx
  - plugins/agents/src/client/sessions/toolFoldPrefs.ts
  - packages/protocol/src/agents/toolPermissions.ts
covers:
  - agent-defaults
  - custom-agents
  - agent-tools
  - agent-mcp-servers
  - agent-limits
checked: '252cc2937'
---

This page lists every setting in **Settings** > **Agents**. Every page here is stored on the Node, so
it applies to every device paired with it, except the rows marked **This device**. Settings that seed
new sessions don't change an open one.

## Harnesses and defaults

What agent sessions start with. [Harnesses and defaults](/docs/agents/harnesses-and-defaults/) explains
each one.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Harnesses** | Lists each harness and whether this Node can run it. Nothing to set. | | |
| **Show accounts as** | Whether account rows show a **Name** or an **Icon**. | Node | Name |
| **Add a Claude Code account**, **Add a Codex account** | Adds a second login for that harness. | Node | No accounts |
| **Default account** | The account a session uses when it names none. Shown once a harness has an account. | Node | The first account by name |
| **Continue when usage resets** | Waits out a plan limit and carries on. | Node | On |
| **Stop idle agents after** | Stops an idle agent's process after 15 minutes, 30 minutes, 2 hours, or **Never**. | Node | 30 minutes |
| **Stop idle agents above** | Stops the longest-idle agents when all of them hold more than 2, 4, or 8 GB, or **No limit**. | Node | 4 GB |
| **Warn when an agent repeats a tool call** | Warns after 3, 5, or 10 identical calls in a row, or **Never**. | Node | 3 times in a row |
| **Keep agent history for archived tasks** | Deletes an archived task's agent history after 30 days, 90 days, or 1 year, or keeps it **Forever**. | Node | Forever |
| **Generate with** | The backend and model every Generate control opens on. | This device | The first backend |
| **Carry my last session's settings forward** | Starts each session on your last choices. Off, the pickers for each harness apply. | Node | On |
| Each harness's pickers, such as **Model** and **Effort** | What new sessions on that harness start with, while the setting above is off. | Node | The harness's own default |
| **Send task context at startup** | Sends the task's context to an agent started in the terminal drawer. | Node | On |
| **MCP servers** | Opens **MCP**. | | |
| **Spawn settings** | **Inherit from parent** or **Use explicit defaults**, for agents another agent starts. | Node | Inherit from parent |
| **Provider**, under **Inline diff chats** | The harness, model, and effort for a chat from a diff line. | Node | The first installed harness |
| **Tool call display** | **Start collapsed**, **Start expanded**, or **Carry my last one forward**. | This device | Start collapsed |

## Custom agents

Saved starts for a session ([Custom agents](/docs/agents/custom-agents/)). **New agent** opens the
form, which saves only with **Save**.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Name**, **Description**, **Icon** | How the agent is listed. | Node | The harness's icon |
| **Harness** | Which harness it runs on. | Node | |
| The harness's options | What its sessions start on. Unset options keep your defaults. | Node | Unset |
| **acorn tools** | **All allowed tools**, **Read and write, but don't run anything**, or **Read only**. | Node | All allowed tools |
| **Instructions** | Text added to each session's system prompt. | Node | None |
| **Delete agent** | Deletes it. Sessions already started keep running. | Node | |

**From plugins** lists agents plugins add, with **Duplicate** only.

## Tools and permissions

Which of acorn's tools agents may call
([Permissions and approvals](/docs/agents/permissions-and-approvals/#acorns-tool-tiers)).

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Read tools** | Tools that read the task, notes, memory, Git, and the pull request. | Node | Always on |
| **Write tools** | Tools that write notes, and save or delete memory. | Node | On |
| **Execute tools** | Tools that use the preview browser, start run targets, and start other agents. | Node | Off |
| Each tool, **By owner** or **By tier** | Overrides its tier for that one tool. | Node | Its tier |

## MCP

The MCP servers your agents use ([Agent tools and the MCP
server](/docs/agents/agent-tools-and-the-mcp-server/#add-your-own-mcp-servers)). Two sections.

**Servers** holds the servers acorn adds to every session. **Add server** opens the form, and
**Install an MCP package** installs one from npm at an exact version.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Name** | The server's name, as agents see it. | Node | |
| **Transport** | **Command (stdio)**, with a command, arguments, and environment, or **URL (HTTP)**, with a URL and headers. A value marked **Secret** is sealed on the Node. | Node | |
| **On for new sessions** | Whether a new session starts with the server. `/mcp` in a session changes its own list. | Node | On |
| **Review tool definition changes** | Holds back the server's tools until you approve their definitions, and again when they change. | Node | Off |
| **Remove server** | Removes it. | Node | |

**Config files** lists, for the **Project** you pick, the servers each CLI loads from its own config,
such as `~/.claude.json` and `.mcp.json`. acorn can't turn these off. **Create .mcp.json** adds an
empty one to the project folder.

## Limits and cost

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Turns at once per provider** | How many turns one CLI, such as Claude Code, runs at once across all tasks. | Node | 2 |
| **Turns at once per workspace** | How many turns run at once in one workspace, across CLIs. Reads **per project** with projects separate. | Node | 3 |
| **Built-in models**, under **Claude prices** and **Codex prices** | The input, output, cache write, and cache read prices the cost estimate uses, in US dollars per million tokens. | Node | The published API prices |
| **Other models** | A price for an exact model ID the built-in list doesn't have. | Node | None |

The prices change only the estimate, never what you're billed
([Usage and cost](/docs/agents/usage-and-cost/)).

## In the terminal

The terminal client draws **Harnesses and defaults**, **Custom agents**, **MCP**, and **Limits and
cost**. **Tools and permissions** opens in the desktop app. **Generate with** and **Tool call display**
belong to each device.
