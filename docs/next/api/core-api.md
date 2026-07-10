# Core HTTP API

All paths below are relative to `/api/v1`, require bearer auth, and use the envelopes from
[protocol.md](./protocol.md). Tables name the minimum scope. A `write` token includes `read`.

## 1. Core schemas

```ts
const WorkspaceIconSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('emoji'), value: z.string().min(1).max(16) }),
  z.strictObject({ kind: z.literal('lucide'), value: z.string().min(1).max(80) }),
  z.strictObject({ kind: z.literal('github') }),
])

const WorkspaceRepoSchema = z.strictObject({
  owner: OwnerSchema,
  name: RepoNameSchema,
  sort: z.number().int().nonnegative(),
})

const WorkspaceSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1).max(120),
  isDefault: z.boolean(),
  sort: z.number().int().nonnegative(),
  setupScript: z.string().nullable(),
  setupScriptTrigger: z.enum(['off', 'created', 'terminal']).nullable(),
  devScript: z.string().nullable(),
  devRestartScript: z.string().nullable(),
  teardownScript: z.string().nullable(),
  dbUrlScript: z.string().nullable(),
  previewMode: z.enum(['url', 'port', 'script']).nullable(),
  previewValue: z.string().nullable(),
  icon: WorkspaceIconSchema.nullable(),
  color: z.string().nullable(),
  repos: z.array(WorkspaceRepoSchema).max(10_000),
  createdAt: UnixMillisSchema,
  updatedAt: UnixMillisSchema,
})

const ExternalRefSchema = z.strictObject({
  providerId: z.string().min(1).max(100),
  connectionId: IdSchema,
  displayId: z.string().min(1).max(512),
  externalId: z.string().min(1).max(1024).optional(),
  url: z.url().optional(),
  locator: z.record(z.string().min(1).max(100), z.string().max(4096)).optional(),
})

const TaskLinkSchema = z.strictObject({
  connectionId: IdSchema,
  providerId: z.string().min(1).max(100),
  identifier: z.string().min(1).max(512),
  ref: ExternalRefSchema.optional(),
})

const TaskSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1).max(240),
  origin: z.string().min(1).max(100),
  repoOwner: OwnerSchema,
  repoName: RepoNameSchema,
  branch: BranchSchema,
  worktreePath: z.string().nullable(),
  pullNumber: z.number().int().positive().nullable(),
  status: z.enum(['active', 'archived', 'cancelled']),
  parentId: IdSchema.nullable(),
  sort: z.number().int().nonnegative(),
  links: z.array(TaskLinkSchema).max(100),
  createdAt: UnixMillisSchema,
  updatedAt: UnixMillisSchema,
  archivedAt: UnixMillisSchema.nullable(),
})
```

`origin`, `providerId`, and plugin-contributed ids stay open strings. The relevant registry validates
installed contributions when an operation requires one. Persisted unknown ids remain inert rather
than making old rows unreadable.

## 2. System and discovery

| Method | Path | Scope | Response |
| --- | --- | --- | --- |
| `GET` | `/health` | `read` | process/version/readiness summary |
| `GET` | `/capabilities` | `read` | active core/plugin/capability catalog |
| `GET` | `/principal` | `read` | current token metadata, never the secret |
| `GET` | `/openapi.json` | `read` | generated OpenAPI 3.1 document |
| `GET` | `/plugins` | `read` | installed plugin descriptors and their API prefixes |
| `GET` | `/agent-tools` | `read` | safe tool name/description/risk/availability catalog |

