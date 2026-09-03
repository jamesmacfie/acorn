# Phase 5: prove declarative search and input with loaded plugins

Planned 2026-09-03 at `7d62e3ec`. Shipped 2026-09-03, all five steps.

## Status

- Priority: P2
- Effort: large
- Risk: high; new routes cross authorization, provider-rate, and untrusted-wire boundaries.
- Depends on: phase 2

## Purpose

Adopt the interactive manifest contract in Database, HTTP, Linear, and Rollbar. Each route must
enforce the same owner/project/task boundary as its existing pane or rail surface. Model providers
and nodes-file remain infrastructure contributors rather than receiving artificial commands.

## Prerequisites

- Phase 2's loaded descriptor, sanitization, scope, and async action fixture tests pass.
- Read each loaded plugin manifest, portable route carrier, existing source/project-surface action,
  domain route tests, and integration/project mapping logic.
- Confirm loaded plugin packages are built and staged by desktop and TUI test commands before relying
  on an end-to-end fixture.

## Behavioural changes

- Rollbar and Linear expose debounced project-scoped issue searches that navigate to their existing
  project surfaces.
- Database exposes saved-query search and a submitted Generate SQL fast path that persists scratch
  before opening the pane.
- HTTP exposes saved-request search, new request, and submitted cURL import.
- Existing static commands continue to parse; open-linked commands may become children but keep
  their IDs and keybindings.

## Boundaries

### In scope

- Loaded manifests, plugin-owned palette routes, normalizers, route tests, and chrome registration.
- Database, HTTP, Linear, and Rollbar only, plus a fixture setting descriptor.

### Out of scope

- Plugin frames drawing palette UI, new provider credentials, result-selected verbs, action panels,
  model-provider or nodes-file commands, and changing external provider caching policy.

## Migration steps

### 1. Rollbar: the reference loaded search

- Add a project-scoped `Find Rollbar issue` search descriptor with a plugin-owned route such as
  `/v2/p/rollbar/palette/issues` and its existing project-surface navigation action.
- The route receives host-derived `projectId` and `q`, resolves only connections mapped to that
  project, reuses cached active-item listing, filters/ranks title, identifier, level, and framework,
  and returns at most 50 normalized command items.
- Preserve partial connection success. A total provider failure uses the existing error mapping.
- Selecting a row navigates with the sanitized item ID; it does not promote a task.

**Shipped 2026-09-03.** `/v2/p/rollbar/palette/issues`, reusing the rail's own `scopedConnections`
and `listItems`, with `src/server/paletteSearch.ts` holding the ranking as a pure function. The one
premise that did not survive contact: this doc says "its existing project-surface navigation action",
but phase 2 shipped a search's `onSelect` as the context-free verb set, which has no `navigate` —
that verb was refused everywhere a command runs because it needs a selected row and a routed project.
A search result has both, so the protocol now has a `selectedRowAction` union that is the command set
plus `navigate`, the manifest counts a search's `navigate` as a mount site for a project-scoped
surface, and the palette hands `runChromeAction` the captured project and the host's navigator. HTTP's
step 4 needs the same seam and it is already there.

Rollbar's list is cached — `rollbar.items` is a mirrored resource with a two-minute TTL — so typing
filters a cached list and spends no extra provider budget.

### 2. Linear: mapped project search

- Add a project-scoped issue search route and descriptor. Resolve only mapped Linear project IDs and
  connected workspaces.
- Prefer a provider-side bounded text/identifier query when the Linear API supports the required
  mapping filter; otherwise filter the existing cached active mapped-project set. Document which
  path is chosen and retain the 50-row cap.
- Normalize through the existing Linear rail identity so multiple connections with the same display
  identifier cannot collide. Selection navigates to the existing project issue surface.

**Shipped 2026-09-03, provider-side.** `/v2/p/linear/palette/issues` sends
`projectIssueSearchFilter(projectIds, q)`: the rail's own mapped-project filter with a `title`
`containsIgnoreCase` clause, plus a team-and-number clause when the query parses as an identifier or a
bare number.

Two reasons, and the second is the one that decided it. Linear's `IssueFilter` supports the mapping
filter — `project: { id: { in: … } }` is what the rail already sends — which is the condition this doc
sets for preferring a provider-side query. And the fallback it names does not exist: there is no
cached active mapped-project set. `/rail-items` calls `providerFetch` directly and Linear's reads are
exempt from serve-then-revalidate (docs/caching.md § Provider mirrors), so filtering "the cache" would
have meant fetching the first hundred active issues per keystroke and searching those — the same
request count, more bytes, and unable to find the hundred-and-first. Both paths go through the same
per-connection scheduler and budget, so no rate-limit policy changed hands.

