# Rollbar browse pane — master/detail plan

> **Executor instructions:** This is a design and implementation plan, not shipped behaviour. Read
> it fully before changing code. Preserve the provider/plugin boundaries described below. Run every
> verification gate. If a STOP condition occurs, report it instead of improvising a new contract.
>
> **Drift check:** planned against commit `8936e60` on 2026-07-11. Before implementation, run:
>
> ```sh
> git diff --stat 8936e60..HEAD -- \
>   apps/desktop/src/plugins/rollbar \
>   apps/desktop/src/app/client/providerContributions.tsx \
>   apps/desktop/src/app/client/taskPaneContributions.tsx \
>   apps/desktop/src/core/shared/api.ts \
>   apps/desktop/src/core/client/queries.ts \
>   apps/desktop/src/core/shared/publicApi/rollbar.ts \
>   apps/desktop/src/core/client/tasks/task-view.css
> ```

## Status

- **Implemented (2026-07-11, commit `8936e60` base):** Phases 1–5 built and shipped behind the
  automated gates (`pnpm --filter @acorn/desktop test`, `pnpm lint`, `pnpm test`, desktop build all
  pass). Summary/detail split, mirror membership semantics, pagination + 300-cap, occurrence
  normalization + privacy allowlist + caps, honest list/detail routes, public-API schemas, the
  two-column Source, the reusable `RollbarItemPanel`, and the feature-owned `rollbar.css` are all in.
  Durable contracts are captured in `docs/{integrations,panes,caching,security,api-reference,frontend}.md`.
- **⚠️ Not done — needs a live Rollbar project:** Phase 0's **live** contract spike and the manual
  visual/interaction QA (§"Manual visual and interaction QA") were NOT run — no Rollbar credentials
  were available. Upstream shapes (`last_occurrence_id`, instance `data.body` layout, `in_app`,
  `context.pre/post`, `resolved_in_version`, `assigned_user_id`) were authored from Rollbar's public
  API docs, not verified against real payloads. The normalizer treats every field as possibly absent
  or mistyped and degrades gracefully, but field-name accuracy must be confirmed against a live
  project before this proposal is removed from `docs/next/`. Web navigation does not depend on
  account/project slugs: items use Rollbar's global item permalink and occurrences use its documented
  UUID redirect.
- **Original status:** proposed; API research and codebase survey complete
- **Priority:** P1
- **Effort:** L (several days, including the API contract spike, fixtures, tests, and visual QA)
- **Risk:** medium; the UI is straightforward, but Rollbar occurrence payloads are variable and can
  contain sensitive or very large values
- **Depends on:** none
- **Scope:** Rollbar Source browse, Rollbar task-pane detail, provider read model, and their shared
  contracts
- **Planned at:** commit `8936e60`, 2026-07-11

## Decision

Build the Rollbar **Source browse** as a two-column master/detail surface:

- active Rollbar items on the left;
- the selected item's metadata and latest occurrence on the right;
- an explicit `+ ws` action creates or focuses a task;
- an explicit `Attach to task` action links the selected item to the active task;
- the task's existing Rollbar pane reuses the same detail component.

The first release remains **read-only against Rollbar** and continues to accept a project token with
`read` scope. It uses Rollbar's REST API through Acorn's existing provider resource runtime. Do not
add the Rollbar notifier SDK and do not embed Rollbar's MCP server: both solve different concerns and
would bypass Acorn's encrypted connection, local mirror, request budgets, and stale-cache behaviour.

The meaningful detail is not another copy of the list row. It is a normalized, privacy-safe view of
the **latest occurrence**: exception/message, stack frames, code context where supplied, request
method and URL, code version, runtime context, server identity, and a deliberately small person
summary. Raw occurrence JSON is not persisted or rendered in P1.

## Why this matters

`RollbarBrowse.tsx` is currently a single-column launcher. Clicking a row starts task promotion; it
does not let someone diagnose the error in Acorn. `RollbarPane.tsx` then resolves the linked item but
shows only the same summary facts already present in the list. The upstream detail call is therefore
paying for no additional product value.

Rollbar's API exposes enough read data to make this pane useful: filtered item lists, canonical item
metadata, an item's occurrences, and an occurrence's raw diagnostic payload. The official Rollbar
MCP server independently validates the useful product cut: its `get-item-details` tool fetches item
details plus the latest occurrence, while its broader tools cover list filters, deploys, versions,
replay, and optional item updates. P1 should implement that same diagnostic core through Acorn's
native provider architecture.

## Current architecture and blast radius

### Current UI

