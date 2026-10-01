# 06-8. MCP: two pages that explain each other, and a hand-built server list

**Status:** not started. Batch B06. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

MCP servers (the agents plugin's page) and MCP config files (core's page) answer one question:
"which MCP servers do my agents get?" Each spends a paragraph pointing at the other. MCP config files
lists servers as a run-on flex line ("acorn stdio enabled /Applications/…"), colours the status with
the diff gutter's green, and heads each file with the absolute path, spelling out the user's home
folder. **acorn MCP server** is a section with a description and no rows. MCP servers' description
is four lines, then a second paragraph, then "No servers yet." flush under it.

## Where to see it

Settings › MCP config files, and Settings › MCP servers.

## The fix

This is the short-term part. One page with an extension point is deferred (see
[deferred.md](../deferred.md)).

- Cut the cross-reference paragraphs (`plugins/agents/src/client/settings/AgentMcpServersSettings.tsx:152-153`,
  `packages/client-core/src/features/settings/McpSettings.tsx:76-83`) to a ghost sm section-action
  link named after the other page.
- Delete the **acorn MCP server** section (`McpSettings.tsx:133-137`) and its entry in
  `packages/client-core/src/features/settings/corePages.ts` (around `:91`). Its text goes to `help` on
  the first section of Tools and permissions. Keep the opt-out commands (`claude mcp remove acorn`,
  `codex mcp remove acorn`) inline as a selectable muted line, because a tip cannot be copied.
- `McpSettings.tsx:98-121`: each file is a `SectionHeader level="sub"` with its path through
  `formatPath`. Each server is a [06-3](./06-3-one-list-row.md) row with an **On**, **Off**, or
  **Invalid** badge.
- Delete the `.mcp-server*` rules (`packages/client-core/src/features/settings/settings.css`, around
  `:142-148`).
- `AgentMcpServersSettings.tsx:143-170`: shorten the description and the second paragraph (copy
  below).

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `McpSettings.tsx:73` | The MCP servers your agents load by themselves, read from the project folder's .mcp.json and .cursor/mcp.json and from ~/.claude.json. acorn never starts these; the agent does, and nothing in acorn can switch one off. Secret values are masked. | Rewrite, split | Inline: "Servers your agents load from their own config files. acorn can't turn these off." Help: "acorn reads .mcp.json and .cursor/mcp.json in the project folder, and ~/.claude.json. Secret values are hidden." |
| `McpSettings.tsx:79-80` | The servers acorn adds to every session, whichever harness runs it, are on MCP servers. | Rewrite | A ghost sm section action, **MCP servers**. |
| `McpSettings.tsx:84` | Project / Whose files to read. A task's worktree loads the same committed files. | Move to `help`, rewrite | Help: "Tasks on this project load the same files from their worktree." |
| `McpSettings.tsx:94` | {project} has no folder on this node yet, so only ~/.claude.json is read. | Rewrite | {project} has no folder here, so acorn reads only ~/.claude.json. |
| `McpSettings.tsx:97` | No MCP config files found. | Keep | As `EmptyState align="start" size="sm"`. |
| `McpSettings.tsx:117` | No servers declared. | Rewrite | No servers in this file. |
| `McpSettings.tsx:125` | Adds an empty .mcp.json to the project's folder. Commit it, and a task on a new branch loads it too. | Rewrite, keep inline | Adds an empty .mcp.json to the project folder. Commit it so new tasks load it too. |
| `McpSettings.tsx:61` | Could not create. | Rewrite | Couldn't create the file. |
| `McpSettings.tsx:133-137` | acorn MCP server (section) | Remove | The text moves to Tools and permissions. |
| Tools and permissions, first section | (the acorn MCP server text, moved) | `help`, rewrite | acorn gives agents these tools through its own MCP server. Claude Code and Codex terminals add it on their own. Inline, selectable: "To remove it, run `claude mcp remove acorn` or `codex mcp remove acorn`." |
| `AgentMcpServersSettings.tsx:146` | Servers you add here go to every agent session acorn runs, in Claude Code, Codex, and any other harness, and they go with a session when you continue it in a terminal. A server that is on for new sessions starts in each session you open from now on. Settings never changes a session that is already open: to change its list, type /mcp in its composer. | Rewrite, split | Inline: "acorn adds these servers to every agent session." Help: "They go to Claude Code, Codex, and any other harness, including a session you continue in a terminal. A change applies to new sessions. To change an open session, type /mcp in its message box." |
| `AgentMcpServersSettings.tsx:152-153` | Servers set up in a CLI's own config keep loading as well, and acorn cannot switch them off. MCP config files lists them. | Rewrite | A ghost sm section action, **MCP config files**. |
| `AgentMcpServersSettings.tsx:158` | No servers yet. | Rewrite | No servers. |
| `AgentMcpServersSettings.tsx:195` | Command (stdio) / URL (HTTP) | Keep | |
| `AgentMcpServersSettings.tsx:206` | On for new sessions (switch label) | Keep visible | The plan's overrule keeps "On for new sessions" beside the switch, against the area file's unlabelled switch. |

## What earlier batches give you

- **`formatPath`** (B05), in `packages/client-core/src/kit/lib/rendering/formatPath.ts`, exported from
  `kit/lib/public.ts` (not from `@acorn/plugin-api`). It keeps the last two folders and writes the
  home folder as `~`, recognising `/Users/<name>`, `/home/<name>`, and `C:\Users\<name>`. Put the full
  path in the tip.
- **Sticky headers** (K2): a `sub` heading is static unless it carries `data-sticky`, and a `sub`
  heading after a setting row gets the section gap above it.
- **`help` on `SettingsSection` and `SectionHeader`** (K3).

## Risk and checks

- Before you start, confirm nothing deep-links to the deleted section id. Keep its search keywords
  on Tools and permissions so a search still lands.
- Screens: MCP config files with a populated file (read from code if the fixture has none), and MCP
  servers empty and with one server.
- Tests: client-core (settings search), `plugins/agents`.
