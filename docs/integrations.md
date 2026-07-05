# Integrations (Linear + Rollbar) and the Source model

How acorn connects to third-party issue/error providers, stores their credentials, mirrors their
data locally, and turns their items into tasks and agent context.

acorn treats external providers as pluggable **Sources**. Two are wired today: **Linear** (issues,
the more mature of the pair) and **Rollbar** (errors, newer and deliberately thinner). GitHub is a
Source too, but a special one — it is the identity root, not a stored connection.

---

## 1. The model — providers as pluggable Sources

- **GitHub is the identity root.** It is never stored in the `integrations` table. Its OAuth token
  lives inside the encrypted session cookie (`session.ts`), and the current user's `login` is derived
  from that cookie. GitHub only *appears* as a connection because the list endpoint **synthesizes**
  it: `{ id: 'github', provider: 'github', label: user.login, connected: true }`
  (`routes/integrations.ts`). It can never be disconnected (`400 cannot_disconnect_github`).
- **Linear and Rollbar are first-class and multi-connection.** A user can connect several of each —
  two Linear workspaces, one Rollbar token per project — and each is a distinct row in
  `integrations` keyed by an opaque `id`, with a human `label` seeded from the provider. The key is
  the opaque id, *not* `(userId, provider)`, precisely so duplicates of a provider coexist
  (`db/schema.ts:235`).
- **Tokens are encrypted at rest and never leave the server.** On connect, the pasted key is sealed
  with `encryptSecret` (JWE `dir` / A256GCM under `SESSION_ENC_KEY` — the same key the session cookie
  uses, `session.ts:48`) before it is written to `integrations.accessToken`. It is only ever
  decrypted in-process (`decryptSecret`) to make an outbound API call. The browser never receives it;
  the list/connect responses carry only `id`, `provider`, `label`, and a little `meta`. This is the
  same posture as the GitHub token.

Adding a provider is intentionally cheap: a thin client under `server/<provider>/`, a route file, a
`case` in the connect handler, and (for the browse UI) a logo case plus one CSS line
(`IntegrationsSettings.tsx:15`).

---

## 2. Data model

Four tables carry the integration model. All timestamps are epoch **milliseconds**.

| Table | Scope | Key | Purpose |
| --- | --- | --- | --- |
| `integrations` | per-user, multi-row | `id` (uuid) | The connection: `provider`, `label`, encrypted `accessToken`, optional `meta` JSON |
| `issues` | per-user | `(userId, integrationId, identifier)` | Generic serve-then-revalidate cache of fetched external items |
| `task_links` | machine | `(taskId, integrationId, identifier)` | A task's references to external items |
| `workspace_projects` | machine | `(workspaceId, integrationId, externalId)` | Provider projects linked at the workspace level |

**`integrations`** (`db/schema.ts:235`) — `provider` is `'linear' | 'rollbar'`; `label` is
user-facing (e.g. `Linear · Acme`, `Rollbar · web`); `meta` is optional JSON (Linear stores
`{ workspace }`, Rollbar stores `{ project, projectId }`).

**`issues`** (`db/schema.ts:487`) — the generic cache, provider-agnostic. A single JSON `data`
column holds the whole item so a provider's shape can evolve without a migration. It is keyed by
`integrationId` (not just provider) so the same `identifier` fetched through two different
connections never collides. `fetchedAt` drives serve-then-revalidate by a per-provider TTL. This is
a **mirror** table — disposable, rebuilt on demand.

**`task_links`** (`db/schema.ts:362`) — zero-or-more external items a task references. `provider` is
denormalized from the integration for cheap filtering. Crucially, `(integrationId, identifier)` is
exactly the PK tail of `issues`, so a link resolves straight to cached detail with no extra mapping.

