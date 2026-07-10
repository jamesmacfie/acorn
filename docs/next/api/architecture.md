# Architecture

## 1. Current system and the pressure this feature creates

Acorn already has most of the execution machinery required for automation, but it is split across
several boundaries:

- `core/main/server.ts` starts the SPA/internal Hono listener on `127.0.0.1:4317`, applies an exact
  Host guard, attaches the shared WebSocket, and serves the renderer.
- `core/server/index.ts` mounts the cookie/internal-token authenticated `/api/*` route tree.
- `core/server/routeRegistry.ts` accepts plugin Hono routers, while `app/server/routes.ts` statically
  chooses the built-in routes.
- `core/server/middleware/auth.ts` already resolves a principal abstraction, but only `user` and
  ephemeral `internal` principals exist and there is no scope gate.
- main-process bridge slots adapt routes to PTY, filesystem, Git, ripgrep, Postgres, worktree, and
  workflow services.
- the renderer owns presentation state: active source/task, pane layout, pane focus/maximize,
  terminal drawer state, agents panel state, overlays, and navigation.
- `core/client/registries/commands.ts` stores zero-argument closures. Many commands are registered
  only while a component is mounted and close over router params or Solid signals.
- the existing shared WebSocket carries terminal and workflow frames, but authenticates only a
  browser cookie or the app-run internal token.

The important consequence is that adding bearer auth to existing `/api/*` routes is necessary but
not sufficient. It would expose server/main actions, but it would not control panes, focus, active
tasks, settings dialogs, or overlays. Conversely, projecting renderer closures directly would make
the API nondeterministic, impossible to describe with strict schemas, and unavailable while the
owning component is unmounted.

## 2. Target topology

```text
                       Electron main process

  http://127.0.0.1:4317                 http://127.0.0.1:<apiPort>
  SPA + internal /api + /auth            public /api/v1 + public WebSocket
            |                                       |
   cookie/internal principal                  bearer principal
            |                                       |
            +----------- transport adapters -------+
                                |
                   typed application services
        workspace · task · worktree · terminal · git · files
        github · integrations · notes · memory · workflows
                                |
             SQLite · filesystem · PTY/tmux · upstream APIs
                                |
                        UI control broker
                                |
                     live renderer connection
          router · pane reducer · focus · overlays · terminal UI
```

There remain one database, one domain model, one service graph, and one composition root. Two
listeners enforce different trust contracts:

- the existing app listener is same-origin browser infrastructure and keeps its pinned origin;
- the automation listener is bearer-only, versioned, schema-first, and has no static files, OAuth,
  cookies, SPA fallback, or internal-token access.

### Why not change `ACORN_PORT` for the whole app?

The current port is part of the browser storage and OAuth identity. Changing it changes the origin,
which strands the session cookie and IndexedDB cache and requires a different GitHub OAuth callback.
An “API port” setting must not silently reset UI state or break login. A separate listener is the
smallest boundary that satisfies both requirements.

### Why not mount public routes beside `/api/*` on `4317`?

That can work technically, but the public port would not be independently configurable and it would
be easy for an internal route to become externally reachable through middleware ordering. Separate
app factories make the authentication and route allowlist structural.

## 3. New runtime components

### 3.1 `AutomationApiServer`

Main-owned lifecycle service that:

- reads machine-level API settings;
- constructs `createAutomationApp(dependencies)`;
- binds exactly `127.0.0.1:<port>`;
- enforces the exact `Host` header before Hono;
- attaches the public WebSocket upgrade handler;
- starts after migrations and service wiring, before the window is created;
- stops before domain services during application teardown;
- can rebind transactionally when the user changes the port: start the new listener first, persist
  only after it is listening, then stop the old listener.

The listener must never use `0.0.0.0`, `::`, LAN interfaces, Unix-domain proxying, or an automatic
fallback port. If the configured port is occupied, report a visible startup/settings error and keep
the prior working listener when possible.

### 3.2 `AutomationApiRegistry`

Core registry for schema-first route contributions. It owns:

- core and plugin namespace validation;
- duplicate method/path/operation-id rejection;
- scope enforcement;
- request and response validation;
- OpenAPI generation;
- endpoint and command discovery;
- test enumeration (every contribution can be tested for auth and schema behavior).

It does **not** accept an arbitrary `Hono` router. The existing `RouteRegistry` stays for internal
routes until those routes are migrated or retired.

### 3.3 Application services

Handlers must not call existing internal routes over loopback and must not duplicate domain logic.
Extract behavior currently embedded in route modules or UI mutation helpers into feature-owned
services. Example:

```text
plugins/changes/main/localGitService.ts
  used by internal /api/tasks/:id/local/* adapter
  used by public /api/v1/plugins/changes/tasks/:taskId/git/* adapter
  used by agent-tool projection where applicable
```

Services take an explicit operation context, typed input, and dependencies. They return domain
results or throw typed domain errors. They do not depend on Hono, cookies, `Request`, Solid signals,
or response objects.

