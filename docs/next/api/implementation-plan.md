# Implementation plan

**Baseline:** `b59bb4f`

This plan is ordered so each phase has a usable verification boundary. Do not implement endpoint
families in parallel before the schema/auth/service foundations exist; that would recreate the
route-specific casts and duplicated behavior this design is intended to remove.

## 1. Target file structure

Names may adjust to repository convention, but ownership and runtime boundaries should remain:

```text
apps/desktop/src/
  core/
    shared/publicApi/
      primitives.ts          # strict shared schemas, inferred types
      errors.ts              # error codes/envelope schemas
      core.ts                # workspace/task/settings/discovery schemas
      commands.ts            # command descriptors and broker frames
      events.ts              # public WS frames and event contracts
    server/publicApi/
      app.ts                 # createAutomationApp(), core routes only
      registry.ts            # endpoint/event/command registry
      defineEndpoint.ts      # typed schema-first helpers
      auth.ts                # bearer resolver + scope middleware
      validate.ts            # params/query/header/body/response validation
      respond.ts             # envelopes/error mapping
      idempotency.ts         # idempotency service/middleware
      openapi.ts             # registry -> OpenAPI 3.1
      tokenService.ts        # issue/hash/auth/revoke/last-used
      oauthAccountService.ts # encrypted GitHub identity lookup/upsert
      services/
        workspaceService.ts
        taskService.ts
        repositoryAssignmentService.ts
        integrationService.ts
    main/publicApi/
      server.ts              # dedicated loopback listener lifecycle
      settingsStore.ts       # atomic bootstrap JSON settings
      wsHub.ts               # public bearer WebSocket
      uiControlBroker.ts     # renderer registration/snapshot/command acks
      eventBus.ts            # typed in-process events + replay ring
    client/publicApi/
      uiControlClient.ts     # internal WS renderer registration + dispatch
      presentationSnapshot.ts
      coreCommands.ts        # statically activated core command handlers

  plugins/<plugin>/
    shared/publicApi.ts      # plugin schemas where shared/client use is needed
    server/publicApi.ts      # endpoint contribution adapters
    main/<domain>Service.ts  # extracted implementation when main capability is needed
    client/commands.ts       # static renderer command contributions when applicable

  app/
    server/publicApi.ts      # registers built-in public plugin contributions
    client/publicApi.ts      # registers built-in public UI command contributions
    main/bootstrap.ts        # constructs services/broker/event bus and listener

apps/desktop/migrations/
  <generated>_public_api.sql

apps/desktop/test/publicApi/
  harness.ts
  auth.conformance.test.ts
  endpoints.conformance.test.ts
  plugins.conformance.test.ts
  websocket.conformance.test.ts
```

Keep `core/` free of product plugin imports. `app/` remains the composition leaf. Extend
`core/boundaries.test.ts` so new public API folders obey the existing client/server/main separation
and do not increase the cross-plugin baseline.

## 2. Phase 0 — contract and verification baseline

### Actions

1. Add strict schema helpers and shared primitives from [protocol.md](./protocol.md).
2. Add the endpoint/event/command contribution types and isolated registry classes.
3. Add registry freeze semantics: contributions register during composition, then discovery/app
   construction reads an immutable snapshot.
4. Add duplicate namespace/path/operation-id tests and schema strictness inspection.
5. Decide and pin the OpenAPI adapter package compatible with the repository's Zod 4/Hono versions.
   Prefer a thin generator over coupling handlers to OpenAPI-specific Hono classes; the registry is
   the product abstraction.
6. Add test-only endpoint enumeration and a public API harness that can supply fake services without
   starting Electron.

### Boundaries

- Do not change existing `/api/*` behavior.
- Do not register product plugin endpoints yet.
- Do not hand-write a second set of TypeScript interfaces beside the Zod schemas.

### Verification

```bash
pnpm lint
pnpm --filter @acorn/desktop test -- src/core/server/publicApi
```