```ts
const HealthSchema = z.strictObject({
  status: z.enum(['ready', 'starting', 'degraded', 'shutting-down']),
  version: z.string(),
  apiVersion: z.literal('v1'),
  startedAt: UnixMillisSchema,
  now: UnixMillisSchema,
  reconciliationComplete: z.boolean(),
})

const CapabilitiesSchema = z.strictObject({
  desktop: z.boolean(),
  rendererConnected: z.boolean(),
  terminal: z.boolean(),
  worktrees: z.boolean(),
  plugins: z.array(z.strictObject({
    id: z.string(),
    version: z.string().optional(),
    available: z.boolean(),
    unavailableReason: z.string().optional(),
  })),
})

const PrincipalResponseSchema = z.strictObject({
  tokenId: IdSchema,
  name: z.string(),
  prefix: z.string(),
  scopes: ApiScopesSchema,
  user: z.strictObject({ login: z.string(), name: z.string(), avatar: z.string() }),
  expiresAt: UnixMillisSchema.nullable(),
})
```

`/health` is authenticated. A local process should not learn that Acorn is installed or which
plugins/capabilities are active without a token.

## 3. API listener settings

Settings are machine-scoped, not GitHub-user prefs. Store them in an atomic JSON bootstrap file
under the Acorn data root because the port must be known independently of a logged-in user and
before the public listener starts.

```ts
const ApiServerSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  port: PortSchema,
})

const PatchApiServerSettingsSchema = z.strictObject({
  enabled: z.boolean().optional(),
  port: PortSchema.optional(),
}).refine((v) => Object.keys(v).length > 0, 'At least one setting is required')
```

| Method | Path | Scope | Body | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/settings/api` | `read` | — | `ApiServerSettings` plus effective bind address |
| `PATCH` | `/settings/api` | `write` | `PatchApiServerSettings` | new settings and `rebound` flag |

Rules:

- default port is `4318`; default `enabled` is `false` until the first token is created or the user
  explicitly enables it;
- creating the first token may enable the listener with confirmation; revoking the last token does
  not auto-disable it, so revoked credentials receive the required `401` rather than connection refusal;
- `ACORN_API_PORT`, when set, is an environment override and makes `port` read-only until restart
  without the override; return `409 setting_overridden` on attempted change;
- `4317` is rejected because it is reserved for the app listener;
- changing the port starts the new listener first. On `EADDRINUSE`, return `409 port_in_use` and
  retain the current settings/listener;
- disabling through the public API sends the success response, closes public sockets, then stops
  the listener. Re-enabling must happen in desktop settings or at next startup from configuration;
- the bind address is always `127.0.0.1` and absent from the patch schema.

## 4. Preferences and pinned repositories

Public preferences are registry-backed typed values, not arbitrary access to the current stringly
`prefs` table. Each persisted-state/preference contribution that is safe to automate declares a
public schema, scope (`app`, `workspace`, or `task`), default, and sensitivity flag. Secret or
write-only values are never public preferences.

```ts
const PreferenceDescriptorSchema = z.strictObject({
  key: z.string().min(1).max(200),
  pluginId: z.string().min(1).max(100),
  scope: z.enum(['app', 'workspace', 'task']),
  description: z.string(),
  valueSchema: z.record(z.string(), z.unknown()),
  writable: z.boolean(),
})
const PreferenceValueSchema = z.strictObject({
  key: z.string(),
  scopeId: z.string().nullable(),
  value: z.unknown(), // validated by the registered preference schema
  updatedAt: UnixMillisSchema.nullable(),
})
const PutPreferenceSchema = z.strictObject({
  scopeId: z.string().min(1).max(200).nullable().default(null),
  value: z.unknown(),
})
```

| Method | Path | Scope | Body/query | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/preferences` | `read` | `pluginId?`, `scope?`, `scopeId?` | descriptors + current values |
| `GET` | `/preferences/:key` | `read` | `scopeId?` | descriptor + value |
| `PUT` | `/preferences/:key` | `write` | `PutPreference`, then contribution validation | stored typed value |
| `DELETE` | `/preferences/:key` | `write` | `scopeId?` | `204`, restore default |

