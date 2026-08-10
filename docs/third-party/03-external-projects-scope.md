# 03 — Provider-scoped external project mappings

**Resolved.** Original severity: medium.

## Resolution

The connection-provider registry exposes the provider ids owned by a host-bound plugin id.
`scopeCore` wraps `externalProjects` for every loaded plugin and resolves that owner set lazily,
after the plugin has registered its providers. The project service applies the provider predicate in
the database join, so foreign rows never cross the service boundary. An explicit empty provider set
returns no rows; omitting the set remains the core-owned, unscoped form.

Tests cover provider A versus provider B, the empty-owner case, registry ownership, the wrapper's
complete project-method classification and the database-level filter. Built-ins still receive the
original unscoped `CoreServices` object because they never pass through `scopeCore`.

## Original finding

The migration needed the Rollbar node half to know which projects are in scope for a workspace
without handing it the core database. The new facet
(`packages/node-core/src/main/core/projects.ts`):

```ts
externalProjects(workspaceId: string): Promise<Array<{ connectionId: string; externalId: string }>>
```

returns **every** `workspace_external_projects` row for that workspace — every provider's, not the
caller's. The comment says the consumer "intersects these opaque ids with its own request-scoped
connection list", and Rollbar does exactly that. But nothing enforces it: the API hands over the
whole table slice and trusts the caller to narrow it.

It is granted by `projects:read` (`PROJECT_READS` in `pluginPermissions.ts`), so any loaded plugin
holding that token gets it, including plugins that are not integration providers and have no
connections of their own to intersect against.

## Why it matters

The values are not credentials, and the ids are opaque, so this is disclosure rather than
escalation. But it is disclosure across a boundary the codebase has already ruled on twice:

- `docs/plugins.md`: plugins do not read one another's data; cross-plugin references resolve
  through typed CoreServices or capability contracts.
- The frame bridge marks `/v2/core/integrations` **permanently unmappable**, with the note
  "Connected-account rows. Cross-plugin reads happen server-side via capabilities, never here."

`externalProjects` reopens a narrow version of that on the node side. A plugin with `projects:read`
can enumerate which connections exist in a workspace and which external project each is mapped to
— which provider accounts a user has wired up, and their project identifiers. `externalId` is not
always meaningless: for several providers it is a human-readable project slug.

It also makes `projects:read` mean more than its trust-prompt line says. That grant already carries
one surprise the review process caught before — `checkouts()` returning the on-disk path of every
codebase, which is why the prompt names it explicitly. Quietly adding "and every provider
connection in the workspace" to the same token repeats the pattern the earlier fix was meant to
stop.

## Fix

Scope it to the caller. `scopeCore(core, permissions, pluginId)` already builds this service
per-plugin, so the plugin id is in hand, and the connection provider registry already records
which provider each plugin owns (`connectionProviderRegistry.register(provider, plugin.name)`).

```ts
// pluginPermissions.ts, alongside prefsFor
const projectsFor = (projects: ProjectService, pluginId: string): ProjectService => ({
  ...projects,
  externalProjects: async (workspaceId) => {
    const mine = await connectionIdsOwnedBy(pluginId)          // from the provider registry
    return (await projects.externalProjects(workspaceId))
      .filter((row) => mine.has(row.connectionId))
  },
})
```

Then the "intersect with your own connections" step in Rollbar's node half becomes redundant — it
can keep it harmlessly, but the API is safe by construction rather than by convention, which is the
difference between a contract and a comment.

Built-ins keep the unscoped service, as they do for `prefs`, and for the same reason: they are the
app.

Two smaller points while in here:

- **Consider its own token.** If a non-provider plugin ever has a legitimate need for this, it
  should ask for it by name rather than inherit it from `projects:read`. `projects:connections`
  would follow the split that already worked for `projects:config`. Not required if the scoping
  above lands — a plugin can then only see its own connections, which is not worth a separate
  grant — but worth a sentence in the facet's comment saying that is why.
- **The prompt line.** If scoping lands, `projects:read`'s existing wording still holds. If it does
  not, the trust prompt must name this disclosure the way it names `checkouts()`.

## Tests

`pluginPermissions.test.ts`, in the style of the existing facet tests:

- A plugin owning provider A sees only A's rows for a workspace containing A and B mappings.
- A plugin owning no provider sees an empty list rather than an error.
- A built-in receives the unscoped service (identity check against `core.projects`).
- Exhaustive over `ProjectService` keys, so a facet added later must be classified rather than
  inherited — the file already does this for the project tokens; extend it to cover the wrapper.

## Acceptance record

No loaded plugin can learn that a connection it does not own exists.
