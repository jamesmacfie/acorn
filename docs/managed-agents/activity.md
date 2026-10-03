# Web activity and file changes

The transcript shows what an agent searched for and opened on the web, and what it did to each file.
This page covers the structured fields behind those cards and how each driver fills them.

## Web activity

A web call is a tool call with an optional `web` field, not an event type of its own, because it has
the same identity and lifecycle as any other tool call:

```ts
type AgentWebAction =
  | { type: 'search'; queries: string[]; allowedDomains?: string[]; blockedDomains?: string[] }
  | { type: 'open_page'; url?: string }
  | { type: 'find_in_page'; url?: string; pattern?: string }
  | { type: 'fetch_page'; url?: string; prompt?: string }
  | { type: 'other' }

type AgentWebStatus = { code: number; text?: string }
type AgentWebActivity = { action?: AgentWebAction; results?: AgentWebResult[]; status?: AgentWebStatus }
type AgentToolCall = { /* … */ web?: AgentWebActivity }
```

The names are acorn's. Every field is optional, because a provider reports the request and the
sources on different updates, so absent means unchanged. `input` and `output` stay filled, for a
renderer that doesn't know the field.

**Each driver owns its mapping.** The Codex normalizer reads `item.type === 'webSearch'`. The ACP
normalizer reads `_meta.claudeCode.toolName`, not ACP's `kind`, because Claude's `WebSearch` and
`WebFetch` both arrive as `fetch`. An ACP harness the driver doesn't recognize keeps the generic card.

**The row is named after the action:** `Search web`, `Open page`, `Find on page`, `Fetch page`,
`Web activity` for an unnamed action, and `Web search` before the call says. The table is in
`plugins/agents/src/server/drivers/webActivity.ts`, shared by both drivers. The query goes in the
row's summary slot, not the title, because it can be a paragraph.

The sanitized captures in `plugins/agents/src/server/drivers/__fixtures__` are the authority:

- Codex sends nothing on `item/started`. The query is empty and the action and results are null, so
  the fold assembles the call. The same model reported reading a page once as `openPage` and once as
  `other`.
- Claude Code forwards structured results on `_meta.claudeCode.toolResponse.results`, so a Claude
  card lists the same sources a Codex card does.

Claude reports no domain for a result and Codex does. The card reads the host from the URL when the
field is absent.

**A fetched page's HTTP status is its own field,** from `toolResponse.code` and `codeText`. Claude
Code reports a 404 as a completed call, so without the status a missing page would show a green dot.
The open card shows the status. The closed row shows it only outside 2xx, in the warning tone.

**The payload is bounded twice** in `plugins/agents/src/server/sessions/boundProviderEvent.ts`: each
string and list, then the whole payload against the 64 KiB inline tool budget. Overflow drops
trailing sources only. Web data isn't moved to an artifact the way command output is.

**Only `http:` and `https:` URLs become links.** Anything else shows as text, so no result becomes a
`javascript:`, `data:`, `file:`, or acorn deep link. The stored URL is kept whole.

Queries and result metadata feed `agentEventSearchText()`, so Agent Center finds a run by what it
searched for. Nothing about a web call reaches telemetry, lifecycle events, session rows, or
notifications, because a query can hold anything the task context held.

`plugins/agents/src/client/sessions/webToolCard.tsx` draws the card for both hosts when `tool.web` is
present, inside the `agents:tool-card` slot, so a contributed renderer still wins. In the terminal
client, a focused result link prints its address on the next line. Codex rows recorded before this
field existed hold no query and draw as a flat `Web search` row. A transcript read doesn't touch
`~/.codex` or `~/.claude`.

## File changes

A `file_change` event records what one step did to a file. Its `patch` is that file's unified hunks,
from the first `@@`, with no file header. Codex's whole-turn diff is the exception: it has no `path`,
and its `patch` is a multi-file Git patch. The diff is what the step did when it ran, so a later edit
to the same lines leaves it as it was.

```ts
type FileChange = {
  type: 'file_change'
  path?: string
  patch?: string
  summary?: string
  subagentId?: string
  changeId?: string        // the tool call, Codex item, or `turn:<id>` this belongs to
  snippet?: boolean        // the hunks count lines from an excerpt, not the file
  patchArtifactId?: string // the patch went to this artifact instead
}
```

Agents report one edit more than once, so `changeId` names the edit. The transcript keeps one row per
change ID and path, with the latest report, where the first one opened. The ledger stores the first
report and the latest ([the transcript store](./transcript-store.md)).

Each driver builds the patch from what its provider sends:

- **Codex** sends `changes: [{ path, kind: { type }, diff }]` on the item and on each patch update. An
  update's `diff` is headerless hunks. An added or deleted file's `diff` is the whole text, which the
  normalizer turns into hunks.
- **ACP** diff blocks carry `path`, `oldText`, and `newText`, which the normalizer diffs. A missing
  `oldText` is a new file. Claude's adapter first sends the edit's `old_string` and `new_string`, so
  that change is marked `snippet` and its line numbers are left blank. Once the edit runs, the adapter
  sends each real hunk with its first line in `locations`, and those replace the excerpt.

A patch over 64 KiB goes to an artifact, and the event keeps `patchArtifactId` instead.
[The transcript](./transcript.md#file-tool-cards) covers how a tool card draws these diffs.