**`workspace_projects`** (`db/schema.ts:326`) — a Linear/Rollbar project linked at the **Workspace**
level (a workspace is a group of repos). Because a project backs every repo in the workspace, "one
project → many repos" falls out for free. `integrationId` records which connection the project
belongs to, so a workspace can link projects across several Linears. This table is provider-agnostic
— it generalized an older `workspace_linear_projects` table and per-repo prefs key.

---

## 3. Connecting — `/api/integrations`

The `integrations` Hono router (`routes/integrations.ts`) is mounted at `/api/integrations`
(`server/index.ts`) and is the single surface for listing, connecting, and disconnecting — it is
provider-thin CRUD; the provider read surfaces live in `routes/linear.ts` and `routes/rollbar.ts`.

| Method | Route | Behaviour |
| --- | --- | --- |
| `GET` | `/api/integrations` | List: the synthesized `github` entry first, then every stored row mapped to `{ id, provider, label, connected, workspace? }` |
| `POST` | `/api/integrations` | Connect: `{ provider, token }`. Validates the key against the provider, seeds a label, encrypts and inserts a new row. Returns the new connection |
| `DELETE` | `/api/integrations/:id` | Disconnect one connection; cascades. `id === 'github'` → `400 cannot_disconnect_github` |

**Connect validates before it stores.** For Linear it runs `VIEWER_QUERY` and reads the workspace
name for the label; a rejected key returns `400 invalid_key`. For Rollbar it makes one cheap
`/project` call and labels from the project name. Only after a successful validation is the token
encrypted and the row written (`routes/integrations.ts`).

**Disconnect cascades** via `cascadeDeleteIntegration` (`src/server/db/cascade.ts`, colocated with
the schema since the schema declares no FKs): it deletes that connection's `workspace_projects`, its
cached `issues`, and its `task_links`, then the `integrations` row itself, in one `db.batch` — so
removing a connection cleans up everything downstream of it. Any future table keyed by
`integrationId` gets added there, not to the route.

**UI:** Settings → Integrations (`IntegrationsSettings.tsx`). A card list of every connection
(GitHub shown with a "Connected" badge and no disconnect button) plus an "Add integration" panel
that picks a provider chip, then takes the credential. The panel copy points to where each key
lives: Linear → Settings → Security & access → Personal API keys; Rollbar → project → Project Access
Tokens (read scope).

---

## 4. Linear

The Linear client (`server/linear/index.ts`) is a thin GraphQL wrapper — the sibling of the GitHub
client. It hits the single endpoint `POST https://api.linear.app/graphql` with a **personal API
key** placed raw in `Authorization` (no `Bearer` prefix — that is for OAuth tokens). `linearError`
normalizes HTTP status (401/403 → `linear_reauth`, else `linear_unavailable`), and `linearData`
throws on GraphQL/transport errors so a route's `catch` maps to 502.

**What is pulled.** Per issue: `identifier`, `title`, `url`, `branchName` (Linear's suggested git
branch — used as the promote default), `state`, `assignee`, `description`, `labels`, threaded
`comments`, and **activity history**. History is flattened by `buildActivity` into a chronological
feed, one line per change (state / assignee / label / title), with label IDs resolved to names via
the issue's current label set (`buildActivity`, `routes/linear.ts`).

### `/api/linear` routes

Mounted at `/api/linear` (`server/index.ts`, router in `routes/linear.ts`). Reads are per-user and
cached locally; they are never shared.

| Method | Route | Purpose | TTL |
| --- | --- | --- | --- |
| `GET` | `/projects` | Projects across **every** connected Linear, each tagged with its `integrationId`/label (a failing connection is skipped) | — |
| `GET` | `/project-issues?integration=&ids=` | Active issues (excludes completed/canceled) for project ids within **one** connection | — |
| `POST` | `/issues` | Batch summaries for a referenced set of identifiers | 10 min |
| `GET` | `/issues/:identifier` | Full detail for the side panel; `?refresh=1` always refetches | 10 min |
| `POST` | `/issues/:identifier/comments` | Add a comment (or threaded reply via `parentId`) | — |