Expected: strict TypeScript passes; registry tests prove invalid contributions cannot freeze.

## 3. Phase 1 — migrations and machine API settings

### Schema actions

Add:

- `api_tokens` and `oauth_accounts` from [authentication.md](./authentication.md);
- `api_idempotency`:
  `(token_id, operation_id, key)` primary key, request hash, response status/body, created/expiry;
- `command_executions` (terminal plugin-owned but migration remains in the one app migration set):
  id, task id, status, bounded stdout/stderr, truncation, timestamps, exit/signal, timeout;
- indexes for token listing/auth, idempotency expiry, execution task/created/status.

Do not add foreign-key declarations in isolation; the current schema intentionally uses application
cascades and does not enable SQLite FK enforcement. Add explicit cascade/cleanup behavior instead.

### Settings actions

1. Implement `<dataRoot>/api-settings.json` with `{ version: 1, enabled, port }`.
2. Read strictly; corrupt/unknown versions fail closed to disabled and surface a settings error.
3. Write via temp file + fsync/rename with restrictive permissions.
4. Support `ACORN_API_PORT` as an effective override; reserve `4317`; bind address is constant.
5. Add test seams using a temporary data root.

### Verification

```bash
pnpm --filter @acorn/desktop db:generate
pnpm --filter @acorn/desktop db:check
pnpm --filter @acorn/desktop test -- src/core/main/publicApi apps/desktop/scripts/check-migrations.ts
pnpm lint
```

Manually inspect generated table-rebuild SQL if Drizzle emits one; this migration should be additive
and must not rebuild populated tables.

## 4. Phase 2 — token service and persistent GitHub identity

### Actions

1. Implement token generation/parsing/hash verification exactly as specified.
2. Add cookie-authenticated internal settings routes for list/create/revoke and a Settings page.
3. Upsert encrypted GitHub OAuth account data during the existing `/auth/callback` after the `/user`
   request succeeds.
4. Add `api-token` to the principal union for public-only context; do not make existing internal app
   middleware accept it.
5. Implement immediate revocation notification and last-used throttling.
6. Add a cleanup path for expired idempotency rows/tokens; cleanup is maintenance, not authentication
   correctness.
7. Ensure token creation response is never cached/persisted by TanStack Query/IndexedDB and the UI
   displays the raw token once with explicit copy/dismiss semantics.

### Tests

- token grammar and entropy length;
- stored row never contains raw bearer;
- constant-time hash helper behavior for equal-length values;
- invalid/expired/revoked token cases;
- metadata list never returns hash/secret/encrypted upstream token;
- OAuth account upsert encrypts at rest and rotation replaces credential;
- logs redact create bodies and Authorization;
- browser logout does not revoke API tokens;
- explicit revocation publishes token id.

### Stop condition

If persisting the GitHub credential is rejected as a product/security decision, stop and revise the
parity promise. Do not implement GitHub public endpoints that silently serve only cached data or ask
the caller to provide a GitHub token.

## 5. Phase 3 — public listener, auth, envelopes, OpenAPI

### Actions

1. Implement `createAutomationApp()` with bearer resolver → scope gate → validated core route table →
   standard error backstop.
2. Implement exact Host guard before Hono and bind `127.0.0.1` only.
3. Add JSON/media/body limits, request ids, structured privacy-safe request logging, and cancellation.
4. Add OpenAPI and authenticated discovery endpoints.
5. Implement listener start/stop/rebind with no automatic port fallback.
6. Wire lifecycle in `bootstrap.ts`: construct after DB/services, start before window, stop first.
7. Keep existing `ACORN_PORT` and `4317` app listener behavior unchanged.
8. Add the core API settings GET/PATCH service and transactional rebind.

### Tests

- public app rejects cookie/internal auth and accepts bearer;
- every endpoint is auth-gated by table enumeration;
- wrong Host rejected on HTTP and upgrade path;
- no CORS headers/preflight widening;
- invalid JSON/media/unknown fields/status envelopes;
- port conflict retains prior listener/settings;
- settings file/env precedence;
- OpenAPI contains every registered operation with security and response schemas;
- teardown rejects/drains pending work predictably.

