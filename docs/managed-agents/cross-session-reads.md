# Cross-session reads

A managed agent can find and read other managed sessions in its own project with three read-tier
tools. This page covers what each tool returns, who may read what, and how pages and cursors work.
`plugins/agents/src/server/sessions/crossSessionTools.ts` owns the tools, and `crossSession.ts` beside
it owns their SQL.

## The tools

The agents plugin contributes three tools:

| Tool | Use it to | Principal inputs |
| --- | --- | --- |
| `agent_session_list` | Find sessions and their tasks by title, newest activity first. | `scope`, `taskId`, `titleQuery`, `includeArchived`, `includeCurrentSession`, `cursor`, `limit` |
| `agent_session_search` | Find words in stored messages and session titles. | `query`, `scope`, `taskId`, `sessionId`, `roles`, `includeArchived`, `includeCurrentSession`, `cursor`, `limit` |
| `agent_session_read` | Read one session, from the start, the end, or around a search hit. | `sessionId`, `aroundSeq`, `start`, `view`, `cursor`, `limit` |

All three are `risk: 'read'` and `requiresSession: true`. The tier permissions, per-tool overrides,
and signed tool ceilings in [permissions](../agent-tools.md#permissions) apply as they do to any
read-tier tool. A person who copies an ID with **Copy session ID**
([client surfaces](./client-surfaces.md#retired-and-archived-sessions)) can paste it into a prompt, and
`agent_session_read` needs nothing else.

## Who can read what

Every call resolves access again. The handler checks that the signed session claim names a managed
session in the signed task. It asks core for that task's project with `tasks.load`, then for every
task in the project with `tasks.inProject`, archived and cancelled tasks included. The plugin filters
its own tables by those task IDs and never reads core's tables. No input names a caller, project, or
Node.

`scope` picks the tasks for a list or a search:

| Value | Tasks |
| --- | --- |
| `task` | The calling task. |
| `other_tasks` | Every other task in the calling project. |
| `project` | Every task in the calling project. The default. |

A `taskId` or `sessionId` narrows the scope and never widens it. A scope with no tasks returns an
empty page that states its effective scope. It never falls through to an unfiltered query, and the SQL
helpers throw on an empty task set. List and search leave out the caller's own session unless
`includeCurrentSession` is true. Archived sessions and sessions in archived tasks are included unless
`includeArchived` is false, and each result marks `archived` and `taskArchived`.

`agent_session_read` takes any session in the project. A missing session, a session in another
project, and a session in a deleted task all return the same `not_found`.

These tools are the only project-wide transcript reads a task credential has. The session HTTP routes,
`agent_read`, and `session_history_*` keep their own task, delegation, and own-session checks.

## List

A list row carries the session ID and title, its task ID and title, the project ID, the session kind,
provider and profile, runtime state, creation and last-activity times, archive marks, and `history`
(`available` or `removed`). It carries no configuration, credentials, standing context, or transcript
text. `titleQuery` matches session and task titles without regard to case. A task title match
includes every session in the task.

Rows sort by last activity, which is `last_event_at`, or creation time before the first event. The
session ID breaks ties. The default page is 20 rows, the maximum 50.

## Search

Search reads the same full-text index as Agent Center
([transcript search](./transcript-search.md#cross-session-search)). It catches up every dirty session
before ranking, so a streamed reply matches as one message. `roles` defaults to `user` and
`assistant`. Add `tool` to search tool titles, inputs, and output. Reasoning, artifacts, attachments,
and file changes are never searched, even though the index holds some of them.

Session titles that contain every query word come first, by last activity. Content hits follow by rank,
then session ID and sequence. Each hit has the session and task IDs and titles, the match type
(`title`, `user_message`, `assistant_message`, or `tool_text`), archive marks, history status, an
excerpt of up to 600 characters, and a `read` object to pass to `agent_session_read`. A content hit
adds its event sequence and time. A title hit has neither.

The default page is 10 hits, the maximum 30. Filters run in SQL before the limit. An empty result
says so and that search is lexical. A failure of the index returns a `failed` error instead, so an
agent can tell the two apart.

## Read

A read returns the session's list row, the view, `history`, `boundarySeq`, the items, `nextCursor`,
and `previousCursor`. Its position comes from at most one of these inputs:

- Nothing: the most recent messages.
- `start: 'beginning'`: the first messages.
- `aroundSeq`: the message holding that sequence, with about half the page before it.
- `cursor`: a page continuing an earlier read, forward or back.

The `conversation` view returns user and assistant messages, errors, diagnostics, and `failed` or
`stopped` session states. `with_tools` adds one item per tool call with its name, status, exit code,
input, and output. Reasoning, session configuration, attachments, artifacts, and provider metadata
never appear. Each item has a role, a time, `fromSeq` and `toSeq`, and its text in the pasted-content
wrapper.

Streamed fragments fold into one message by the rule the search index uses. A tool call appears once,
at its latest row inside the boundary. A page holds up to `limit` items, 20 by default and 50 at most.
The whole response, pretty-printed as the MCP server sends it, stays under 64 KiB. An item that doesn't
fit is split, its `textRange` says which characters it holds, and `nextCursor` resumes inside it.

The first page captures `boundarySeq`, the session's last event sequence. Every later page reads only
up to it, so the session can keep running while an agent pages through it. A cursor binds the session,
view, boundary, and position. A list or search cursor binds a hash of the request's filters and the
caller. A cursor that doesn't decode, belongs to another request, or names a boundary past the
session's last event returns `bad_request`.

A session whose history the retention pass removed returns `history: 'removed'` and no items. That
answer also ends a read in progress. A retained session with no messages returns an empty page.
Reading changes nothing: it doesn't mark the session read, withdraw a delegation report, or reach the
running agent.

## Limits

- Search pages by offset. New events can move a hit between pages, so a page can repeat or skip one.
- Search is lexical. A paraphrase can miss.
- Other projects, workspaces, and Nodes are out of reach. So is the content of an attachment or
  artifact.

## Why

Copied text from another conversation is evidence, not an instruction. The tools wrap every excerpt
and message in the pasted-content wrapper, and their descriptions tell an agent to cite the session
and sequence and to read the context around a hit before calling it a decision.

The project boundary comes from core on every call rather than from the cursor, so a cursor holds a
position and nothing else. Forging one moves the read within a session the caller may already read.
