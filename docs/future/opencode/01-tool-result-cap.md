# Phase 1: Cap tool results in one place

Date: October 16, 2026. Status: done on October 19, 2026.

## Completion note

October 19, 2026. Landed on branch `phase-1-tool-result-cap`.

What landed:

- `text()` in `packages/node-core/src/mcp/server.ts` sends compact JSON and caps every call's text
  result at 32 KiB. The cut, the saved file, and the seven-day sweep live in
  `packages/node-core/src/mcp/toolOutput.ts`. The server runs the sweep after it connects.
- A cut result keeps its first 24 KiB and last 8 KiB, with this marker line between them:
  `[acorn cut this result: <total> bytes in all, <omitted> left out here. Read the full text from <path>]`.
  When the file can't be written, the marker says so instead of naming a path.
- Saved files go to `<os.tmpdir()>/acorn-tool-output/<taskId>/<callId>.txt`. The folder is mode 700
  and each file is mode 600, because Linux's `/tmp` is shared.
- The managed Claude Code harness adds `Read(//<that task folder>/**)` to its flag settings' allow
  list, beside the skill folders. So every managed Claude session sends a `permissions.allow` list,
  even one with no skills.
- Docs: a new [tool result size](../../mcp/result-size.md) page, one sentence in [MCP](../../mcp.md),
  and a safety rule in [agent tools](../../agent-tools.md). Two site pages say the same for users and
  plugin authors.

What I checked first:

- Claude Code 2.1.302, read from its binary, cuts an MCP result past 25,000 tokens
  (`MAX_MCP_OUTPUT_TOKENS`). It keeps the head and appends `[OUTPUT TRUNCATED`. The doc's claim
  holds.
- Codex 0.162.1 cuts the middle at `tool_output_token_limit`, with a "tokens truncated" marker. So it
  already kept the tail. The cap still matters for Claude and for token cost.
- `claude -p` in default mode refused a Read of a file in the temp folder. Both `--add-dir` and a
  `Read(//…/**)` allow rule cleared it.
- With my branch's MCP server against the live Node, an 80,434-byte `local_diff` came back as
  32,824 bytes. Its tail held the diff's last line. A real Claude Code session read the saved file
  with no permission prompt. A real Codex session read it from its read-only sandbox.

Deviations:

- The doc said `--add-dir`. Managed Claude sessions start through the ACP adapter, which takes no
  command line, so I used a read-only allow rule, the same seam the skill folders use. It also grants
  no write access.
- The constants sit in `toolOutput.ts`, not beside `text()`. The agents plugin imports
  `toolOutputDir` through `@acorn/plugin-api/node`, and importing `server.ts` would pull in the MCP
  SDK. That added a node-core export, so the export limit in `tools/arch/boundaries.test.ts` went
  from 67 to 68.
- The sweep deletes old files but leaves empty task folders. Removing a folder could race another
  server writing into it.
- A Claude Code session in the terminal drawer still asks before it reads the file, as the doc
  allowed. Headless workflow steps run in `auto` mode and weren't tested.

For later phases:

- Phase 4 can rely on the cap. A script tool's result goes through `text()` like any other call.
- A tool whose middle matters should page its own output. JSON results are one line after
  compaction, so their cuts never land on a line break.

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