- `apps/desktop/src/plugins/rollbar/client/RollbarBrowse.tsx`
  - uses `createResource`, not the shared TanStack Query layer;
  - calls `GET /api/rollbar/items` and silently converts any error into an empty list;
  - renders one flat list in `<main class="panes panes-empty">`;
  - treats whole-row click as “open as task”;
  - exposes a separate `＋task` button for the active task;
  - has no selection or detail state.
- `apps/desktop/src/plugins/rollbar/client/RollbarPane.tsx`
  - is the task pane for one or more `task_links`;
  - shows a chip strip when several Rollbar items are linked;
  - fetches the selected item by connection id + visible counter;
  - renders only title, level, status, environment, counts, and first/last timestamps.
- `apps/desktop/src/plugins/linear/client/LinearBrowse.tsx` is the shipped reference for local,
  session-only selection and two-column layout. `LinearIssuePanel.tsx` is the reference for one
  reusable detail renderer serving both a Source detail column and a task pane.

Rollbar currently borrows CSS classes named `.linear-browse-*`. This is an implicit cross-plugin
coupling, not a reusable component contract. New Rollbar markup must use Rollbar-owned class names
and a feature-owned stylesheet. A large generic “master/detail component” is not warranted by two
providers whose row content, actions, empty states, and detail lifecycles differ.

### Current server and cache flow

```text
RollbarBrowse / RollbarPane
  -> /api/rollbar/items or /api/rollbar/items/:counter?integration=<connection>
  -> rollbar provider router
  -> runProviderResource('rollbar.items')
  -> encrypted project token + request scheduler
  -> Rollbar REST
  -> generic issues table (JSON summary/detail envelope)
  -> response + browser cache
```

Important facts from the current implementation:

- A connection represents exactly one Rollbar project and stores one encrypted project token.
- Connection validation calls `GET /project`; normalized capabilities currently declare `read`.
- The list calls `GET /items?status=active`, which returns the first page only.
- Rollbar returns 100 items per list page by default. The current provider budget says `maxPages: 3`
  but the implementation does not paginate.
- List refresh deletes every cached item absent from that first page. That is only safe if the list
  is complete; it is unsafe for projects with more than 100 active items.
- Item lookup uses the visible project counter (`#142`). Rollbar mutations and occurrence-list calls
  use the separate system-wide item id. The list response already contains that system id, but Acorn
  currently discards it.
- The codec currently uses `RollbarItem` for both summary and detail. `toPublic` always returns the
  summary, so detail fetches cannot expose richer data.
- `issues.data` has a provider-owned JSON envelope capped by `maxCachedItemBytes` (256 KB). If an
  encoded detail is too large, the generic codec drops the entire detail. P1 must normalize and cap
  occurrence data before that generic last-resort truncation runs.
- The list TTL is two minutes and stale data is served while background revalidation runs. This
  behaviour is worth preserving.
- Multi-connection list aggregation permits partial success and sorts all projects by last seen.

### Data-model decision: keep the existing mirror

P1 does **not** need a migration. Continue using one `issues` row per
`(userId, integrationId, counter)` with a versioned envelope:

```ts
CachedExternalItem<RollbarItemSummary, RollbarItemDetail>
```

The list refresh writes `summary` and preserves an existing `detail`. The detail refresh writes the
normalized detail and preserves the summary plus the item's list-membership timestamp. This is the
same summary-preserves-detail model already used by Linear.

There is one subtle invariant to make explicit: `listFetchedAt` and `detailFetchedAt` describe two
different resources. A detail fetch must not make an item appear in the current list, and a list
fetch must not pretend the existing detail is fresh. The current Rollbar codec conflates them.

For a complete current-list view without adding a list-cache table:

1. Fetch active pages sequentially up to `provider.budgets.maxPages` (three pages / 300 items).
2. Give every summary in that refresh the same `listFetchedAt = context.now`.
3. Record that same time in the list's `sync_state` row.
4. When reading the list, return only cached envelopes whose `listFetchedAt` equals that list
   resource's `sync_state.fetchedAt`.
5. Do not delete an older item merely because it is absent from the active list. It may be resolved
   but still linked to a task, where its cached detail is valuable offline. Older rows remain
   invisible because they do not carry the current membership timestamp. A later retention sweep may
   prune old, unlinked rows as a separate policy decision.
6. A detail write must preserve an existing `listFetchedAt` and use its own `detailFetchedAt` for
   freshness.

This makes the 300-item cap honest and keeps stale rows out of the visible list. If later phases add
arbitrary status/search queries with independent paging, add a generic provider-list cache or
query-membership store then; do not overload one `listFetchedAt` with several simultaneous lists.

## Rollbar API and SDK capability map

