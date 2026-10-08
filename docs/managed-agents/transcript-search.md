# Transcript search

Agent Center's search and the archive page's search provider read one SQLite full-text index over a
Node's agent events. This page covers what the index holds, how it stays current, and why it's shaped
this way. The projection is in `plugins/agents/src/server/sessions/searchProjection.ts`.

## Transcript search

`agent_events_fts` indexes `agent_events.search_text`. Migration-owned triggers project standalone
rows and search-text changes, and `AgentSearchProjection` builds streamed message heads before reads
that need them. Both search entrypoints read it, including the archive page's
[search provider](../plugins/search-providers.md#search-providers). When the retention
pass removes a session's history, the delete trigger removes its rows, so archive search finds only
the title and the note.

**The search text stays on the Node.** No client reads `searchText`, and on a tool row it repeated
the title, input, and output, a third of the socket's bytes. The snapshot route, `/events` pages, and
`agent:event` frames leave it out (`clientEventRecord` in `rowMapping.ts`).

## Messages

A streamed message is indexed once, on its first event. A reply arrives as many `append` events, and
indexing each alone meant two words matched only when they landed in one fragment. A fragment that
continues the previous event's stream, by the same rule `durableEventBuffer.ts` coalesces on, adds its
text to the stream's first event. Migration `0005_agent_events_fts_messages.sql` applied this to old
rows: 148,570 fragments became 7,410 messages in 11 seconds on a 1.4 GB database.

A continuation commits without reindexing the head. Migration `0012_agent_search_progress.sql` records
the earliest dirty sequence per session in the same transaction. The projector starts at the head
before it, reads 128 rows at a time, joins each complete message, and writes only changed heads. A
query after every fragment still pays the growing message's indexing cost.

Both search entrypoints catch up every dirty session before ranking, including sessions outside the
task filter, because they affect ranking statistics. Catch-up, ranking, snippets, and session reads
share one transaction. Agent Center sorts tied ranks by session update time, and the archive provider
keeps index order. Raw `snapshot`, `eventPage`, `eventsForTurn`, and `exportSnapshot` reads catch up
their session, so waits, workflows, delegation, forks, and export see whole messages. Client snapshots
skip this, because they carry no search text.

Before the first projection read or event write, the Node reinstalls missing derived objects, checks
the index, and marks sessions for reconciliation. A missing or corrupt index is rebuilt from canonical
message JSON.

## Search from a managed session

`session_history_search` and `session_history_read` let a managed agent recover text from its own
ledger after harness compaction. Both tools require a signed task and session claim. The agents plugin
checks that the claimed session belongs to the task and accepts no session ID in either input. The
read tier admits the tools by default, including in delegated and workflow sessions unless a session's
tool ceiling narrows access. Both tools catch up only the claimed session's search projection before
reading it.

Search uses quoted FTS5 words and returns eight ranked events by default, with a maximum of 20. Its
optional `user`, `assistant`, or `tool` role filter runs before the limit. Each result has an event
sequence, role, timestamp, and an excerpt capped at 600 characters. `session_history_read` accepts that
sequence and a character offset, then returns up to 4,000 characters and `nextOffset` when more remain.
The read uses the materialized head of a streamed message, so a page can reach text from later deltas.
An offset beyond the end returns an empty page.

These tools expose user messages, assistant messages, and tool text. They omit artifact and attachment
payloads. Returned text uses the pasted-content wrapper: an old message is evidence of what appeared
in the session, not a fresh instruction or proof that an action succeeded. Search is lexical, so a
paraphrase can miss.

## Tool rows

A tool call is indexed once, on its latest row, and the opener gives up its search text. A file change
does the same. Tool text ranks below the conversation: it goes in a `tool` column that the stored rank
weighs at 0.3 of `content`, because file dumps and command output buried the conversation.

Search rows are keyed by the event's rowid. Inserts replace on rowid and deletes also check
`event_id`, so a table a VACUUM renumbered repairs itself on the next write. Reconciliation also
detects rowid drift and rebuilds.

## Why the index keeps its own copy

The index stores its own text: 203 MB on the measured database. Pointing it at `agent_events` as
external content would save that, but external content is keyed by rowid, and a VACUUM can renumber
the rowids of a table with a text key, as this one has. This table survives that because every delete
checks `event_id`. An external-content table can't, and a delete naming values it doesn't hold
corrupts it. Making the rowid stable means rebuilding `agent_events` with an integer key and
reindexing every row in a migration, which blocks boot.
