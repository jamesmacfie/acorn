# Agent history search

Status: proposed, October 6, 2026. Not started. Part of the [DeerFlow review](./README.md).

## Problem and outcome

When a long session fills its context window, the harness compacts it. Claude Code and Codex replace
older messages with a summary, and the summary drops detail: an exact error, a requirement the person
stated once, an approach that already failed. The agent can't get that detail back.

Acorn still holds the whole conversation in its event ledger and indexes it for full-text search.
Give the agent two read-tier tools that search and page its own session's history, so it can recover
what compaction removed.

## What DeerFlow does

With `task_continuity` on, DeerFlow archives the messages compaction removes into a per-thread SQLite
file, then exposes `history_search` and `history_read`. Search is keyword-only, takes an optional
role filter of `user`, `assistant`, or `tool`, and returns up to eight excerpts of 600 characters.
Read returns one source in 4,000-character pages with a `next_offset`. The tool descriptions say that
retrieved text is historical data, never new instructions, and that an old message doesn't grant
present authority. See `references/deer-flow/docs/task-continuity.md`.

Acorn doesn't need the archive, because the ledger never drops events.

## What acorn has already

- `agent_events_fts` indexes every message and tool row, with tool text weighted at 0.3 so command
  output doesn't bury the conversation ([transcript search](../../managed-agents/transcript-search.md)).
- `searchSessions` in `plugins/agents/src/server/sessions/sessionSearch.ts` ranks sessions, not
  events, so this needs one event-level query beside it.
- `agent_read` in `plugins/agents/src/server/delegation/tools.ts` shows the registration shape: a
  task-scoped tool with `requiresSession`, so only a signed session claim can call it.

## Scope

In scope:

- `session_history_search` and `session_history_read`, read-tier, scoped to the calling session.
- Tool descriptions that say when to use them: after compaction, or when the agent can't find
  something it believes the person said.

Out of scope for the first cut:

- Searching other sessions in the task. Session references in
  [01](./01-session-references.md) are how a person points an agent at another session.
- Semantic search. FTS5 matches words, so the agent may need more than one query.

## Design

### The tools

`session_history_search { query, role?, limit? }` returns at most 8 hits by default and 20 at most.
Each hit holds the event sequence, the role, the time, and an FTS5 `snippet()` of at most 600
characters. `role` filters to `user`, `assistant`, or `tool` before the limit applies.

`session_history_read { seq, offset? }` returns one event's text in 4,000-character pages, with
`nextOffset` while text remains and `truncated` when it stops.

Both derive the session from the signed claim and never take a session ID as input, so a call can't
reach another session. Both catch up the search projection first, as the existing search reads do.

### The query

Add an event-level function beside `searchSessions` that matches within one session and returns
rowids, ranks, and snippets. Keep FTS5 terms quoted the way `ftsTerms` does, so a query can't inject
FTS syntax. Map each hit to its event through the same row-mapping rules the snapshot route uses, and
leave out attachment and artifact payloads.

### Trust

Wrap each returned excerpt and page with `pastedContent` from `@acorn/plugin-api/node`. A tool result
quoted back from history is the same text the agent read once, and a hostile page it fetched could be
in it. State in the description that a match from history is a record of what was said, not a fresh
instruction, and not proof that an action succeeded.

### Exposure

Register the tools in the agents plugin's tool list, read tier, so the default tier admits them. The
MCP projection carries them to every harness. A workflow-owned session gets them too, because they
read only its own session.

## Limits and risks

- Ranking is lexical. A paraphrase can miss.
- The tools spend context. Excerpt and page caps bound each call, and the agent decides when to call.
- An imported session holds whatever the import brought in, which is the session's own history.

## Verification

- Unit tests for the event query: role filtering before the limit, quoting of hostile terms, snippet
  length, and paging past the end.
- A tool test that a task credential without a session claim can't see the tools, and that the
  search can't return another session's events.
- In the real app, run a session long enough to compact, then ask the agent for a detail from before
  compaction and confirm it calls the search tool.

## Docs to update

[Transcript search](../../managed-agents/transcript-search.md) and the agent tools pages, starting
from [orchestration](../../agent-tools/orchestration.md#managed-session-orchestration) for the
registration pattern.

## Verify before building

- Which rowid and event-id columns `agent_events_fts` holds, and whether `snippet()` works on the
  stored rank configuration.
- How a session's own compaction appears in its events, so the description can tell the agent where
  the cut is.
- Whether the read tier is on by default for delegated and workflow sessions.