The initial registry covers all current settings values: appearance/theme selection, keybinding
overrides, GitHub diff view/filter state, rail order, terminal default/height, onboarding completion,
agent-tool permissions, task layouts, editor-open files, and notices. Presentation-owned values such
as task layout still mutate through commands while a renderer is live; direct preference writes to
those keys return `409 presentation_owner_required` to avoid bypassing reducers.

Pinned repositories are a first-class ordered resource:

```ts
const PinnedRepoSchema = z.strictObject({ owner: OwnerSchema, name: RepoNameSchema, sort: z.number().int().nonnegative() })
const ReplacePinnedReposSchema = z.strictObject({ repos: z.array(PinnedRepoSchema.omit({ sort: true })).max(1000) })
```

| Method | Path | Scope | Body | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/pinned-repositories` | `read` | — | ordered pins |
| `PUT` | `/pinned-repositories` | `write` | complete ordered repo list | ordered pins |

`PUT` replaces the set and derives `sort` from array order, matching the current `/api/pins` behavior.

## 5. Workspaces

| Method | Path | Scope | Body/query | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/workspaces` | `read` | `limit`, `cursor` | page of `Workspace` |
| `POST` | `/workspaces` | `write` | `CreateWorkspace` | `201 Workspace` |
| `GET` | `/workspaces/:workspaceId` | `read` | — | `Workspace` |
| `PATCH` | `/workspaces/:workspaceId` | `write` | `PatchWorkspace` | updated `Workspace` |
| `DELETE` | `/workspaces/:workspaceId` | `write` | — | `204`; repos return to Default |
| `POST` | `/workspaces/bootstrap` | `write` | no body | bounded workspace list |
| `GET` | `/workspaces/:workspaceId/projects` | `read` | — | linked external projects |
| `PUT` | `/workspaces/:workspaceId/projects` | `write` | complete project set | updated project set |

```ts
const CreateWorkspaceSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  icon: WorkspaceIconSchema.nullable().optional(),
  color: z.string().nullable().optional(),
})

const PatchWorkspaceSchema = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  sort: z.number().int().nonnegative().optional(),
  setupScript: z.string().max(100_000).nullable().optional(),
  setupScriptTrigger: z.enum(['off', 'created', 'terminal']).nullable().optional(),
  devScript: z.string().max(100_000).nullable().optional(),
  devRestartScript: z.string().max(100_000).nullable().optional(),
  teardownScript: z.string().max(100_000).nullable().optional(),
  dbUrlScript: z.string().max(100_000).nullable().optional(),
  previewMode: z.enum(['url', 'port', 'script']).nullable().optional(),
  previewValue: z.string().max(4096).nullable().optional(),
  icon: WorkspaceIconSchema.nullable().optional(),
  color: z.string().nullable().optional(),
}).refine((v) => Object.keys(v).length > 0)

const WorkspaceProjectSchema = z.strictObject({
  integrationId: IdSchema,
  externalId: z.string().min(1).max(1024),
})

const ReplaceWorkspaceProjectsSchema = z.strictObject({
  projects: z.array(WorkspaceProjectSchema).max(1_000),
})
```

Validate `color` with the existing workspace identity validator. When `previewMode === 'port'`,
`previewValue` must be a bare integer 1–65535. Reject deletion of the Default workspace with
`409 cannot_delete_default`.

## 6. Repository assignments and local checkout mapping

Repository discovery is GitHub-plugin-owned. Workspace assignment is core because it defines the
Workspace → Task model.

```ts
const RepositoryAssignmentSchema = z.strictObject({
  owner: OwnerSchema,
  name: RepoNameSchema,
  workspaceId: IdSchema,
  ignored: z.boolean(),
  sort: z.number().int().nonnegative(),
})

const PutRepositoryAssignmentSchema = z.strictObject({
  workspaceId: IdSchema,
  ignored: z.boolean().default(false),
  sort: z.number().int().nonnegative().default(0),
})

const PatchRepositoryAssignmentSchema = z.strictObject({
  workspaceId: IdSchema.optional(),
  ignored: z.boolean().optional(),
  sort: z.number().int().nonnegative().optional(),
}).refine((v) => Object.keys(v).length > 0)
```