All P1 calls use a **project access token with `read` scope**. Rollbar documents `read` as allowing
GET requests, while `write` is required for PATCH and DELETE. A project can issue a combined
read/write token, but Acorn must not silently assume that the current token has write access.

| Capability | Official surface | Token / plan constraint | UI mapping | Plan |
| --- | --- | --- | --- | --- |
| List items | `GET /items` | Project `read`; 100/page | Left column | P1 |
| Filter items | `status`, `level`, `environment`, `framework`, assignment, snooze, and Rollbar query syntax | Project `read` | Status/project/level/environment filters and server search | P2; P1 filters the loaded active set locally |
| Resolve counter to item id | `GET /item_by_counter/:counter` (301 to canonical item) | Project `read` | Transparent fallback for old task links | P1 |
| Get canonical item | `GET /item/:itemId` | Project `read` | Header/facts and internal id | P1 |
| List item occurrences | `GET /item/:itemId/instances`, newest first, cursor/page/limit | Project `read` | Latest occurrence in P1; occurrence history in P2 | P1/P2 |
| Get occurrence | `GET /instance/:occurrenceId` | Project `read`; raw payload can be large/sensitive | Stack, message, safe context | P1, normalized only |
| Item metrics | `POST /metrics/items` with project read token | Read operation despite POST | Trend/velocity graph | P2 |
| Deploys and versions | Deploy and Versions APIs | Some value depends on `code_version`, deploy reporting, and plan | “Introduced after deploy” context | P2 |
| Change item state | `PATCH /item/:itemId` | Project/account `write` | Resolve/reopen/mute; optional resolved version | P2, after explicit write capability |
| Change level/title/assignment/snooze | Same PATCH endpoint | `write`; team/snooze features can be plan-limited; useful assignment pickers may need account data | Triage actions | P3 unless there is a concrete demand |
| Session replay | Replay GET using environment/session/replay ids | Project `read`; only when replay data exists | Open/replay experience | P3; payload and privacy model first |
| RQL | Asynchronous RQL jobs | Rollbar Analyze (Advanced/Enterprise); examples use account read tokens | Arbitrary analytics | Not part of this pane |
| Comments | No item-comment API is documented in the public item surface | — | No composer | Not planned |
| Notifier SDKs | Language SDKs report occurrences into Rollbar | Post-item tokens; wrong direction | None | Do not add |
| Official Rollbar MCP server | Separate stdio tool server for agents | Own token/config/process | Useful parity reference, not an app dependency | Do not embed |

### Why direct REST is the correct integration

The current thin `rollbarFetch` client is the correct abstraction. The notifier SDK is for sending
application errors, not browsing and triaging them. Running the official MCP server inside Acorn
would introduce a second credentials/configuration path and process, return data outside the local
mirror, and duplicate tools that Acorn's own MCP/context spine should expose from linked task data.

The official MCP server is still a useful product reference: it pairs item details with the latest
occurrence, caps returned content, supports multiple projects, lists and filters items, and treats
updates as an optional write-scope capability. Match those principles in Acorn's native layers.

## Required API contract spike

Rollbar's reference pages document endpoints and parameters more reliably than full response
schemas. Before defining final TypeScript types, validate sanitized shapes for:

1. `GET /project`
2. `GET /items?status=active&page=1`
3. `GET /item/:itemId`
4. `GET /item/:itemId/instances?limit=1`
5. `GET /instance/:occurrenceId`

Use a disposable test project or existing development connection. Never commit a token, raw request
headers, cookies, POST bodies, person values, IP addresses, or arbitrary `custom`/`extra` data.
Create minimal synthetic fixtures that retain only field names and type/shape variants needed by the
normalizer.

The spike must answer these questions before implementation continues:

- Does `fetch` following `item_by_counter` reliably return the canonical item body, or should Acorn
  read the redirect location/item id explicitly?
- Which item response field reliably identifies the latest occurrence?
- What are the exact response envelopes for instance lists and instance detail?
- Item navigation uses the system-wide item ID at `https://rollbar.com/item/:itemId/`; occurrence
  navigation uses Rollbar's documented `/occurrence/uuid/?uuid=...` redirect. Neither path derives
  account or project slugs from the display label.
- How are `trace`, `trace_chain`, `message`, and crash-report bodies represented in actual payloads?
- Which fields indicate in-project frames, code context, telemetry, session id, and replay id?
- Are assignment and resolved-version fields consistently present or plan-dependent?

If an occurrence omits its UUID, return `url: null` and omit that occurrence's link. Do not guess a
slug-based URL.

## Target user experience