The 10-minute TTL (`ISSUES_STALE_AFTER_MS`) reflects that tickets change slower than PRs; the detail
panel passes `refresh=1` on open to force a fresh read regardless.

**Filter shape.** `issuesFilter` groups identifiers by team key and matches exact numbers with
`number: { in: [...] }` in one filter object per team (`or`-unioned across teams). An `or` of
per-issue `{ team, number }` objects does *not* apply the number constraint in Linear's API, so that
shape is never used (`server/linear/index.ts:127`).

### Multi-connection identifier resolution

A bare identifier like `ENG-123` carries no hint of which Linear workspace owns it. `resolveIssues`
(`routes/linear.ts`) runs the query against each connected Linear in turn and returns the
first that yields nodes — recording which connection resolved it so the result is cached and any
comment is posted under the right `integrationId`. This is **first-hit-wins**: if two Linears both
own an identifier, the first row queried shadows the other. A documented `ponytail:` ceiling —
acceptable until colliding team prefixes across connected workspaces becomes real, at which point the
route would key resolution by a cached team-prefix → integration map (reused by the batch `/issues`
path). Project/browse routes avoid this ambiguity entirely by taking an
explicit `?integration=<id>` (the client already knows it).

The batch `/issues` endpoint applies the same idea at scale: it serves fresh cached rows, then tries
each connection for whatever is still stale, dropping resolved identifiers from the next pass and
caching each hit under its resolving connection.

### Where Linear surfaces in the UI

- **`LinearIssuePanel`** (`features/integrations/LinearIssuePanel.tsx`) — the side panel for one
  ticket. Fetches full detail on open (forced fresh), renders the description and threaded comments,
  replays the activity log, and offers inline reply + a bottom composer that posts through
  `POST /issues/:identifier/comments`. Ticket bodies arrive as raw markdown and go through a
  hand-rolled XSS-safe renderer (`features/integrations/markdown.ts`) — all text is HTML-escaped
  before any transform and links only emit validated `http(s)`/`mailto` hrefs.
- **`scanLinearRefs`** (`features/integrations/scanLinearRefs.ts`) — extracts Linear references from
  PR text (description / comments / reviews) so they can be linkified into the panel. Note it matches
  **`linear.app` issue URLs only**, not bare `ENG-123` tokens (too false-positive-prone, e.g.
  `HTTP-200`); a `ponytail:` note flags widening to prefix-scoped bare-id matching if users ask. Used
  from `PullDetail.tsx`.
- **`LinearBrowse`** (`features/tasks/LinearBrowse.tsx`) — the Linear **Source** browse. Linear
  projects are chosen per **workspace** (the picker spans all connected Linears and writes
  `workspace_projects`); the list shows active issues across the workspace's linked projects.
  Clicking an issue **promotes it to a task** on the current repo — `origin: 'linear'`, branch
  defaulting to the issue's `branchName`, and a `task_links` entry pinning the ticket to its owning
  integration.

---

## 5. Rollbar

Rollbar is the newer, thinner Source. Its client
(`server/rollbar/index.ts`) is a REST wrapper over `https://api.rollbar.com/api/1`, authenticating
with a project-read token in `X-Rollbar-Access-Token`. Rollbar wraps every response as
`{ err, result }`, so `rollbarData` treats a non-zero `err` (or HTTP failure) as an error.

An item is one of Rollbar's deduped errors, identified in acorn by its **visible `counter`** (the
`#142` you see in the UI). Fields carried: `title`, `level` (normalized from Rollbar's numeric levels
to words), `environment`, `status`, `total_occurrences`, and first/last occurrence timestamps
(converted from seconds to ms).

### `/api/rollbar` routes

Mounted at `/api/rollbar` (`server/index.ts:45`).

| Method | Route | Purpose | TTL |
| --- | --- | --- | --- |
| `GET` | `/items` | Recent active items across every connected Rollbar project, each cached into `issues` | 2 min |
| `GET` | `/items/:identifier?integration=` | One item's detail (the pane resolves `task_links` through this) | 2 min |

