# Tool result size

This page covers the size limit on every result acorn's MCP server returns to an agent, and where the
full text of a longer result goes. See [the MCP overview](../mcp.md#tool-surface) for the server
itself.

The server sends a structured result as compact JSON, with no indentation. It caps every text result
at 32 KiB, about 8,000 tokens, in one place: the `text()` helper and `capToolText`
(`packages/node-core/src/mcp/toolOutput.ts`). Image results pass through unchanged.

A result over the cap keeps its first 24 KiB and its last 8 KiB, because a log or a diff usually fails
at the end. One marker line between them gives the total size in bytes, how many bytes were left out,
and the path of the full text. Each cut moves to a line break when one falls within 1 KiB, so a JSON
line or a diff line stays whole. The full text goes to
`<temp folder>/acorn-tool-output/<task ID>/<call ID>.txt`, readable only by the user. The server
deletes saved files older than seven days when it starts.

The cap lives in the MCP server, not in the Node, because the renderer calls the same tools over HTTP and wants the
whole answer. Without it, the harness trims an oversized result itself: Claude Code 2.1.302 keeps the
head past 25,000 tokens and drops the end, and Codex 0.162.1 cuts the middle at its own token limit.

The agent reads the saved file with its own file tool. A managed Claude Code session gets a read-only
allow rule for its task's folder, `Read(//<folder>/**)`, in the same flag settings as its skill
folders, because Claude Code otherwise asks before it reads outside the worktree. A plain terminal
session still asks. Codex's built-in permission profiles read the whole disk.
