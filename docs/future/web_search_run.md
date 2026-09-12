# Show web activity in managed agent runs

Status: **proposal, 2026-09-12. Not started.** Planned against commit `8cb7ce45`.

Managed agent transcripts must show what an agent searched for, which pages it opened or inspected,
and which sources the provider returned. The same Acorn event and renderer contract must cover Codex,
Claude Code through Agent Client Protocol (ACP), and future harnesses. Provider names and private
history files must not leak past the driver boundary.

The defect is data loss at normalization, not an absent provider feature. Codex sends structured web
activity and Acorn reduces it to a status-only `Web search` row. Claude Code's ACP adapter already
forwards the search input and some result text, but Acorn treats it as an ordinary tool with
provider-authored labels. The two runs therefore show different information for the same activity.

Use this file as the requirements and implementation guide. When every completion criterion passes,
move the shipped contract into [managed agents](../managed-agents.md), update the relevant protocol
and testing documentation, and delete this file.

## Outcome

A reader can answer these questions from the durable Acorn transcript:

- What query or queries did the agent submit?
- Did the agent search, open a page, find text on a page, or fetch a page?
- Which domain filters or page prompt affected the request when the provider reports them?
- Which result titles, domains, URLs, and snippets did the provider return?
- Is the activity pending, running, completed, or failed?
- Which parent or provider-native subagent performed it?

The compact transcript row identifies the activity without exposing a large result set. Opening the
row reveals its parameters and results. Result URLs use real links on desktop and the terminal host's
existing link behavior. A provider that reports only a query still produces a useful card. A provider
that reports no structured web fields still falls back to the generic tool card.

Completion means all of the following are true:

- Codex search, open-page, and find-in-page items retain every bounded field that Acorn can display.
- Claude Code `WebSearch` calls retain their query and domain filters through the ACP driver.
- Claude Code `WebFetch` calls retain their URL and page prompt through the same normalized contract.
- Both providers produce one card per provider call while lifecycle updates fold onto that card.
- One provider-neutral renderer draws every normalized web activity in desktop and terminal clients.
- The renderer contains no branch on `codex`, `claude`, a profile id, or a provider-specific tool name.
- A future driver can opt in by constructing the normalized web payload without changing the renderer.
- Query text and result metadata are searchable through the existing agent event full-text index.
- Provider-owned strings and collections are bounded before they reach SQLite or a client.
- Only safe web URLs become links. Unsupported or malformed URLs remain visible as text.
- Historic rows remain readable without a database migration.
- Tests pin both provider mappings to captured wire shapes and cover the complete normalize, fold, and
  render path.

## Current behavior and evidence

### The Acorn path

Provider events follow this path:

```text
Codex app-server notification or ACP session update
  -> provider driver normalizer
  -> AgentNormalizedEvent { type: "tool", tool: AgentToolCall }
  -> ProviderEventMaterializer bounds large provider data
  -> AgentSessionRepository records event_json and search_text
  -> agent:event WebSocket frame or HTTP session snapshot
  -> buildConversationItems folds updates by turn and tool id
  -> AgentToolCallCard resolves a contributed renderer or GenericAgentTool
  -> shared UI kit renders in the desktop and terminal hosts
```

`packages/protocol/src/managedAgents.ts` owns `AgentToolCall`. It has generic `input`, `output`, and
`paths` fields, but no structured web activity. `agentEventSearchText()` indexes the title, input,
output, and paths.

`plugins/agents/src/client/sessions/conversationItems.ts` folds a tool's updates field by field. A
new optional field must join that merge or the completion update will either erase the start data or
fail to add results.

`plugins/agents/src/client/sessions/toolRendererRegistry.tsx` draws calls with no parameters, output,
or paths as flat rows. That rule explains the Codex presentation: after normalization, a web-search
call contains only an id, title, kind, and status.

The `agents:tool-card` extension point wraps the fallback renderer. It is shared by desktop and the
terminal client. Keep this ownership and replacement path. Do not add a desktop-only transcript card.

### Codex

The installed Codex CLI can generate its app-server schema:

