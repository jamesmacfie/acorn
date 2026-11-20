# L-1. Loaded plugins can confer trust on a project checkout

Found November 20, 2026, in Acorn at `90b9e61e3`. Severity is medium. The project trust gap is
confirmed from source. Execution requires a later launch that consumes the checkout. Status is open.

## Evidence and impact

A loaded plugin with `projects:write` can create or clone a project that defaults to trusted.
It can also replace the path of an existing trusted project while preserving its trust flag.
A client plugin with the matching project-write scope can create a project or change its path.

- `packages/node-core/src/server/plugins/permissions.ts` exposes project writes to loaded plugins.
- `packages/node-core/src/server/projects/clone.ts` and
  `packages/node-core/src/server/db/schema.ts` own the default for a clone.
- `packages/node-core/src/server/projects/projects.ts` changes the path without resetting trust.
- `plugins/agents/src/server/untrusted.ts` and
  `plugins/agents/src/server/drivers/claudeHarness.ts` restrict checkout settings in untrusted projects.
- `packages/client-core/src/host/frames/scopes.ts` maps the client plugin scope to project routes.

An owner who later starts a harness in the trusted project can load repository settings and
hooks that this plugin lacks permission to execute. A changed path can also cause a previously
configured setup command to run against different project contents. Automatic setup reads the
project row in `packages/node-core/src/server/worktrees/taskWorktree.ts`. Run targets and
committed workflows have their own configuration approval controls.

## Fix and verification

Create plugin-supplied checkouts as untrusted. Reset trust when the folder changes and require a
paired device to confirm the changed checkout. Apply the same rule through the client routes.
Keep the plugin grant for project management separate from authorization to execute checkout
code. Make that distinction clear in the grant description.

Test both plugin paths and the core route. Verify that create and clone leave the new project
untrusted, that path changes reset trust, and that a harness startup in either case excludes
checkout-supplied settings and hooks until the owner grants trust.

See [untrusted projects](../../workspaces-and-tasks/projects.md#untrusted-projects) and
[plugin worker permissions](../../security/plugin-node-realm.md).
