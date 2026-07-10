# HTTP automation API

**Status:** implementation design · **Written against:** `b59bb4f` · **API version:** `v1`

This folder specifies a bearer-authenticated HTTP API that can inspect and control Acorn with the
same semantic reach as the desktop UI: configure repositories in workspaces, create and archive
tasks, manipulate panes, create and drive terminals, run configured or ad-hoc commands, edit files,
perform Git operations, control workflows, and invoke plugin-owned behavior.

This is an implementation handoff, not documentation for an already shipped API. The existing
cookie-authenticated `/api/*` routes remain the UI's internal transport until the implementation
described here lands.

## Documents

| Document | Purpose |
| --- | --- |
| [architecture.md](./architecture.md) | Current seams, target runtime, request flows, ownership, and why the public listener is separate from the SPA listener |
| [authentication.md](./authentication.md) | Bearer format, read/write scopes, storage, issuance, revocation, GitHub credential handling, and security invariants |
| [protocol.md](./protocol.md) | Versioning, strict Zod/OpenAPI contracts, envelopes, errors, pagination, idempotency, and compatibility rules |
| [core-api.md](./core-api.md) | Core system, API settings, workspace, repository-assignment, task, link, and presentation-state resources |
| [commands-and-ui.md](./commands-and-ui.md) | Typed command registry, live-renderer control broker, command discovery/invocation, and the complete core/UI command catalog |
| [terminal-git-files.md](./terminal-git-files.md) | Terminal, command execution, Git, worktree, editor, search, and native-boundary payloads |
| [plugin-api.md](./plugin-api.md) | Plugin endpoint contribution contract and the built-in GitHub, notes, memory, workflow, preview, database, Linear, and Rollbar surfaces |
| [events.md](./events.md) | Public WebSocket protocol, events, terminal streams, acknowledgements, replay, and revocation behavior |
| [implementation-plan.md](./implementation-plan.md) | Ordered implementation phases, exact target file structure, migrations, test gates, rollout, and done criteria |

## Architectural decisions

1. **Use a dedicated public listener.** Keep the existing SPA/internal API on
   `http://127.0.0.1:4317`. Serve the public API from
   `http://127.0.0.1:<configured-port>/api/v1`. Both listeners run in the same Electron main
   process and share one runtime, database, registries, and domain services. This is a second
   transport boundary, not a second backend.
2. **Bind only to `127.0.0.1`.** The bind address is not configurable. The port is configurable;
   the network exposure is not.
3. **Require bearer auth on every public route and WebSocket upgrade.** There are no anonymous
   health, discovery, documentation, or plugin routes.
4. **Offer exactly two public scope sets.** A token is either `read` or `read + write`. `write`
   is never issued without `read`. Process execution, terminal input, Git mutation, file writes,
   UI control, and upstream mutations all require `write`.
5. **Revocation is immediate.** A revoked token returns `401` on its next HTTP request and closes
   existing public WebSockets before they can perform another operation.
6. **Make schemas executable.** Every path, query, header, body, success response, error response,
   command input, event payload, and plugin endpoint uses a strict runtime Zod schema. Unknown
   object properties fail validation. The same registry generates OpenAPI.
7. **Do not expose existing Hono routers wholesale.** Current `/api/*` routes include legacy casts,
   permissive objects, cookie assumptions, and internal-only operations. Public endpoints are new
   schema-first adapters over extracted application services.
8. **Plugins own plugin APIs.** Core provides the authenticated registry and transport. A plugin
   declares its endpoints, schemas, scope, handler, events, and commands under its own namespace.
9. **Prefer resource routes for durable behavior and commands for presentation behavior.** Creating
   a task is `POST /tasks`; focusing it in the window is a typed command. This keeps headless
   automation independent of renderer availability.
10. **No generic `execute arbitrary registered closure` escape hatch.** Commands are statically
    described, schema-validated contributions. A mounted Solid component and its captured closure
    are not an API contract.

## Surface ownership

| Surface | Owner | Works with no renderer? | Required scope |
| --- | --- | ---: | --- |
| Health, capabilities, catalog, workspace/task reads | core | yes | `read` |
| Workspace/task mutations and API settings | core | yes | `write` |
| Active task, pane row, terminal drawer, overlays, focus | core UI command projection | no | `write` |
| Terminal sessions, processes, run targets | `terminal` plugin | yes | read/write by method |
| Worktree status and Git actions | `changes` plugin | yes | read/write by method |
| File listing/read/write and search | `editor` plugin | yes | read/write by method |
| PR reads and GitHub mutations | `github` plugin | yes, with stored upstream credential | read/write by method |
| Notes, memory, workflows, preview, database | owning plugin | generally yes; preview presentation needs renderer | read/write by method |
| Linear and Rollbar resources/actions | owning provider plugin | yes, with connected provider | read/write by method |

## Deliberate boundaries

“Everything available in the UI” means every **serializable product operation** has an API home.
It does not mean exposing raw Electron capability handles.

- The native folder chooser is not remotely invocable. Callers set a path with a strict path
  payload; the desktop UI may still use the chooser to obtain that value.
- Preview's raw `WebContentsView` id and DevTools Protocol handles never cross the public API.
- OAuth login and the one-time display of a newly minted API token remain interactive security
  ceremonies. A bearer token cannot mint replacement bearer tokens using only `write` scope.
- Quitting the application is intentionally not a public command in `v1`; it would terminate the
  authority serving the request and is not required to manipulate Acorn's product state.
- The public API does not expose arbitrary SQLite access. The database plugin operates only on the
  task-configured Postgres connection, matching the pane.

These are security boundaries, not parity omissions.

## Completion standard

The API is complete only when all of the following hold:

- every endpoint and command in these documents is registered and appears in generated OpenAPI;
- every UI mutation and every public endpoint calls the same application service or pure reducer;
- read-only tokens cannot cause durable, process, upstream, or presentation mutation;
- revocation makes HTTP calls return `401` and closes live sockets;
- changing the API port never changes the SPA origin, OAuth callback, or IndexedDB origin;
- every built-in plugin passes the endpoint-contribution conformance suite;
- all payloads reject unknown keys and invalid discriminants at runtime;
- no API response contains an API token secret, GitHub token, integration credential, database URL,
  command environment secret, or session cookie;
- `pnpm lint`, `pnpm test`, and the focused Electron E2E API suite pass.