```sh
tmp_dir="$(mktemp -d)"
codex app-server generate-json-schema --experimental --out "$tmp_dir"
```

In Codex CLI 0.154.0, a `webSearch` thread item contains:

- Required `id`, `type`, and `query` fields.
- An optional `action`.
- Optional opaque `results` from standalone web search.
- Item start and completion timestamps on the notification envelope.

The action is one of these shapes:

```ts
type CodexWebSearchAction =
  | { type: 'search'; query: string | null; queries: string[] | null }
  | { type: 'openPage'; url: string | null }
  | { type: 'findInPage'; url: string | null; pattern: string | null }
  | { type: 'other' }
```

Observed result objects include `type`, `title`, `url`, `domain`, `snippet`, `ref_id`, and an optional
`thumbnail_url`. The app-server boundary intentionally types each result as opaque JSON, so the
normalizer must select known display fields and ignore unknown fields.

The official OpenAI Responses API uses the same broad model: a web-search call has an action, and the
caller can request search results or action sources. See the
[OpenAI Responses API reference](https://developers.openai.com/api/reference/cli/resources/beta/subresources/responses).
The generated app-server schema and a checked-in capture remain the implementation authorities for
the CLI protocol that Acorn consumes.

`plugins/agents/src/server/drivers/codexNormalizer.ts` maps `webSearch` to:

```ts
{ id, title: 'Web search', kind: 'search', status }
```

That line discards the query, action, and results before Acorn records the event. The append-only
ledger therefore cannot reconstruct them later.

### Claude Code through ACP

Acorn runs Claude Code through `@agentclientprotocol/claude-agent-acp`. Version 0.54.1 maps Claude's
`WebSearch` tool to an ACP tool call with:

- `_meta.claudeCode.toolName` equal to `WebSearch`.
- `rawInput.query`.
- Optional `rawInput.allowed_domains` and `rawInput.blocked_domains` arrays.
- A provider-authored title containing the query and filters.
- Result content converted to text such as `Title (https://example.com/page)` when the adapter exposes
  result blocks.

The adapter maps `WebFetch` separately. Its input carries `url` and `prompt`, and its ACP kind is
`fetch`, the same kind used by `WebSearch`. The kind alone therefore cannot distinguish search from
page fetch.

`plugins/agents/src/server/drivers/acpNormalizer.ts` already serializes every object-shaped
`rawInput` into `AgentToolCall.input` and joins text content into `output`. This means Claude cards can
show more than Codex cards, but only as generic JSON and provider-formatted text. A managed-run ledger
captured with the installed adapter confirms that the completed Claude tool event retains the query in
`input`.

Do not parse the provider-authored title or parse `Title (URL)` result lines back into structured
data. Both formats belong to the adapter and can change. Use `_meta.claudeCode.toolName` and
`rawInput` for Claude's structured request. Preserve ACP result text in `output` as a fallback. If a
later adapter release exposes structured result metadata, map it from that field after verifying a
capture.

The existing `claudeSubagentWire.json` fixture does not contain a web call. Add a dedicated capture
instead of adding hand-written input alone. This repository treats captures as the defense against an
upstream extension field changing shape.

### Historic data

Existing Codex rows contain no query or results because normalization discarded them before
persistence. Codex rollout files may retain the provider payload, but they are private provider
storage, may be removed independently, and may live on another node.

Do not make transcript reads depend on `~/.codex` or `~/.claude`. Do not add a database migration that
scrapes either directory. The feature applies to events accepted after the driver change. Historic
status-only rows continue to use the generic fallback and remain valid under schema version 1.

## Architectural decision

### Keep web activity inside the tool event

A web search has the same lifecycle and identity as every other tool call. Keep it as:

```ts
{ type: 'tool', tool: AgentToolCall }
```

Add an optional provider-neutral `web` payload to `AgentToolCall`. Do not add a parallel top-level
event kind. A parallel kind would duplicate tool status, output, subagent ownership, event folding,
extension-point rendering, and search indexing.

Use this contract as the starting point. Adjust field names only if the implementation finds an
existing convention that this plan missed:

```ts
export type AgentWebAction =
  | {
      type: 'search'
      queries: string[]
      allowedDomains?: string[]
      blockedDomains?: string[]
    }
  | { type: 'open_page'; url?: string }
  | { type: 'find_in_page'; url?: string; pattern?: string }
  | { type: 'fetch_page'; url?: string; prompt?: string }
  | { type: 'other' }

export type AgentWebResult = {
  url: string
  title?: string
  domain?: string
  snippet?: string
}

export type AgentWebActivity = {
  action: AgentWebAction
  results?: AgentWebResult[]
}

export type AgentToolCall = {
  // Existing fields remain unchanged.
  web?: AgentWebActivity
}
```

The normalized contract describes what happened, not how a provider spells it. Use snake-case action
values because the wire already uses that style for Acorn status and event discriminants. Do not carry
Codex `ref_id`, result `type`, or thumbnail fields until a product requirement uses them. Do not copy
the complete opaque provider object into the ledger.

Keep `input` and `output` populated where useful:

- `input` is the stable plain-text or formatted JSON fallback that the generic card can display.
- `output` retains provider text that has no safe structured mapping.
- `web` drives the dedicated web renderer and structured search indexing.

This small duplication is intentional. If a loaded renderer fails, is absent, or does not understand
the optional field, the generic card still shows the request and output. Do not encode the structured
payload inside `output` and ask the renderer to parse it.

### Normalize at each provider boundary

Each driver owns its provider mapping:

- The Codex normalizer recognizes `item.type === 'webSearch'` and reads the app-server shape.
- The ACP normalizer recognizes Claude `WebSearch` and `WebFetch` through the existing
  `_meta.claudeCode.toolName` namespace.
- A future harness normalizer maps its own confirmed wire shape into `AgentWebActivity`.

Do not put provider recognition in `conversationItems.ts`, `AgentEventCard.tsx`, or a renderer. Those
modules receive normalized Acorn data and must not know which executable produced it.

Do not infer a web action from ACP `kind` alone. Claude's `WebSearch` and `WebFetch` both use `fetch`,
and other ACP harnesses may use `search` for repository grep or file discovery. An ACP harness without
a confirmed tool identity keeps the generic call until its driver can map it safely.

### Use one shared renderer

Add a web-specific fallback component inside the agents client and select it when `tool.web` is
present. Keep the existing `Slot` around it so a compiled or loaded extension can still replace the
card according to `agents:tool-card` arbitration.

The component must use only `@acorn/plugin-api/ui` kit components. `Fold`, `Stack`, `Inline`, `Text`,
`Link`, and `StatusDot` support both desktop and terminal hosts. Do not add DOM-only markup, a plugin
stylesheet, or a TUI-specific copy of the card.

Keep `tool.kind` compatible with the provider's other calls unless implementation proves a stable
canonical value is required for extension matching. The presence of `tool.web` selects the built-in
web fallback. This avoids changing which third-party renderer receives an existing `fetch` or
`search` call.

## Normalization rules

### Codex mapping

Map a Codex start and completion item with the same id to one evolving tool card.

For a `search` action:

1. Read non-empty strings from `action.queries` in order.
2. Fall back to `action.query` when the array contains no usable values.
3. Fall back to the item's required `query` field.
4. Remove exact duplicates while preserving order.
5. Store `{ type: 'search', queries }`.

For `openPage`, store `{ type: 'open_page', url }`. For `findInPage`, store
`{ type: 'find_in_page', url, pattern }`. For `other`, store `{ type: 'other' }`. The item's top-level
query may be empty for page actions. Do not display an empty query as a search.

Set a stable title by action:

| Action | Title |
| --- | --- |
| `search` | `Search web` |
| `open_page` | `Open page` |
| `find_in_page` | `Find on page` |
| `other` | `Web activity` |

On completion, select result rows that contain a non-empty URL string. Read optional string values
for `title`, `domain`, and `snippet`. Ignore every unknown field. URL scheme validation belongs to the
renderer, where it decides between a link and visible plain text. Preserve input fields from the
start event when the completion event omits them. `conversationItems.ts` owns that merge.

### Claude mapping

Extend the existing Claude metadata reader with the tool identity needed by a small web mapper. Keep
the logic inside `acpNormalizer.ts`; a second generic ACP normalizer is not needed.

For `WebSearch`:

- Read `rawInput.query` as the only query when it is a non-empty string.
- Read string entries from `allowed_domains` and `blocked_domains`.
- Store an empty query list only when the provider sent no valid query. The card still settles and can
  display its generic output or error.
- Preserve the existing pretty-printed `input` and text `output`.
- Use the stable title `Search web` instead of the adapter's quoted query title.

For `WebFetch`:

- Read `rawInput.url` and `rawInput.prompt`.
- Store `{ type: 'fetch_page', url, prompt }`.
- Preserve the existing input and output fallback.
- Use the stable title `Fetch page`.

Do not claim that Claude provides structured result snippets through ACP 0.54.1. The installed
adapter converts recognized `web_search_result` blocks to title-and-URL text before Acorn receives
them. If the captured ACP update contains a structured extension field, map that confirmed field and
document the adapter version. Otherwise, leave `web.results` absent and display the text output.

### Future provider mapping

A provider can support this card when its driver can supply at least one of these facts:

- A search query.
- A page URL.
- A find pattern and optional page URL.
- A structured result URL.

The driver must use a provider-issued stable call id and normal tool statuses. It must emit updates
under the same id. Missing optional data must degrade to the generic card instead of preventing event
persistence.

## Bounds and trust

Provider web data is untrusted storage and rendering input. Extend
`plugins/agents/src/server/sessions/boundProviderEvent.ts` so the nested payload receives explicit
bounds before SQLite or WebSocket publication.

Use these initial ceilings unless measurement against real captures supports a smaller value:

- 20 queries per call, 4,096 characters each.
- 50 results per call.
- 500 characters per result title.
- 8,192 characters per URL.
- 253 characters per domain.
- 4,096 characters per snippet.
- 100 domain-filter entries per list, 253 characters each.
- 16,384 characters for a page prompt or find pattern.

Also enforce a 64 KiB serialized ceiling for the complete `web` payload after field bounds. This
matches the existing inline tool input and output budget. Prefer dropping trailing results, then
truncating snippets, before removing the action that explains the call. If useful provider data still
exceeds the ceiling, persist a bounded inline subset and place the full normalized text in an `other`
artifact. Do not place opaque provider JSON in the artifact.

Add the aggregate budget in `ProviderEventMaterializer`, where UTF-8 byte accounting and artifact
promotion already live. Keep per-field and collection validation in `boundProviderEvent`. Test both
layers separately.

Only `http:` and `https:` result or action URLs become links. Parse with `URL`, check the protocol, and
pass the accepted string to the kit `Link`. Show rejected URL text without an anchor. Do not let a
provider emit `javascript:`, `data:`, `file:`, or an Acorn deep link through this card.

Search queries can contain credentials or private text because the agent constructed them from task
context. This feature preserves provider data under the same task authorization as the rest of the
transcript. It must not copy query or result content into telemetry, lifecycle events, session rows,
or notification text.

## Transcript presentation

### Collapsed row

The summary row contains:

- The normal tool status dot and active status label.
- The stable action title.
- A bounded one-line summary: the first query, page host, or find pattern.
- A result count when structured results are present.

Do not put all queries or a URL with a long path into the fold label. Keep the action title as the
accessible label and place the summary beside it using kit text. If `Fold` cannot express that layout
without weakening its contract, add a small optional summary slot to `Fold` only after checking its
other callers and both hosts. Prefer composing the existing `meta` slot when it remains readable with
status and count.

The default open state continues to come from the reader's **Tool call display** setting. Status must
not force the fold open or closed.

### Expanded content

Render only the sections for data that exists:

- **Queries** shows every normalized query in order.
- **Filters** shows allowed and blocked domains.
- **Page** shows the action URL, prompt, or find pattern.
- **Results** shows each structured result as a link title, domain, and optional snippet.
- **Provider output** shows generic text output when no structured result mapping exists or when it
  contains additional information.

Do not render the same query twice from `input` and `web.action`. The web component uses structured
fields first and shows generic input only when it adds information that the structured payload lacks.
Do not render raw JSON for a normal supported call.

The result list retains provider order. Do not deduplicate different titles that point to the same
URL, rank results again, fetch URLs, load thumbnails, or preflight links. The transcript records what
the provider reported; it does not perform another search.

### Copy and accessibility

Every link must expose its title or URL as text. A result with no title uses its URL as the link text.
The terminal rendering must preserve the URL even when it cannot match the desktop's inline layout.

Add a copy action only if the existing tool-card pattern gains one for all tool calls. Do not create a
web-only menu in this work. The event JSON remains available through session export, and visible text
remains selectable.

## Search indexing

Extend `agentEventSearchText()` to include these structured values:

- Queries.
- Allowed and blocked domains.
- Action URLs and find patterns.
- Result titles, domains, URLs, and snippets.

Keep the existing title, input, output, and paths in the indexed text. The index is a task-authorized
discovery aid, not a second copy of provider history. Apply event bounds before building `search_text`
so one provider result cannot create an unbounded full-text search row.

No SQLite migration is required. `agent_events.search_text` and its full-text search triggers already
accept the expanded string for newly inserted events. Existing rows remain unchanged.

## Implementation sequence

### Phase 1: capture both provider contracts

Add focused, sanitized fixtures under
`plugins/agents/src/server/drivers/__fixtures__/`:

- `codexWebSearchWire.json` from a Codex run that performs a search, opens a result, and finds text on
  a page when the CLI supports each action.
- `claudeWebSearchWire.json` from a managed Claude Code ACP run that performs `WebSearch` with a domain
  filter and `WebFetch`.

Record the CLI and adapter versions in each fixture. Keep start and completion updates for the same
calls. Remove unrelated prose, tokens, local paths, and private URLs without changing field names or
nesting. If the capture procedure cannot observe an action, add a schema-derived unit case and label it
as such beside the capture test.

Do not use `~/.codex` or `~/.claude` as a test fixture at run time. The checked-in sanitized capture is
the test authority.

### Phase 2: add and bound the normalized contract

Update:

- `packages/protocol/src/managedAgents.ts` with `AgentWebAction`, `AgentWebResult`,
  `AgentWebActivity`, the optional `AgentToolCall.web`, and expanded search text.
- `plugins/agents/src/server/sessions/boundProviderEvent.ts` with collection and field bounds.
- `plugins/agents/src/server/sessions/boundProviderEvent.test.ts` with malicious URLs, oversized
  strings, excess queries, filters, and results.
- `plugins/agents/src/server/sessions/providerEventMaterializer.ts` with the aggregate byte budget and
  optional artifact promotion.
- A colocated `providerEventMaterializer.test.ts` for inline and overflow behavior.

Do not increment `AGENT_EVENT_SCHEMA_VERSION` for one additive optional field. The row is JSON, readers
already tolerate absent optional tool fields, and historic rows remain valid. Increment the version
only if implementation changes the meaning of an existing stored field.

### Phase 3: normalize Codex and Claude

Update `codexNormalizer.ts` and `codexNormalizer.test.ts` to map every confirmed Codex action and
result. Drive the main cases from `codexWebSearchWire.json`. Include unit cases for malformed optional
fields because Codex result objects are deliberately open.

Update `acpNormalizer.ts` and `acpNormalizer.test.ts` to map Claude `WebSearch` and `WebFetch`. Drive
the main cases from `claudeWebSearchWire.json`. Prove that a non-Claude ACP call with `kind: 'fetch'`
does not gain a web payload, and that an unknown metadata namespace remains generic.

Tests must cover partial lifecycle data:

- Start has the action, and completion adds results.
- Completion repeats the action and remains idempotent after folding.
- Completion omits request fields and keeps the start data.
- A result-only completion adds results without blanking status, title, input, or subagent ownership.
- A failed call preserves the query and error output.

### Phase 4: fold and index structured updates

Update `conversationItems.ts` and `conversationItems.test.ts` so tool updates merge nested web data
field by field. Later actions replace earlier actions only when present. Later results replace earlier
results only when present. An explicit empty result list means the provider completed with no results;
an absent list means unchanged.

Add protocol search-text tests beside the nearest existing `agentEventSearchText()` coverage. Prove
that a session search finds a unique query, domain, URL, result title, and snippet through the existing
repository full-text search path.

### Phase 5: render one card in both hosts

Add a small web card component beside `toolRendererRegistry.tsx`, then use it as the built-in fallback
when `tool.web` is present. Keep the `agents:tool-card` slot outside the selection so contributed
renderers retain precedence.

Add colocated component coverage for:

- Search with one query and no results.
- Multiple queries and domain filters.
- Open-page, find-in-page, and fetch-page actions.
- Structured results with title, domain, URL, and snippet.
- Claude text-only output with no structured results.
- Empty and malformed optional values.
- Failed and in-progress states.
- Safe and refused URL schemes.
- The tool-fold preference in collapsed, expanded, and carry-forward modes.

Use the real kit host switch for a terminal assertion. Do not accept a desktop snapshot as evidence
that the TUI can render and focus links. Add a terminal render or key test that proves every result URL
appears and a focused link uses the host's link action.

### Phase 6: document and verify the shipped behavior

Move the stable contract into these owners:

- `docs/managed-agents.md` for normalization, folding, transcript presentation, provider differences,
  and historic behavior.
- `docs/testing.md` for the capture fixtures and desktop and terminal checks.
- `docs/ui-design.md` only if the work changes a shared kit component contract.

Update comments that still describe the tool-card key or fallback as provider-authored if the final
implementation changes that rule. Remove this file and change its entry in `docs/future/README.md` to
a dated retirement note or fold the history into the existing retired section.

## Files expected to change

The implementation is expected to touch:

- `packages/protocol/src/managedAgents.ts`
- `plugins/agents/src/server/drivers/codexNormalizer.ts`
- `plugins/agents/src/server/drivers/codexNormalizer.test.ts`
- `plugins/agents/src/server/drivers/acpNormalizer.ts`
- `plugins/agents/src/server/drivers/acpNormalizer.test.ts`
- `plugins/agents/src/server/drivers/__fixtures__/codexWebSearchWire.json` (new)
- `plugins/agents/src/server/drivers/__fixtures__/claudeWebSearchWire.json` (new)
- `plugins/agents/src/server/sessions/boundProviderEvent.ts`
- `plugins/agents/src/server/sessions/boundProviderEvent.test.ts`
- `plugins/agents/src/server/sessions/providerEventMaterializer.ts`
- `plugins/agents/src/server/sessions/providerEventMaterializer.test.ts` (new)
- `plugins/agents/src/client/sessions/conversationItems.ts`
- `plugins/agents/src/client/sessions/conversationItems.test.ts`
- `plugins/agents/src/client/sessions/toolRendererRegistry.tsx`
- `plugins/agents/src/client/sessions/webToolCard.tsx` (new)
- `plugins/agents/src/client/sessions/webToolCard.test.tsx` (new)
- The closest TUI transcript or kit-host test
- The owning documentation listed in phase 6

Treat these paths as navigation hints. Read the code and update this list if ownership moves before
implementation.

## Out of scope and refusals

Keep these changes out of this work:

- Reading provider-private rollout or history files during a transcript request.
- Backfilling historic Codex rows from `~/.codex`.
- Performing another HTTP request to enrich or verify a provider result.
- Loading result thumbnails, favicons, previews, or page content.
- Ranking, deduplicating, or rewriting provider results.
- Turning web results into task links, findings, attachments, or integrations.
- Adding a web-search permission model. The harness and its existing execution policy already decide
  whether the call can run.
- Treating repository grep, file globbing, MCP search, or deferred tool discovery as web activity.
- Adding provider-specific rendering or CSS.
- Generalizing every tool call into a new typed-result framework before this feature has a second
  concrete consumer.

Two shortcuts are explicitly refused.

First, setting Codex `input` to `item.query` is a useful emergency patch, but it does not cover page
actions, structured results, Claude consistency, safe links, or future providers. Keep generic input as
the fallback and complete the normalized contract.

Second, parsing Claude's title or output text into results would make Acorn depend on prose formatting
inside an adapter package. Preserve that text, but only structured upstream fields may populate
`AgentWebActivity`.

## Verification and completion gates

Run focused tests while implementing, then use the repository gates:

```sh
pnpm --filter @acorn/plugin-agents test
pnpm --filter @acorn/protocol test
pnpm lint
pnpm test
```

If either package has no direct `test` script, run the nearest documented workspace command rather
than inventing a Turborepo invocation. Use `pnpm test`, not `turbo run test` directly, for the full
suite.

Complete these manual checks with both built-in profiles:

1. Start a Codex run that searches for a distinctive phrase, opens one result, and finds text on that
   page. Confirm one card per provider call and the expected action-specific content.
2. Start a Claude Code run that searches for a distinctive phrase with an allowed-domain filter.
   Confirm the same card layout, query, filter, status, and available output.
3. Run Claude `WebFetch`. Confirm it reads as a page fetch rather than a search and shows its prompt.
4. Start a provider-native subagent in each harness and make the child search. Confirm the card stays
   inside the child transcript and the parent receives no duplicate.
5. Repeat in the terminal client at 80 by 24. Open and close the fold, focus a result link, and confirm
   the URL remains readable.
6. Search Agent Center for the distinctive query, result title, domain, URL fragment, and snippet.
   Confirm the run appears only where the provider supplied that field.
7. Exercise a failed search and an empty result set. Confirm both calls settle without blank cards.
8. Feed `javascript:`, `data:`, `file:`, malformed, and oversized URLs through fixture tests. Confirm
   none becomes an actionable link or exceeds the event bounds.
9. Export the session and confirm the normalized `web` payload is present without opaque provider
   fields or duplicated unbounded output.
10. Open a historic Codex session containing a status-only web row. Confirm it still renders as the
    generic flat `Web search` row.

The work is complete only when the automated gates pass, both live providers pass the manual checks,
the terminal behavior is verified, the owning documentation describes the shipped contract, and this
future file has been retired.

## Verify before building

Before changing implementation code, confirm that this plan still matches the repository and pinned
provider versions:

```sh
git status --short

rg -n "case 'webSearch'|case 'WebSearch'|case 'WebFetch'|toolInput|claudeToolMeta" \
  plugins/agents/src/server/drivers \
  node_modules/.pnpm/@agentclientprotocol+claude-agent-acp*/node_modules/@agentclientprotocol/claude-agent-acp/dist

rg -n "AgentToolCall|agentEventSearchText|mergeToolCall|AGENT_TOOL_CARD_POINT|GenericAgentTool" \
  packages/protocol/src plugins/agents/src packages/client-core/src

rg -n "MAX_INLINE_TOOL_BYTES|boundProviderEvent|ProviderEventMaterializer" \
  plugins/agents/src/server/sessions

codex --version
codex app-server generate-json-schema --help
```

Confirm these assumptions before editing:

- Codex still emits `webSearch` items with a stable id, query, action, and optional results.
- Codex start and completion notifications use the same item id.
- The pinned Claude ACP adapter still forwards `rawInput` and `_meta.claudeCode.toolName`.
- Claude `WebSearch` and `WebFetch` remain distinguishable by tool name, not ACP kind.
- The agent tool-card slot still wraps the built-in fallback and reaches both hosts.
- Tool events still fold by turn and provider call id.
- `agentEventSearchText()` still feeds `agent_events.search_text` before insertion.
- Provider event bounding still runs before persistence and WebSocket publication.
- The worktree's unrelated changes are identified and preserved.

If a provider contract differs, capture the new wire shape first and update this plan's mapping. Do
not repair a changed provider protocol with renderer heuristics.