| Method | Path | Scope | Body | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/repository-assignments` | `read` | query `limit,cursor,workspaceId?,ignored?` | page |
| `PUT` | `/repository-assignments/:owner/:repo` | `write` | complete assignment | assignment |
| `PATCH` | `/repository-assignments/:owner/:repo` | `write` | partial assignment | assignment |

Ignoring preserves workspace membership, matching current behavior. There is intentionally no
`DELETE`: an assignment is a total partition and deleting it would create an invalid “unassigned”
state. Move it or mark it ignored.

Local checkout mapping and run-target fallback belong to the terminal plugin; see
[terminal-git-files.md](./terminal-git-files.md).

## 7. Tasks

| Method | Path | Scope | Body/query | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/tasks` | `read` | page + filters | page of tasks |
| `POST` | `/tasks` | `write` | `CreateTask`; idempotency required | `201 Task` |
| `GET` | `/tasks/:taskId` | `read` | — | `Task` |
| `PATCH` | `/tasks/:taskId` | `write` | `PatchTask` | updated `Task` |
| `POST` | `/tasks/:taskId/archive` | `write` | `ArchiveTask` | archived `Task` |
| `POST` | `/tasks/:taskId/restore` | `write` | no body | active `Task` |
| `GET` | `/tasks/:taskId/status` | `read` | — | worktree/dirty/session summary |
| `GET` | `/tasks/:taskId/config-trust` | `read` | — | current/previous hash and reviewed config text |
| `PUT` | `/tasks/:taskId/config-trust` | `write` | `{ hash }` | acknowledged trust state |

```ts
const TaskLinkInputSchema = z.strictObject({
  connectionId: IdSchema,
  identifier: z.string().min(1).max(512),
  providerId: z.string().min(1).max(100).optional(),
  ref: z.strictObject({
    displayId: z.string().min(1).max(512),
    externalId: z.string().min(1).max(1024).optional(),
    url: z.url().optional(),
    locator: z.record(z.string().min(1).max(100), z.string().max(4096)).optional(),
  }).optional(),
})

const CreateTaskSchema = z.strictObject({
  title: z.string().trim().min(1).max(240).optional(),
  origin: z.string().min(1).max(100),
  repoOwner: OwnerSchema,
  repoName: RepoNameSchema,
  branch: BranchSchema,
  pullNumber: z.number().int().positive().optional(),
  links: z.array(TaskLinkInputSchema).max(100).default([]),
  checkout: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('lazy-worktree') }),
    z.strictObject({ mode: z.literal('create-worktree') }),
    z.strictObject({ mode: z.literal('current-checkout') }),
  ]).default({ mode: 'lazy-worktree' }),
})

const PatchTaskSchema = z.strictObject({
  title: z.string().trim().min(1).max(240).optional(),
  sort: z.number().int().nonnegative().optional(),
}).refine((v) => Object.keys(v).length > 0)

const ArchiveTaskSchema = z.strictObject({
  deleteWorktree: z.boolean().default(true),
  force: z.boolean().default(false),
  skipTeardown: z.boolean().default(false),
})

const TaskStatusSchema = z.strictObject({
  taskId: IdSchema,
  worktreePath: z.string().nullable(),
  dirty: z.boolean(),
  dirtyCount: z.number().int().nonnegative(),
  missing: z.boolean(),
  runningSessionCount: z.number().int().nonnegative(),
  runningWorkflowCount: z.number().int().nonnegative(),
})

const ConfigTrustSchema = z.strictObject({
  taskId: IdSchema,
  repo: z.string().nullable(),
  trusted: z.boolean(),
  current: z.strictObject({
    hash: z.string(), text: z.string(),
    files: z.array(z.strictObject({ path: RelativePathSchema, content: z.string() })).max(100),
  }).nullable(),
  previous: z.strictObject({ hash: z.string(), text: z.string(), ackedAt: UnixMillisSchema }).nullable(),
})
const AcknowledgeConfigTrustSchema = z.strictObject({ hash: z.string().min(1).max(256) })
```