```text
┌────────────────────────────────┬──────────────────────────────────────────────────┐
│ Rollbar · active     [Refresh] │ Rollbar · api-service · #142      [Open ↗]      │
│ [search] [project] [level]     │ TypeError: token is null                         │
│                                │ [error] [active] [prod]  ×142  last seen 3m      │
│ ● #142 TypeError… prod 3m [+ws]│                                                  │
│ ● #118 Timeout…   prod  1h     │ Latest occurrence · 3 minutes ago                │
│ ● #103 Warning…   stage 2h     │ TypeError: token is null                         │
│                                │   auth/session.ts:84  readSession                │
│                                │   api/login.ts:31      login                     │
│                                │                                                  │
│                                │ Request  POST /api/login                         │
│                                │ Version  aabbcc1 · Node 26 · host api-2          │
│                                │ Person   user-123                                │
│                                │                                                  │
│                                │ [Attach to current task] [Open as task]          │
└────────────────────────────────┴──────────────────────────────────────────────────┘
```

### Left column: active items

- Use the same column proportions as Linear:
  `clamp(320px, 28vw, 420px) minmax(0, 1fr)`.
- Row click selects; it never creates or attaches a task.
- Selected identity is `(integrationId, counter)`, not counter alone. Different Rollbar projects can
  both contain `#142`.
- Selection is a local signal and resets when the routed repo/workspace changes, matching Linear.
- A hover/focus-revealed `+ ws` button preserves task promotion without making it the primary row
  action.
- If an active task already links the same `(connection, counter)`, `+ ws` focuses that task instead
  of creating a duplicate. Match Linear's current behaviour.
- Keep `Attach to current task` in the detail action bar. Disable it with an explanatory tooltip when
  there is no active task; after success show a non-blocking status and make repeat clicks idempotent.
- Show the connection/project label in the row or as a compact chip when more than one Rollbar
  connection contributes results.
- Provide local controls over the loaded active set:
  - case-insensitive title/counter search;
  - project/connection;
  - level;
  - environment.
- Sort by latest occurrence descending. Do not invent priority scoring.
- Show a clear partial-result banner when one connection failed while another succeeded. Do not turn
  transport/auth failures into “No active items”.
- If exactly the three-page cap is returned for a connection, state “Showing the 300 most recent
  active items” rather than implying completeness.

### Right column: reusable item panel

Create `RollbarItemPanel.tsx`, analogous in responsibility to `LinearIssuePanel.tsx`, with a pane
variant that can be mounted by both `RollbarBrowse` and the task-pane contribution.

The panel contains:

1. **Header** — connection/project label, visible counter, title, and verified external link.
2. **Triage facts** — level, status, environment, total occurrences, first seen, last seen, resolved
   version when present, and assignment when present.
3. **Latest occurrence** — timestamp and occurrence id, then one of:
   - exception trace or trace-chain;
   - message body;
   - a small “unsupported crash report; open in Rollbar” state.
4. **Stack frames** — exception class/message plus frames in Rollbar's supplied order. Show filename,
   line/column, method, and bounded code context. Visually distinguish in-project frames only when
   Rollbar explicitly provides that signal.
5. **Safe context** — request method + URL, application context, code version, platform/language/
   framework, server host/branch, notifier name/version, and a minimal person identity.
6. **Actions** — attach to active task, open/focus task, manual refresh, and optional external link.

The panel must have independent states for:

- no selection;
- summary visible while detail loads;
- full detail;
- stale cached detail while revalidation fails;
- item available but latest occurrence unavailable;
- authentication failure;
- upstream rate limit/unavailable;
- normalized detail truncated by Acorn's explicit caps.

When a task links several Rollbar items, preserve the existing chip strip and pass its selected target
to `RollbarItemPanel`. `RollbarPane.tsx` should become a thin selection wrapper or be replaced by a
small `RollbarTaskPane` in `taskPaneContributions.tsx`, matching the Linear task-pane shape.

## Public contracts

Replace the current “same type for list and detail” contract with explicit shapes. Exact optional
fields must be finalized by the contract spike, but the boundary should have this form:

```ts
export type RollbarItemSummary = {
  integrationId: string
  integrationLabel: string
  identifier: string       // project-visible counter
  itemId: string           // system-wide id, represented as string at Acorn boundaries
  url: string | null       // account-independent item permalink
  title: string
  level: string
  environment: string
  status: string
  totalOccurrences: number
  firstOccurrenceAt: number | null
  lastOccurrenceAt: number | null
  framework?: string
}

export type RollbarStackFrame = {
  filename: string
  line: number | null
  column: number | null
  method: string | null
  code: Array<{ line: number; text: string }>
  inProject: boolean | null
}

export type RollbarOccurrenceDetail = {
  id: string
  occurredAt: number | null
  uuid: string | null
  url: string | null       // UUID redirect; null when UUID is absent
  kind: 'trace' | 'trace-chain' | 'message' | 'crash-report' | 'unknown'
  exceptionClass: string | null
  message: string | null
  frames: RollbarStackFrame[]
  request: { method: string | null; url: string | null } | null
  context: string | null
  codeVersion: string | null
  platform: string | null
  language: string | null
  framework: string | null
  server: { host: string | null; branch: string | null } | null
  person: { id: string | null; username: string | null; email: string | null } | null
  notifier: { name: string | null; version: string | null } | null
  truncated: boolean
}

export type RollbarItemDetail = RollbarItemSummary & {
  resolvedInVersion: string | null
  assignedTo: string | null
  latestOccurrence: RollbarOccurrenceDetail | null
}

export type RollbarItemsResponse = {
  items: RollbarItemSummary[]
  failures: Array<{ integrationId: string; code: string }>
  cappedIntegrationIds: string[]
}
```

Do not expose upstream response objects across the plugin boundary. Keep Rollbar's inconsistent
number/string ids and body variants inside provider normalizers.

Update the existing public automation API deliberately:

- list responses remain `RollbarItemSummary` pages;
- get-item returns `RollbarItemDetail`;
- the new fields are additive to the current JSON object, but the server's strict Zod response
  schema must be updated in the same change;
- `refresh=true` on get-item must actually pass `force: true` to `runProviderResource` (it is parsed
  today but not honored);
- update `docs/public-api.md` and the generated/open API checks with the new response schema.

## Privacy and payload policy

Occurrence payloads can contain secrets and personal data even when an SDK was configured to scrub
common keys. Acorn must apply its own allowlist before persistence and rendering.

P1 may store and display only the normalized fields listed above. Specifically:

- do not persist request headers, cookies, query values, POST bodies, raw request bodies, user IP,
  locals/arguments, arbitrary `custom`, arbitrary message metadata, arbitrary telemetry payloads, or
  raw crash reports;
- do not provide a generic recursive JSON viewer in P1;
- cap trace chains, frames per trace, code-context lines, individual strings, and total normalized
  detail size before calling `encodeCached`;
- strip control characters and render all values as text, never `innerHTML`;
- surface `truncated: true` in the UI so omission is not mistaken for upstream absence;
- do not log occurrence payloads or normalized person/request data;
- use synthetic fixtures in tests.

Suggested initial caps (finalize after fixture measurement):

| Field | Cap |
| --- | --- |
| Trace chains | 10 |
| Frames across all traces | 200 |
| Code-context lines per frame | 7 |
| Any one displayed string | 8 KB |
| Normalized detail target | 192 KB, leaving envelope headroom below the 256 KB cache ceiling |

Email is useful diagnostic context but more sensitive than a provider username/id. Keep it behind the
same local-only detail boundary, never add it to list rows or task-context summaries, and drop it
first when enforcing the size/privacy cap.

## Implementation plan

### Phase 0 — Validate and freeze Rollbar response contracts

1. Run the API contract spike above.
2. Add sanitized synthetic fixtures under
   `apps/desktop/src/plugins/rollbar/server/__fixtures__/` for item list, item detail, trace,
   trace-chain, message, and sparse/unknown occurrence variants.
3. Define upstream-only TypeScript types in the Rollbar server plugin. Every field not validated by
   fixtures remains optional and is guarded during normalization.
4. Add pure normalization functions and unit tests before changing routes or UI.

**Verify:** targeted Rollbar normalizer tests pass with no network access and no snapshot contains a
token or real occurrence value.

### Phase 1 — Split summary from detail and correct mirror semantics

1. In `apps/desktop/src/core/shared/api.ts`, introduce `RollbarItemSummary`,
   `RollbarItemDetail`, occurrence/frame types, route builders, and query keys. Keep a temporary
   `RollbarItem = RollbarItemSummary` alias only if it materially reduces one-commit churn; remove it
   before declaring the phase complete.
2. In `apps/desktop/src/plugins/rollbar/server/index.ts`, add explicit paths/helpers for item by id,
   occurrences for an item, and occurrence by id. Let the caller pass query parameters safely rather
   than interpolating unvalidated strings.