### Verification

```bash
pnpm --filter @acorn/desktop test -- src/core/server/publicApi src/core/main/publicApi
pnpm lint
```

## 6. Phase 4 — extract core application services

The current workspace/task routes contain SQL, validation, defaulting, link stamping, and response
mapping. Public adapters must not copy them.

### Actions

1. Extract `WorkspaceService` from `core/server/routes/workspaces.ts`:
   list/get/create/update/delete/bootstrap/projects and assignment operations.
2. Extract `TaskService` from `core/server/routes/tasks.ts` plus task lifecycle coordination currently
   split between client mutation helpers, terminal routes, and worktree services.
3. Extract `IntegrationService` from connection lifecycle routes.
4. Extract typed preference, pinned-repository, and config-trust services; keep presentation-owned
   preferences reducer-controlled.
5. Make existing internal routes thin adapters to these services without changing their current
   wire contract.
6. Add public core adapters from [core-api.md](./core-api.md).
7. Return timestamps and complete domain results from services; internal adapters may project the
   legacy response shape where needed.
8. Emit typed domain events only after successful commits/transitions.

### Characterization tests first

Before extraction, lock down:

- Default workspace creation/deletion behavior;
- ignored membership vs unassigned distinction;
- repo partition upsert and project connection validation;
- task title seeding, ordering, link provider stamping, archive timestamps;
- current-checkout vs lazy/immediate worktree creation;
- archive dirty/session/teardown guards and skip behavior.

### Verification

Run existing workspace/task/terminal route tests as well as public service/route tests. Existing
internal route responses must remain unchanged in this phase.

## 7. Phase 5 — local plugin services and public endpoints

Implement lower-upstream-risk plugins first.

### 5A. Terminal, worktree, Git, editor/search

1. Extract stable services from bridge implementations rather than adding route-to-route calls.
2. Add terminal session resources and public stream adapters.
3. Add captured execution service with timeout/output caps/reconciliation.
4. Add checkout mapping/worktree/run-target endpoints and reuse config trust.
5. Add current Git action set and strict path schemas.
6. Add editor/file/search endpoints with content hash optimistic writes.
7. Convert current internal bridges/routes to the same services where practical.

Security gates: environment stripping, realpath confinement, symlink tests, no command/body logging,
read/write scope tests, config-trust coverage for every configured execution path.

### 5B. Notes, memory, review notes, context, workflows

1. Replace `unknown` bridge return types with strict schemas at the service boundary.
2. Add note version hashes and strict scope paths.
3. Add memory/proposal schemas and endpoint contributions.
4. Add strict TaskContext schemas and public adapter.
5. Add workflow definition-id start path; keep whole-definition start internal only.
6. Ensure workflow cancellation/gate/kill share the existing reconciliation/semaphore runtime.

### 5C. Preview and database

1. Add safe task-id preview service operations without exposing Electron handles.
2. Add database adapters that convert current error unions into non-2xx domain errors.
3. Keep database URL server-only and validate table/column identifiers against live metadata.
4. Treat every SQL query as write scope.

### Plugin conformance gate

Every plugin contribution must pass the shared auth/schema/OpenAPI/logging suite before activation in
`app/server/publicApi.ts`.

## 8. Phase 6 — typed command registry and UI broker

### Actions

1. Add the static typed command registry beside the existing client command/keybinding registry.
2. Implement core deterministic commands from [commands-and-ui.md](./commands-and-ui.md).
3. Move command registration out of component `onMount` for public commands; component-local
   keyboard aliases may remain but must call the static command.
4. Route pointer/UI actions through the same command services/reducers where listed in the parity
   mapping.
5. Add internal `ui:*` WebSocket frames, renderer registration after startup restore, snapshots,
   revisions, correlation, timeout, and disconnect cleanup.