Task creation must be one application-service operation. The public adapter must not reproduce the
current client sequence of `POST task` followed by `on-created` or `use-checkout`. If immediate
worktree setup fails, roll back the task or return a clearly documented task with recovery state;
do not leave an unreported half-created task.

Archiving is an action rather than `DELETE`: the row is retained for history, teardown can fail, and
guards require options. `force` bypasses dirty/running-session refusal but does not imply
`skipTeardown`. `skipTeardown` is explicit because it changes workspace script behavior.

Trust acknowledgement accepts only the current reviewed hash; a stale hash returns
`409 config_changed`. It never accepts replacement config text or a blanket “trust this repo
forever” boolean.

Filters for `GET /tasks`:

```ts
const TaskListQuerySchema = PageQuerySchema.extend({
  status: z.enum(['active', 'archived', 'cancelled', 'all']).default('active'),
  workspaceId: IdSchema.optional(),
  repoOwner: OwnerSchema.optional(),
  repoName: RepoNameSchema.optional(),
  parentId: IdSchema.optional(),
})
```

## 8. Task links

| Method | Path | Scope | Body | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/tasks/:taskId/links` | `read` | — | bounded `TaskLink[]` |
| `POST` | `/tasks/:taskId/links` | `write` | `TaskLinkInput`; idempotency required | `201 TaskLink` |
| `DELETE` | `/tasks/:taskId/links/:connectionId/:identifier` | `write` | — | `204` |

Derive `providerId` from the connection server-side. If the optional claimed `providerId` does not
match, return `422 provider_mismatch`. Encode the identifier as one path segment.

## 9. UI windows and presentation snapshots

Presentation state is readable only while a renderer is connected.

```ts
const PaneLayoutSchema = z.strictObject({
  panes: z.array(z.string().min(1).max(200)).min(1).max(32),
  weights: z.record(z.string(), z.number().positive()).optional(),
  pinned: z.array(z.string().min(1).max(200)).max(32).optional(),
})

const WindowPresentationSchema = z.strictObject({
  windowId: z.string().min(1),
  primary: z.boolean(),
  ready: z.boolean(),
  route: z.string(),
  activeWorkspaceId: IdSchema.nullable(),
  activeTaskId: IdSchema.nullable(),
  selectedSourceId: z.string().nullable(),
  layouts: z.record(IdSchema, PaneLayoutSchema),
  focusedPane: z.strictObject({ taskId: IdSchema, paneId: z.string() }).nullable(),
  maximized: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('none') }),
    z.strictObject({ kind: z.literal('pane'), taskId: IdSchema, paneId: z.string() }),
    z.strictObject({ kind: z.literal('terminal'), taskId: IdSchema }),
  ]),
  terminalDrawer: z.strictObject({ taskId: IdSchema, open: z.boolean() }).nullable(),
  agentsPanel: z.strictObject({ taskId: IdSchema, open: z.boolean() }).nullable(),
  overlay: z.string().nullable(),
  revision: z.number().int().nonnegative(),
})
```

| Method | Path | Scope | Response |
| --- | --- | --- | --- |
| `GET` | `/ui/windows` | `read` | connected window summaries |
| `GET` | `/ui/windows/:windowId` | `read` | presentation snapshot |
| `GET` | `/ui/primary` | `read` | primary snapshot |

Mutation uses commands, not a giant partial-state patch. Commands preserve reducer invariants and
give each operation its own schema and availability result. See [commands-and-ui.md](./commands-and-ui.md).