The 2-minute TTL (`ITEMS_STALE_AFTER_MS`) reflects that errors move fast. Both routes are
serve-then-revalidate against the cache and degrade gracefully: if the live call fails they fall back
to stale cached rows — **stale beats nothing** (`routes/rollbar.ts:114`).

**Zero new schema.** Rollbar reuses the generic `issues` table entirely (`provider: 'rollbar'`,
`identifier` = the counter). The source comment calls this the litmus test the Source contract was
built for — a whole second provider added without touching the schema.

### Where Rollbar surfaces in the UI

- **`RollbarPane`** (`features/integrations/RollbarPane.tsx`) — the provider pane for a task's linked
  errors. It resolves each `task_links` entry through `GET /api/rollbar/items/:identifier` (served
  from the `issues` cache), a chip strip switches between several linked items, and it shows level /
  status / environment / occurrence counts / timestamps.
- **`RollbarBrowse`** (`features/tasks/RollbarBrowse.tsx`) — the Rollbar **Source** browse: recent
  error items across connected projects. An error has no inherent repo/branch, so **promotion
  prompts for both** (branch defaults to a slug of the title). With a task already active, a row can
  instead **attach** to it via `POST /api/tasks/:id/links` — the common Rollbar flow, "this error
  belongs to the task I'm on".

---

## 6. How integrations feed tasks and agents

Sources produce tasks; `task_links` is the durable connection between a task and the external items
it concerns.

- A link is created two ways: at task birth (the `links` seed passed to `POST /api/tasks` from a
  browse promotion) or grown later (`POST /api/tasks/:id/links`, e.g. Rollbar's "+task").
  Disconnecting an integration cascades and removes its links.
- Links surface in the task view as the **Linear** and **Rollbar** panes, which resolve each link
  straight into cached detail (the `(integrationId, identifier)` PK match).
- Links flow into **assembled task context.** `GET /api/tasks/:id/context?include=issues`
  (`routes/taskContext.ts`) walks `task_links → issues.data` — the link's PK tail matches the cache
  exactly — so the linked tickets/errors ride along in the Context pane and in any agent context
  bundle without a second lookup.
- Agents read the same seam over MCP: the `linked_issues` tool
  (`mcp/server.ts:98`) returns "issues/errors linked to the current task (Linear tickets, Rollbar
  items), resolved from the local cache", with an optional `provider` filter. See
  [mcp.md](./mcp.md) and [notes-and-memory.md](./notes-and-memory.md) for how this composes with the
  rest of a task's assembled context.

---

## Source

- Server: `apps/desktop/src/server/routes/integrations.ts` (provider CRUD), `routes/linear.ts`,
  `routes/rollbar.ts`, `db/cascade.ts` (disconnect cascade), `linear/index.ts`, `rollbar/index.ts`,
  `session.ts` (`encryptSecret`/`decryptSecret`), `routes/taskContext.ts`.
- Schema: `apps/desktop/src/server/db/schema.ts` — `integrations`, `issues`, `task_links`,
  `workspace_projects`.
- Client: `apps/desktop/src/client/features/integrations/`
  (`IntegrationsSettings.tsx`, `LinearIssuePanel.tsx`, `RollbarPane.tsx`, `scanLinearRefs.ts`,
  `markdown.ts`) and `features/tasks/{LinearBrowse,RollbarBrowse}.tsx`.
- MCP: `apps/desktop/src/mcp/server.ts` (`linked_issues`).

See also: [workspaces-and-tasks.md](./workspaces-and-tasks.md) ·
[panes.md](./panes.md) · [data-layer.md](./data-layer.md) ·
[api-reference.md](./api-reference.md) · [authentication.md](./authentication.md) ·
[notes-and-memory.md](./notes-and-memory.md) · [mcp.md](./mcp.md)