3. In `provider.ts`:
   - bump the Rollbar cache schema version and retain a tested read migration from v1 summary rows;
   - preserve distinct `listFetchedAt` and `detailFetchedAt` values;
   - map list `id` to Acorn's string `itemId`;
   - paginate active items up to `maxPages`;
   - make current-list membership exact using the shared refresh timestamp described above;
   - fetch canonical item + latest occurrence detail on a detail miss/stale read;
   - prefer known `itemId` from the summary/ref and fall back to counter resolution for legacy task
     links;
   - normalize before caching; never cache the raw occurrence;
   - retain stale detail on 429/502 through the existing resource runtime.
4. Store `ExternalRef.externalId = itemId` and a verified `url` on newly promoted/attached task links.
   Legacy links containing only the counter must continue to resolve.
5. Keep list and detail as separate resource descriptors if that makes freshness and tests clearer:
   `rollbar.items` and `rollbar.item-detail`. Do not create a second fetch/cache implementation
   outside `runProviderResource`.

**Verify:** provider tests prove pagination, 300-item capping, exact membership, summary-preserves-
detail, legacy counter fallback, distinct freshness timestamps, normalization caps, and stale fallback.

### Phase 2 — Expose honest internal and public routes

1. Extend `/api/rollbar/items` to return successes, per-connection failures, and capped connections.
   Preserve partial success; return an error only when no connection succeeds.
2. Make `/api/rollbar/items/:identifier?integration=...` return `RollbarItemDetail`.
3. Add a validated internal `refresh=true` option and pass it to `runProviderResource.force` for an
   explicit user refresh. A client refetch without server force must not be labeled “Refresh”.
4. Update `apps/desktop/src/core/shared/publicApi/rollbar.ts` and
   `apps/desktop/src/plugins/rollbar/server/publicApi.ts`: list uses the summary schema, detail uses
   the detail schema, and the existing public `refresh` query is honored.
5. Parallelize independent connection reads with `Promise.allSettled` only through the existing
   provider scheduler; preserve deterministic last-seen sorting after aggregation.

**Verify:** route tests cover no connection, one success, partial success, all failed, missing
integration id, item not found, forced refresh, rate limit, and strict response validation.

### Phase 3 — Add shared client queries and the two-column Source

1. Add `rollbarItemsOptions` and `rollbarItemOptions` to
   `apps/desktop/src/core/client/queries.ts`, using the shared keys so Rollbar data participates in
   TanStack Query persistence and invalidation. Remove `createResource` from Rollbar browse/detail.
2. Extract pure list filtering/sorting helpers into a small Rollbar client model file and test:
   project, level, environment, case-insensitive title, exact/`#` counter, stable last-seen sort.
3. Rebuild `RollbarBrowse.tsx` with:
   - `<main class="panes rollbar-browse-panes">`;
   - a left master list and right detail slot;
   - local selection keyed by connection + counter;
   - selection reset on routed repo change;
   - accessible row semantics (`role="button"`, `tabindex`, Enter/Space);
   - a real child button for `+ ws` with propagation stopped;
   - local filter controls and honest empty/error/partial/capped states;
   - a force-refresh action;
   - the existing promotion overlay, with duplicate-task focus behaviour added.
4. Move attach-to-current-task into the selected detail's action bar. Keep the operation idempotent
   in the UI and invalidate `tasksKey` after a successful link.
5. Do not auto-select the first item. Match Linear's explicit “Select an issue” empty detail state.

**Verify:** pure client tests pass; keyboard selection and row action separation are manually tested.

### Phase 4 — Build and reuse `RollbarItemPanel`

1. Create `apps/desktop/src/plugins/rollbar/client/RollbarItemPanel.tsx`.
2. Render the target anatomy and state matrix above. Break stack trace and facts into small
   feature-owned components only if the file would otherwise become difficult to scan; do not create
   generic core components for Rollbar-specific concepts.
3. Replace `RollbarPane.tsx`'s facts-only body with the shared panel while preserving multi-link chip
   selection and pane-intent handling.
4. Add `apps/desktop/src/plugins/rollbar/client/rollbar.css`, imported by the Rollbar client entry
   components. Move existing `.rollbar-*` styles out of `core/client/tasks/task-view.css` and stop
   using `.linear-browse-*` classes. Keep the CSS feature-owned.
5. Match Acorn's established visual language: flat 1 px separators, existing tokens, compact mono
   metadata, no card grid, no provider-brand imitation.

**Verify:** the Source and task pane render the same selected item detail with no duplicated detail
markup.

### Phase 5 — Documentation and final gates

Update durable documentation after the code ships:

- `docs/integrations.md` — Rollbar summary/detail resource, latest-occurrence normalization, and
  read-only scope;