`searchableContent` was deliberately not used: it reads every description as well, which is a
different question from "find the ticket I am thinking of", and it is the field most likely to vary by
plan. `title` and `number` have been in `IssueFilter` since the beginning.

### 3. Database: saved queries and SQL input

- Add `Find saved database query` as a task-scoped command because the existing route resolves the
  active task to its project even though saved queries are project-owned. A static
  `/v2/p/database/palette/queries` route receives `taskId` and `q`, checks the task/project owner, and
  returns summaries ordered by current saved-query order and fuzzy relevance.
- Selection opens the Database pane with an intent that loads the saved SQL into the existing editor
  path; do not execute it automatically.
- Add `Generate SQL` as task-scoped input at `/v2/p/database/palette/generate`. Validate the existing
  prompt bound, require an interactive owner, load the live database schema, choose the first
  available model connection and its provider default model, generate with no selected examples,
  and write the returned SQL to the existing task scratch document.
- Return success only after the scratch write commits. The static success action opens Database.
  Provider-not-connected/auth/rate-limit/schema failures use actionable existing error codes. The
  full modal remains unchanged.

**Shipped 2026-09-03.** `/v2/p/database/palette/queries` and `/v2/p/database/palette/generate`, with
`src/server/paletteSearch.ts` holding the ranking as a pure function. The generate route follows
`command-catalog.md` § Database SQL fast path in its own numbered order — the connection list before
the schema, because "nothing is connected" is a cheaper answer than introspecting a live database and
the more actionable of the two.

Three premises did not survive contact, and each was a host gap rather than a plugin one.

`defaultModelIdFor` lived in client-core, where a node cannot reach it, so the fast path would have had
to restate the modal's initial selection and drift from it. It moved to
`@acorn/protocol/modelProviders.ts` beside `availableModelConnections`, and client-core re-exports it.

A `remote` pane region was never handed the sibling editor's document. `register.ts` passed the
accessor to a `frame` region and not to a tree, so `bridge.document.write` — the "existing editor path"
this step loads SQL into — was refused by the broker for the one pane that uses it. Fixed by passing
the same accessor to both, which is what the structural grant always meant: a region either stands
beside a host editor or it does not, and which runtime the bytes are in is not part of that question.

A `remote` region also never consumed the retained pane intent. A frame region reads it into
`context.item` at connect, which is what closes the mount-order race for a pane that was closed when
the row was picked; a tree only listened for the live event, which has already fired by then. Both
`RemoteTree`s now consume it the way `PluginFrame` does. Without this, every command whose `onSelect`
or `onSuccess` is `openPane` worked only when the pane happened to be open already.

One thing was added rather than found: `Generate SQL` answers with a `#scratch` sentinel row rather
than a saved query's id, and the panel reads that as "re-read the scratch document". A cold pane loads
the new SQL from the read route anyway; a pane that was already open would otherwise have kept the text
its editor loaded, and the fast path would have appeared to do nothing for the reader most likely to
use it.

### 4. HTTP: saved requests and cURL import

- Add project-scoped saved-request search over the encrypted request store's safe summaries. Never
  return headers, bodies, auth material, resolved variables, or secret values in a command item.
- Selection navigates to the existing project HTTP surface and selected request identity.
- Add a `New HTTP request` action using the existing default request creation path.
- Add one text input for cURL import. Parse with the existing non-shell cURL parser, persist through
  the existing encrypted request write, and return the created item only after success. Selection or
  success opens that request. Do not execute it.

**Shipped 2026-09-03.** `/v2/p/http/palette/requests` and `/v2/p/http/palette/import-curl`, with
`src/server/paletteSearch.ts` holding the ranking and the imported request's name.

The search does not redact — it never reads anything to redact. Its query selects `id`, `name`,
`folder` and `method`, which are four of the plaintext columns; the URL, the headers, the body, the
auth block and the variables are the five the node encrypts and none is opened on this path. Not even
the URL reaches a row, matching the rail beside it, because `?token=…` typed literally is an ordinary
way to have saved a request and no rule can tell which literal is a secret.

The import is **task-scoped although saved requests are project-owned**, and that is this step's one
correction. An input's `onSuccess` is the context-free verb set, whose only way to show the reader what
was created is `openPane` — and a pane belongs to a task. A project-scoped import would have parsed and
then refused at the moment of success on the very route (`/p/:projectId`) where it was offered. So the
import lands where a new request in a task lands anyway: on the task, ad hoc, until the reader files
it.

`New HTTP request` is a `surfaceAction`, not a node route: a new request is a draft in the pane, not a
row on the node, and the panel's own "+ Request" button does exactly this. That needed the manifest's
`surfaceAction` rule widened — see step 5.

### 5. Manifest and lifecycle cleanup

- Organize each plugin's commands under same-owner groups where useful. Keep stable existing IDs for
  old commands; new local IDs are lower-case and bounded by the manifest contract.