6. Add public discovery/invocation endpoints.
7. Implement plugin presentation commands for GitHub, editor, notes, integrations, preview, terminal.
8. Preserve existing command ids as keyboard aliases where changing them would break user keybinding
   prefs; public discovery exposes only stable parameterized ids.

### Tests

- existing layout reducer tests remain the behavior authority;
- API and keyboard adapters produce identical reducer actions;
- broker timeout/disconnect/revision conflicts;
- static command catalog exists regardless of mounted component;
- pane/source/setting/plugin availability uses registries;
- end-to-end visible UI changes after HTTP commands.

### Escape hatch

If a UI behavior requires a live DOM capability that cannot be represented as serializable command
input (for example native text selection), classify it as presentation-only and document the exact
reason. Do not accept DOM selectors, JavaScript snippets, or Electron handles through a generic
command payload.

## 9. Phase 7 — public events and WebSocket

### Actions

1. Add typed in-process event bus and bounded replay ring.
2. Adapt existing terminal stream handlers and workflow notices to both internal and public hubs.
3. Add public strict frame parser, subscriptions/filters, backpressure, heartbeat, close codes.
4. Index connections by API token id and close on revocation.
5. Publish core/service/plugin events after authoritative transitions.
6. Add event/channel discovery metadata and schemas.

Do not replace the current internal WS with the public protocol in the same change. They have
different credentials and clients. Share the event/terminal service beneath them.

## 10. Phase 8 — GitHub and provider parity

### GitHub

1. Extract GitHub operations/mirror updates from route handlers into plugin services.
2. Resolve encrypted OAuth account credential for `api-token` principals; retain cookie token for
   browser internal routes.
3. Convert the shared response interfaces to strict Zod schemas.
4. Add reads, create PR, all current PR mutations, Actions reads/rerun, and mirror invalidation.
5. Implement idempotency for externally duplicated upstream mutations.
6. Map upstream 401 to `424 upstream_reauthentication_required`, rate limits to `429`, and preserve
   SAML/permission distinctions in error details without leaking bodies.

### Linear/Rollbar and connections

1. Expose safe core connection lifecycle; credential schemas are provider-declared and write-only.
2. Add provider endpoint contributions.
3. Keep connection id mandatory wherever identifiers may collide across accounts.
4. Add Linear comment idempotency and Rollbar read-only parity.
5. Reuse current provider budgets/sync policies and cascade behavior.

### Verification

Use mocked upstream route tests for every mutation and mirror update. Live tests remain optional and
must not be required for the deterministic suite.

## 11. Phase 9 — product settings, documentation, and rollout

### Settings UX

- API enabled state, effective address, port edit, env-override explanation;
- token metadata list, create dialog (`read` vs `read + write`, expiry), show-once secret, revoke;
- explicit warning that write tokens can run arbitrary commands as the local user;
- listener errors and restart/rebind status;
- copyable `curl` example that does not place the token in shell history by default (use an env var).

### Documentation

1. Generate user-facing API reference/OpenAPI from the registry.
2. Move shipped lasting contracts from `docs/next/api` into durable `docs/api/` or equivalent when
   implementation completes, per `docs/next/README.md` policy.
3. Update `docs/security.md`, `docs/plugins.md`, `docs/architecture-overview.md`, `docs/testing.md`,
   `docs/authentication.md`, and current `docs/api-reference.md` to distinguish internal/public APIs.
4. Add a plugin-author example and conformance checklist.

### Rollout

1. Ship listener disabled until a token is created/enabled.
2. Mark `/api/v1` experimental only if compatibility is genuinely not promised; otherwise do not
   use “beta” as permission to break documented shapes.
3. Exercise on packaged Electron, development Electron, and `dev:node`. Main/Electron-dependent
   endpoints return `503 capability_unavailable` under `dev:node`; core server endpoints still work.
4. Do not remove internal `/api/*` routes as part of initial public API delivery.

## 12. Test inventory

### Unit