- `docs/panes.md` — new Rollbar task-pane anatomy;
- `docs/frontend.md` — master/detail Source and TanStack Query use;
- `docs/api-reference.md` — internal response shapes and refresh option;
- `docs/public-api.md` — expanded item-detail response;
- `docs/caching.md` — list/detail freshness and 300-item cap;
- `docs/security.md` — Rollbar occurrence allowlist and excluded raw fields, if that doc owns the
  durable data-handling policy.

Once shipped, remove this proposal from `docs/next/` after its durable contracts are captured in the
documents above, following `docs/next/README.md`.

## Files in scope

Expected files (the contract spike may narrow this list):

- `apps/desktop/src/plugins/rollbar/server/index.ts`
- `apps/desktop/src/plugins/rollbar/server/provider.ts`
- `apps/desktop/src/plugins/rollbar/server/routes/rollbar.ts`
- `apps/desktop/src/plugins/rollbar/server/routes/rollbar.test.ts`
- `apps/desktop/src/plugins/rollbar/server/publicApi.ts`
- `apps/desktop/src/plugins/rollbar/server/__fixtures__/*` (new, sanitized)
- `apps/desktop/src/plugins/rollbar/server/normalize.ts` and test (new; exact name may vary)
- `apps/desktop/src/plugins/rollbar/client/RollbarBrowse.tsx`
- `apps/desktop/src/plugins/rollbar/client/RollbarPane.tsx`
- `apps/desktop/src/plugins/rollbar/client/RollbarItemPanel.tsx` (new)
- `apps/desktop/src/plugins/rollbar/client/model.ts` and test (new)
- `apps/desktop/src/plugins/rollbar/client/rollbar.css` (new)
- `apps/desktop/src/app/client/providerContributions.tsx`
- `apps/desktop/src/app/client/taskPaneContributions.tsx`
- `apps/desktop/src/core/shared/api.ts`
- `apps/desktop/src/core/client/queries.ts`
- `apps/desktop/src/core/shared/publicApi/rollbar.ts`
- `apps/desktop/src/core/client/tasks/task-view.css` (remove Rollbar-owned rules only)
- durable docs listed in Phase 5

## Explicitly out of scope for P1

- Rollbar item mutations: resolve, reopen, mute, level/title/assignment/snooze changes.
- A write-token setup or capability migration.
- More than the most recent active 300 items per connection.
- Server-side Rollbar query syntax, resolved/muted/archive browsing, and independent query caches.
- Occurrence history navigation or infinite scrolling.
- Metrics charts, top-item reports, deploy/version correlation, and regression scoring.
- RQL and account-token support.
- Session replay playback or raw replay delivery.
- Raw occurrence JSON, generic arbitrary-object rendering, request headers/bodies, locals, and custom
  payload viewers.
- Rollbar comments (no supported public item-comment capability was found).
- Automatic repo inference from Rollbar's source-control integration. The current explicit repo/
  branch promotion flow remains the safe default.
- A generic master/detail component shared across GitHub, Linear, and Rollbar.
- Installing a Rollbar SDK or starting the Rollbar MCP server from the app.

## Follow-up phases

### P2 — Broader browsing and triage

Only after P1 is stable:

- add a generic query-membership cache for independent status/filter/page lists;
- expose active/resolved/muted/archive tabs, upstream search, and occurrence history;
- add item metrics and a restrained trend visualization;
- correlate `code_version` with deploy/version APIs;
- accept an explicitly configured read/write project token and add resolve/reopen/mute mutations;
- invalidate item/list/detail caches after every mutation and refetch live before mutation where
  freshness affects correctness.

Write capability must be explicit in connection settings. If Rollbar provides no safe introspection
for token scopes, record the user's requested mode, attempt writes only from deliberate actions, and
downgrade the connection capability on a 403. Never probe write scope by mutating a real item.

### P3 — Advanced or plan-dependent capability

- assignment/team pickers if account-level identity data can be obtained cleanly;
- snooze controls where the Rollbar plan supports them;
- session replay only after defining a separate sensitive-payload, retention, and renderer threat
  model;
- optional Acorn agent tools based on the normalized cached detail, not a second Rollbar credential
  path.

## Test plan

### Automated

- Upstream normalizer:
  - numeric and string levels;
  - sparse item response;
  - trace, trace-chain, message, unsupported crash report, unknown body;
  - frame ordering and code-context mapping;
  - missing latest occurrence;
  - invalid timestamps and ids;
  - privacy allowlist and size caps;
  - no raw headers/body/custom/locals survive normalization.
- Codec/resource:
  - v1 row migration;
  - summary refresh preserves detail;
  - detail refresh preserves list membership;
  - list/detail freshness are independent;
  - page termination, three-page cap, and current membership;
  - legacy counter link resolves to canonical id;
  - 401/403/404/429/502 mapping and stale fallback.