```ts
type OperationActor = {
  principalId: string
  principalKind: 'browser' | 'internal' | 'api-token'
  tokenId?: string
}

type OperationContext = {
  actor: OperationActor
  signal: AbortSignal
  requestId: string
}
```

Mutation provenance must derive from this context rather than a body field.

### 3.4 UI control broker

Presentation commands require a live renderer. Add a main-owned broker with one control connection
per window. The renderer registers after startup restore and reports a serializable state snapshot.

Public request flow:

1. validate the bearer and command payload;
2. resolve the target window (`primary` by default in the current single-window app);
3. enqueue `{ requestId, commandId, input }` over the internal app WebSocket;
4. renderer looks up the typed command, checks current availability, executes it, and returns a
   success or structured failure acknowledgement;
5. broker resolves the HTTP request or times out after five seconds;
6. renderer emits a new state snapshot/event after the reducer or router transition settles.

The broker is not a second state store. The existing reducer/signal/router owners remain the writers.
The broker is a typed crossing for live presentation state.

If no target renderer is ready, presentation reads and commands return `409 ui_unavailable`. Durable
resource operations continue to work headlessly.

### 3.5 Stored upstream identity

Current GitHub credentials live only in the stateless encrypted browser session. A bearer token has
no cookie, so full UI parity requires an encrypted server-side credential record. On successful
GitHub OAuth callback, persist the current GitHub token encrypted with `SESSION_ENC_KEY`, keyed by
the GitHub login. API tokens reference that login. See [authentication.md](./authentication.md).

This is not optional if public GitHub reads/writes are promised. Returning the browser's cookie to
the caller, asking callers to supply a GitHub token per request, or silently limiting bearer tokens
to cached data would violate the security model or the parity claim.

## 4. Request classes and data flow

### 4.1 Durable core mutation

`POST /api/v1/tasks` → bearer validation → `write` gate → strict schema → `TaskService.create` →
SQLite transaction → domain event → validated response.

No renderer is required. A caller may separately invoke `core.task.activate` to show the task.

### 4.2 Plugin mutation

`POST /api/v1/plugins/changes/tasks/:id/git/commit` → registry resolves the `changes` contribution →
scope/schema gates → `LocalGitService.commit` → worktree-confined Git process → event → response.

Core knows nothing about commit semantics.

### 4.3 Presentation command

`POST /api/v1/commands/core.pane.show` → command schema → UI broker → renderer command service →
`dispatchLayout` → persisted-state machinery → acknowledgement and state event.

### 4.4 Upstream mutation

`POST /api/v1/plugins/github/repos/:owner/:repo/pulls/:number/merge` → bearer validation → encrypted
GitHub credential lookup/decrypt → GitHub plugin service → upstream API → mirror invalidation/update →
event → response.

An invalid upstream credential returns `424 upstream_reauthentication_required`; it does not return
`401`, because the Acorn bearer token is still valid.

## 5. State ownership

| State | Authority | API behavior |
| --- | --- | --- |
| Workspaces, tasks, links, repo mappings | SQLite app-state | direct resource APIs |
| Worktrees, terminal sessions, workflows | main service + SQLite/filesystem | plugin APIs; reconciliation unchanged |
| GitHub/provider data | upstream, locally mirrored | plugin APIs use existing sync policy |
| Pane layouts and editor-open files | renderer persisted-state slices/prefs | typed UI commands; snapshot when renderer is live |
| Active source/task, focus, maximize, drawers, overlays | renderer session state | UI broker only; not faked headlessly |
| API tokens and encrypted upstream identity | new core SQLite tables | core auth service |
| API listener port/enabled setting | machine bootstrap config | core API settings service |

The API must not write IndexedDB or the prefs table behind the renderer's back. Presentation changes
go through the live owner so persistence, focus invariants, unknown plugin ids, and lifecycle eviction
continue to behave exactly as the UI does.

## 6. Lifecycle and failure rules

- Migrations and token services initialize before the public listener.
- Plugin API contributions register before `createAutomationApp()` freezes the registry.
- A missing main bridge is `503 capability_unavailable`, never a crash or `200 { ok: false }`.
- UI broker timeout is `504 ui_command_timeout`; lack of a renderer is `409 ui_unavailable`.
- Listener port conflicts are surfaced and do not cause an automatic port change.
- On shutdown, stop accepting API requests, reject pending broker requests with `503 shutting_down`,
  close public sockets, then dispose feature services in the existing reverse order.
- Public requests participate in the same reconciliation gates as early UI requests. They cannot
  archive tasks or start workflows before startup reconciliation completes.

## 7. Compatibility strategy

`/api/v1` is independent of the current internal `/api`. The implementation may ship incrementally:

1. public core reads;
2. core writes and token management;
3. local plugin operations;
4. UI commands;
5. upstream/provider operations;
6. events and streaming.

Do not proxy public requests into internal HTTP routes as an interim shortcut. An adapter may call an
already extracted bridge/service directly, but public schema and auth behavior must be correct from
its first release.

