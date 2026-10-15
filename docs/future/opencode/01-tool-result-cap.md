# Phase 1: Cap tool results in one place

Date: October 16, 2026. Status: proposed.

This phase gives every Acorn tool result one size limit, applied where the agent receives it. Read
it before you change what the MCP server returns.

## The problem

`packages/node-core/src/mcp/server.ts` turns every result into text with
`JSON.stringify(value, null, 2)`. That has two costs:

- The two-space indent adds whitespace tokens to every structured result. The model doesn't need
  them.
- There's no size limit. A tool that bounds its own output, such as `task_scripts_logs`, is safe.
  Other tools, such as `local_diff`, `agent_session_read`, and `pr_changed_files`, can return as
  much as the Node holds.

When a result is too big, the harness trims it. Claude Code trims oversized MCP results itself, by
cutting the end. Check that claim, and Codex's behavior, before you start. Losing the end is the
worst cut for a log or a diff, because the failure is usually there.

OpenCode caps every tool result in its registry (`references/opencode/packages/core/src/tool-output.ts`).
Its limits are 2,000 lines and 50 KiB. It keeps the head, saves the full text to a file, puts the
file's path in a marker, and deletes saved files after seven days.

## The change

Change the `text()` helper in `packages/node-core/src/mcp/server.ts`, and nothing else in the call
path:

1. Serialize structured results without indentation.
2. When the text is over the limit, keep the first 24 KiB and the last 8 KiB, and put one marker
   line between them. The marker gives the total size, the bytes left out, and the path of the
   full text.
3. Write the full text to `<os.tmpdir()>/acorn-tool-output/<taskId>/<callId>.txt`. The call ID
   comes from `randomUUID()` in the same handler.
4. When the server starts, delete files in `acorn-tool-output` older than seven days.
5. Leave image results as they are.

Cut on a line boundary when one falls within 1 KiB of the cut point, so a JSON line or a diff line
stays whole.

The limit is a constant beside `text()`, not a setting. 32 KiB is about 8,000 tokens, which stays
under the size where Claude Code starts warning. Measure before you change it.

### Why the MCP server and not the Node

The renderer calls the same tools over HTTP and wants the whole answer. Only agents need the cap,
and every agent result passes through `text()`. A cap in the Node route would cut the renderer's
results too.

### Why a file and not a paging tool

The MCP server projects the Node's tool registry and holds no tools of its own
([MCP](../../mcp.md#tool-surface)). A paging tool would break that rule. A file works with every
harness's own read tool, and the marker tells the agent where to look.

The cost is that the file sits outside the worktree. Check whether Claude Code asks permission to
read it. If it asks, the agents plugin passes the folder with `--add-dir` when it starts a managed
Claude session. A plain terminal session still asks, which is acceptable.

## Tests

Add cases to the MCP server's tests:

- A result under the limit returns unchanged, apart from indentation.
- A result over the limit keeps its head and tail, the marker names the right sizes, and the file
  holds the whole text.
- An image result passes through.
- Startup deletes a file older than seven days and keeps a newer one.

## Done when

- Every agent tool result is compact JSON and is at most 32 KiB plus the marker.
- An oversized `local_diff` shows its last file in the tail, and the agent can read the full diff
  from the saved file in a real Claude Code session and a real Codex session.
- [MCP](../../mcp.md) says that results are capped, where the full text goes, and how long it stays.
- [Agent tools](../../agent-tools.md) says a tool doesn't need its own cap for safety, only for
  usefulness.

## Risks

- A tool that returns large JSON loses its middle. That's the trade OpenCode makes too. A tool
  whose middle matters should page its own output.
- Saved files can hold anything a tool returned, such as issue text or diffs. They stay in the
  user's temp folder with the user's permissions, as the harness's own transcripts do. Don't save
  them anywhere shared.