- Verify plugin disconnect, disable, reload, and node switch remove commands and abort active queries.
- Add a test-only loaded plugin setting with two non-secret choices to exercise read/write descriptor
  registration against the real host. Do not invent a production setting solely for coverage.

**Shipped 2026-09-03.** Database's three visible rows sit under a `db` group and HTTP's under an `api`
group; the two `open` commands keep their ids, their chords and their titles, and stay out of the
groups because `palette: false` means the only place their titles are read is the shortcut editor.
`execute` keeps its id and its ⌘Enter binding and lost its `Database: ` prefix, which the group now
says. Group ids are `db` and `api` rather than `database` and `http`, because contribution ids are
unique across a whole manifest and both of those are pane ids.

Two host findings, both pre-existing and both fixed here because this step's rows depend on them.

**`surfaceAction` was refused by the device outright.** `chromeRegister.ts`'s `contextFreeActionUsable`
handled four verbs and fell through to `false`, so `plugin.database.execute` — a command since the
loaded-plugin migration — has never appeared in the palette. Its ⌘Enter chord still worked, because
that resolves through the keybinding registry rather than the command one, which is why nobody noticed.
The device now checks the verb against the panes the manifest declares that draw a region of their own.

**The manifest's rule was narrower than its own stated reason.** It required a pane with *both* a
document region and a plugin region, while the comment beside it said the test was whether the pane runs
any of the plugin's code. The document requirement was the phase-appropriate scope when ⌘Enter-in-the-
host-editor was the only way in; the palette is the other way, and from there the verb is about any pane
the plugin draws. Widened to that, which is what admits HTTP's `list-detail` panel and leaves a
host-drawn-only pane refused.

The fixture setting is `chromeRegister.test.ts` § "a loaded plugin's setting, end to end": a two-choice,
non-secret `grouping` setting on a fixture plugin, driven through the real registration pass and the
real command registry — read, write, a value the manifest never declared refused on the way out and
ignored on the way back, gone when the node stops running the plugin, and registered-but-unavailable
while it is disabled. Deliberately a fixture: none of the four adopting plugins has a two-choice
preference, and inventing one to be covered would be a product decision made by a test.

## Tests

- Rollbar fake timers prove one request after rapid typing; project mapping, multiple connections,
  partial/total failure, cap, stale result, and navigation are covered.
- Linear covers mapped/unmapped projects, connection ID collision, provider failure, ranking, and
  selection route.
- Database covers task/project isolation, saved query selection without execution, prompt validation,
  no model connection, default connection/model choice, schema failure, provider errors, scratch
  write before response, retry, and pane open after success.
- HTTP covers project isolation, result redaction, encrypted persistence, cURL parse failure, no send,
  created-item navigation, and absence of variables/secrets.
- Manifests parse from the committed JSON Schema and register only when their loaded node capability
  is present.
- Disable/reload/node switch during a request cannot apply a result or invoke an action.

Run each plugin's actual package suite, then:

```sh
pnpm --filter @acorn/protocol test
pnpm --filter acorn-plugin-types test
pnpm --filter @acorn/client-core test
pnpm --filter @acorn/tui test
pnpm --filter @acorn/desktop test
pnpm lint
```

## Exit criteria

- Database, HTTP, Linear, and Rollbar manifests use the accepted interactive descriptors and pass
  route plus host tests.
- Search calls are bounded, scoped, cancellable, and never return executable behavior or secrets.
- SQL generation persists scratch before navigation and preserves its prompt on every failure.
- HTTP cURL import never sends a request.
- Model providers and nodes-file remain without redundant command groups.
- The fixture proves a third-party loaded setting command without adding a production setting.

## Rollback posture

Each plugin command and route is independently additive. A failed adoption can remove its descriptor
and route without affecting the plugin pane/source or the public command schema. Once an interactive
manifest has shipped to users, retain runtime parser support even if a first-party descriptor is
temporarily withdrawn.

## STOP conditions

- A route can read another user's or unmapped project's rows before applying a client filter.
- A search response needs to include a credential, raw request secret, or arbitrary action.
- Database cannot guarantee the scratch write completed before returning success.
- cURL import must invoke a shell or send the request to produce a saved item.
- Linear or Rollbar search would bypass existing provider cache/rate-limit policy without an explicit
  replacement design.

## Verify before starting

- `git diff --stat 7d62e3ec..HEAD -- plugins/database plugins/http plugins/linear plugins/rollbar packages/protocol packages/client-core`
- Confirm manifest command IDs/routes and project surface patterns have not changed.
- Re-read project mapping and interactive-owner checks in every route.
- Confirm provider resource caching and total-versus-partial failure behavior.
- Run all four route suites and phase 2's loaded fixture suite before editing.

