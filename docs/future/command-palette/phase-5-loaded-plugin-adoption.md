# Phase 5: prove declarative search and input with loaded plugins

Planned 2026-09-03 at `7d62e3ec`. Not started.

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

### 2. Linear: mapped project search

- Add a project-scoped issue search route and descriptor. Resolve only mapped Linear project IDs and
  connected workspaces.
- Prefer a provider-side bounded text/identifier query when the Linear API supports the required
  mapping filter; otherwise filter the existing cached active mapped-project set. Document which
  path is chosen and retain the 50-row cap.
- Normalize through the existing Linear rail identity so multiple connections with the same display
  identifier cannot collide. Selection navigates to the existing project issue surface.

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

### 4. HTTP: saved requests and cURL import

- Add project-scoped saved-request search over the encrypted request store's safe summaries. Never
  return headers, bodies, auth material, resolved variables, or secret values in a command item.
- Selection navigates to the existing project HTTP surface and selected request identity.
- Add a `New HTTP request` action using the existing default request creation path.
- Add one text input for cURL import. Parse with the existing non-shell cURL parser, persist through
  the existing encrypted request write, and return the created item only after success. Selection or
  success opens that request. Do not execute it.

### 5. Manifest and lifecycle cleanup

- Organize each plugin's commands under same-owner groups where useful. Keep stable existing IDs for
  old commands; new local IDs are lower-case and bounded by the manifest contract.
- Verify plugin disconnect, disable, reload, and node switch remove commands and abort active queries.
- Add a test-only loaded plugin setting with two non-secret choices to exercise read/write descriptor
  registration against the real host. Do not invent a production setting solely for coverage.

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