- Routes:
  - validation and force refresh;
  - multiple connections, partial success, cap metadata, deterministic sorting;
  - strict internal/public response schemas.
- Client model:
  - compound identity across two projects with the same counter;
  - every local filter;
  - last-seen ordering and null timestamps;
  - task duplicate detection.

### Manual visual and interaction QA

Test in the Electron app with two Rollbar project connections if available:

1. No selection, loading, full detail, item-without-occurrence, upstream failure, partial success,
   stale detail, and capped-list states.
2. Trace, trace-chain, message, sparse payload, and very long/truncated trace.
3. Same counter in two projects selects the correct detail and attaches the correct connection.
4. Mouse and keyboard row selection; `+ ws` does not select; Enter/Space select; focus reveals the
   row action.
5. `+ ws` creates a task with the chosen repo/branch; repeating it focuses the linked active task.
6. Attach disabled without an active task, succeeds once with a task, and does not duplicate a link.
7. Task pane shows the same detail; multiple linked Rollbar chips switch correctly; pane intent lands
   on the requested connection + counter.
8. Narrow window and collapsed-left-shell behaviour; long titles, paths, methods, and code lines do
   not force horizontal page overflow.
9. Light/dark/system palettes and keyboard focus contrast.
10. Network inspection confirms the Rollbar token never reaches the renderer and raw occurrence data
    is absent from internal JSON responses, SQLite cache rows, and logs.

## Verification commands

```sh
pnpm --filter @acorn/desktop test -- src/plugins/rollbar
pnpm lint
pnpm test
pnpm --filter @acorn/desktop build
```

Expected result: all commands exit 0; no test performs a live Rollbar request; no generated fixture or
log contains a credential or real occurrence payload.

## Done criteria

- [ ] Rollbar Source is a two-column list/detail experience.
- [ ] Row selection, task promotion, and attach-to-task are distinct accessible actions.
- [ ] Source and task panes use one Rollbar item-detail component.
- [ ] List and detail have separate typed contracts and separate freshness semantics.
- [ ] Active list pagination is bounded and the 300-item cap is represented honestly.
- [ ] Latest occurrence detail is normalized, privacy-allowlisted, size-capped, and cached without raw
      provider JSON.
- [ ] Legacy counter-only task links still resolve; new links retain canonical item id.
- [ ] Partial connection failures are visible and do not erase successful results.
- [ ] Manual refresh actually bypasses the server TTL.
- [ ] Public API list/detail schemas and durable docs match shipped behaviour.
- [ ] Targeted tests, `pnpm lint`, `pnpm test`, and desktop build pass.

## STOP conditions

Stop and report instead of improvising if:

- the sanitized contract spike cannot establish a reliable canonical item id or latest occurrence
  id from the documented read endpoints;
- a useful detail requires persisting raw request bodies, headers, locals, custom payloads, or replay
  data;
- normalized detail cannot stay comfortably below the existing 256 KB provider cache ceiling;
- response variation cannot be represented without exposing untyped upstream objects to the client;
- correct P1 list membership requires adding a general query-page cache table (that is a P2 design
  decision, not an incidental migration);
- a Rollbar web URL would have to be guessed beyond the verified item-ID and occurrence-UUID redirects;
- a requested P1 action requires write or account scope;
- implementation requires bypassing `runProviderResource`, storing another plaintext token, or
  putting provider secrets in renderer state;
- unrelated Linear/GitHub behaviour must change to make the Rollbar pane work.

## Official references

- [Rollbar API authentication and token scopes](https://docs.rollbar.com/reference/getting-started-1)
- [List all items and supported filters](https://docs.rollbar.com/reference/list-all-items)
- [Get an item by project counter](https://docs.rollbar.com/reference/get-an-item-by-project-counter)
- [Get an item by system id](https://docs.rollbar.com/reference/get-an-item-by-id)
- [List an item's occurrences](https://docs.rollbar.com/reference/get_api-1-item-item-id-instances)
- [Get an occurrence](https://docs.rollbar.com/reference/get_api-1-instance-instance-id)
- [Update an item](https://docs.rollbar.com/reference/update-an-item)
- [Get metrics for items](https://docs.rollbar.com/reference/post_api-1-metrics-items)
- [Versions API](https://docs.rollbar.com/reference/get_api-1-versions-version)
- [RQL capabilities and plan constraints](https://docs.rollbar.com/docs/rql)
- [Session replay read endpoint](https://docs.rollbar.com/reference/get_api-1-environment-environment-session-sessionid-replay-replayid)
- [Official Rollbar MCP server](https://github.com/rollbar/rollbar-mcp-server)