- all Zod schemas and boundary values;
- token parsing/hash/scope/revocation;
- config store atomicity/override/port validation;
- registry namespace/collision/freeze/OpenAPI;
- idempotency request hashing/replay/conflict/expiry;
- service domain behavior and typed error mapping;
- command availability/input/output/reducer mapping;
- event filters/replay/backpressure.

### Route conformance

Generate cases from the frozen registry:

- auth absent/invalid/revoked;
- read token on read/write endpoint;
- strict params/query/header/body unknown fields;
- media/body limit;
- declared status/envelope/response schema;
- operation present in OpenAPI;
- request id echoed;
- no secret fields in serialized output.

### Integration

- SQLite migrations and real service transactions;
- terminal/command/Git/file operations in temporary repos/worktrees;
- symlink/path traversal;
- tmux/PTY mocked or platform-gated behavior;
- mocked GitHub/Linear/Rollbar responses and mirror/cache updates;
- public WS attach/replay/input/revocation;
- listener transactional rebind.

### Electron E2E

1. login through the existing E2E seam;
2. create a write token through settings/internal route;
3. call public health/capabilities;
4. create/activate a task;
5. add/move/pin/close panes and assert UI;
6. create a terminal, focus it, execute a harmless command, assert streamed output;
7. edit/stage/commit a fixture file and verify status;
8. revoke the token and assert next HTTP call is `401` and socket closes `4401`;
9. change the API port and assert the UI remains logged in on `4317`.

## 13. Required verification commands

During implementation use focused tests, then finish with:

```bash
pnpm lint
pnpm test
pnpm --filter @acorn/desktop build
pnpm --filter @acorn/desktop test:e2e
```

Account for the documented native ABI switch: `pnpm test` rebuilds Node ABI; Electron build/E2E must
restore Electron ABI as the package scripts already do.

## 14. Review checklist and done criteria

- [ ] Dedicated listener, fixed loopback bind, configurable independent port
- [ ] No public route accepts cookie/internal auth; no internal route accepts public bearer by accident
- [ ] Raw token shown once, only hash stored, immediate HTTP/socket revocation
- [ ] Read token cannot mutate or execute any path, including WS frames and SQL query
- [ ] Stored GitHub credential encrypted; upstream 401 distinct from bearer 401
- [ ] Every public payload/response/frame/command/event has strict runtime schema
- [ ] OpenAPI generated from the same frozen registry
- [ ] Existing UI and public adapters share application services/reducers
- [ ] Plugin routes constrained to plugin namespaces and pass conformance suite
- [ ] UI commands deterministic and independent of component mount timing
- [ ] No raw Electron handles, absolute paths, secrets, provider credentials, or database URLs exposed
- [ ] Terminal/Git/file path confinement and config trust have regression tests
- [ ] Port change does not alter app origin/OAuth/IndexedDB
- [ ] Existing internal API behavior and E2E UI flows remain green
- [ ] Durable docs updated when the API ships

## 15. Highest-risk review areas

| Risk | Why | Mitigation |
| --- | --- | --- |
| write bearer becomes arbitrary local code execution | intended capability, high impact if leaked | loopback-only, show-once random token, explicit write warning, no logging, immediate revoke, scopes |
| duplicated UI/public behavior drifts | current logic lives in routes, clients, bridges | service/reducer extraction before public adapters; characterization tests |
| bearer cannot call GitHub | credential currently only in cookie | encrypted OAuth account prerequisite; 424 upstream reauth semantics |
| pane/control actions race human UI | renderer owns session state | snapshot revisions, deterministic commands, correlated acknowledgements |
| plugin route bypasses auth/schema | arbitrary router model is permissive | schema-first frozen registry; generated conformance tests |
| port setting breaks login/storage | current SPA origin is port-bound | separate public listener; reserve 4317 |
| revocation leaves live control socket | WS authenticates only at upgrade | token-indexed connections and active close notification |
| terminal/event output exhausts memory | high-volume untrusted consumers | byte caps, replay bounds, backpressure, slow-consumer isolation |
