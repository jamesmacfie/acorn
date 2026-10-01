# 06-1. Tools and permissions shows people text written for the model

**Status:** not started. Batch B06. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Each tool row on Tools and permissions uses the tool's MCP `description` as its description. That
text is written for an agent, not a person. `agent_spawn` runs 14 lines and says "From a terminal,
use agent_wait and agent_read". `agent_read` says "Pass nextCursor back as afterSeq". `run_status`
shows a type. The page is about 5,000 pixels tall for 52 switches most people never touch. Someone
who opens it wants to decide whether an agent may do a thing, and meets paragraphs addressed to
someone else.

## Where to see it

Settings › Tools and permissions. Scroll through **Tools**, and switch the section's control between
**By owner** and **By tier**.

## Already done

- K5 gave the group headings, owner chips, and their tips plugin names through `pluginLabel`, and
  sorts the groups by name. `core` reads **acorn**. The label part of this finding is finished.

## The fix

This is the UI-only mitigation. The client holds only `name`, `description`, `risk`,
`availability`, and `owner` for each tool, so the full fix (a person-facing `title` and `summary` on
the tool contribution) is deferred. See [deferred.md](../deferred.md).

- `packages/client-core/src/features/settings/AgentToolsSettings.tsx`, around lines 152-187: the
  row description becomes the first sentence of `description`.
- Split only at a period followed by whitespace and a capital letter, or at the end of the text. A
  plain `[.!?]\s` split cuts `run_status` at "url?".
- The rest of the text, and `availability` for a conditional tool, goes to the row's `help`.
- The row label stays the tool id.
- About five tools keep a model-facing first sentence, among them `memory_write`,
  `plugin_authoring`, `agent_spawn`, and `browser_snapshot`. That is the limit of a UI-only fix. List
  the ones that stay model-facing when you finish.

## Copy

From `AgentToolsSettings.tsx`. Row 701 (the acorn MCP server text) belongs to
[06-8](./06-8-mcp-pages.md). Row 696 belongs to [06-18](./06-18-smaller-defects.md).

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `:102`, the **Tiers** section | Which tools the acorn MCP server exposes to agents, by how much a tool can do. Changes apply on the next availability evaluation; live sessions receive a tool-list update. Proposed memory always stays behind the human review gate regardless of these switches. A custom agent's Acorn tools setting can narrow this further, never widen it. | Move to `help`, rewrite | Controls which acorn tools agents can use. Running sessions pick up a change right away. Memory an agent suggests always waits for your review. A custom agent can be limited further, but never given more. |
| `:27`, Read tier | Inspect context, notes, memory, git and the PR. No side effects. | Rewrite | Look at the task, notes, memory, git, and the pull request. Changes nothing. |
| `:28`, Write tier | Create or edit notes and propose memory (proposals stay human-gated). | Rewrite | Write notes and suggest memory for you to review. |
| `:29`, Execute tier | Drive the preview browser and run targets in the worktree. Off until you turn it on, including for tools added by a later release. | Rewrite, split | Inline: "Use the preview browser and start run targets. Off until you turn it on." Help: "Execute tools added in a later version of acorn start off too." |
| `:137` | Each tool on its own. A tool's switch wins over its tier's. | Rewrite, keep inline | A tool's own switch overrides its tier. |
| `:167`, each row | {tool description} {availability} | Rewrite | The first sentence. The rest goes to `help`. |

## What earlier batches give you

- **`help` on `SettingRow` and `SettingsSection`** (K3). Pass a string. The row draws a "?" after
  its label, and the text opens on hover, focus, or tap. Do not wrap the title in your own markup.
  See [the help-mark rule](../house-patterns.md#the-help-mark).

## Risk and checks

- Before you start, confirm the line numbers above against the file.
- The split is a string function. Test it on every tool description in the catalog, and list the
  tools whose first sentence stays model-facing.
- Screens: Tools and permissions, top, the plugin groups, the bottom, and **By tier**.
- Tests: the client-core suite and `plugins/agents`.
