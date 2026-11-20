> **Completion note, November 20, 2026.** Fixed on the Acorn side, on branch
> `phase-l-1-loaded-plugins-can-t-make-trusted-projects`.
>
> What landed:
>
> - A loaded plugin's new project starts untrusted. `ProjectService.create` takes a `holder`, like
>   `update` and `clone` already did, and `scopeCore` passes the plugin's id. `createProjectRef` writes
>   `trusted: false` for a holder, both for a folder and for a project with no folder yet. A folder
>   that's already a project comes back unchanged, because its contents are the ones the owner trusted.
> - A loaded plugin's clone is untrusted, even if the call asks for `trusted: true`.
>   `clone.ts` `register` reads `context.holder` and ignores the input's flag for a plugin.
> - A folder change resets trust. `patchProject` sets `trusted: false` whenever `path` differs from the
>   stored one, null included. That one place covers `PATCH /v1/core/projects/:id`, a loaded plugin's
>   `update`, and a loaded plugin's clone that fills a placeholder. The one exception is a built-in's
>   `updateProjectRef` giving a placeholder its first folder (see the follow-up below). The owner trusts
>   a new folder through the existing device-only `POST /v1/core/projects/:id/trust`.
> - Client plugins get the same rule. A bridge table rule can now carry `fixedBody`, which holds
>   fields the broker writes over a frame's JSON body. `POST /v1/core/projects` uses it to send
>   `trusted: false`, so a frame can't leave the flag out or set it to true. The route accepts
>   `trusted: false` only, and refuses `true` with 400.
> - The `projects:write` text, both on the trust prompt and for frame scopes, now says that projects
>   the plugin adds or moves stay untrusted until you trust them. The plugin contract's comments
>   (`coreProjects.ts`), `projects.md`, `clone-runs.md`, and `loaded-plugins.md` say the same.
> - Tests: `projects.test.ts` covers a move, a same-folder patch, plugin and built-in creates, and a
>   placeholder's first folder from a built-in (trusted), a plugin, and the route (untrusted).
>   `clone.test.ts` covers a loaded plugin's clone asking for trust, and placeholder fills by a
>   built-in, by a loaded plugin, and by a built-in asking for `trusted: false`.
>   `apps/node` `importerClones.test.ts` holds a filled placeholder trusted for all three importers.
>   `routes/projects/projects.test.ts` covers the owner's create, a
>   frame's create, and a refused `trusted: true`, plus a move and then a device trust.
>   `broker.test.ts` shows the bridge forces the flag, even over a frame's `true`.
>   `permissions.test.ts` shows the holder reaches `create`. `plugins/agents` `runtime.test.ts` uses the
>   real core service: a loaded plugin's project, or a moved one, starts its next session locked down
>   (`untrusted: true`, so Claude Code loads user settings only), and after trust the next session isn't.
>
> Decisions and deviations:
>
> - The reset applies to every route caller, including the owner's own folder change in Settings,
>   even for a placeholder's first folder. The Node can't tell a plugin frame's request from the
>   owner's, because both carry the device's credential, and the finding asks a device to confirm the
>   changed checkout.
> - Follow-up, November 20, 2026: a built-in importer's fill of a placeholder stays trusted, like its
>   clone into a new row. Both come from the owner's same import flow, and a placeholder had no folder
>   for anyone to have trusted. `patchProject` takes `firstFolderKeepsTrust`, which only
>   `updateProjectRef` sets, and only with no holder. So the fill keeps the row's flag: a loaded
>   plugin's placeholder was created untrusted and stays that way. The route never sets it. Once a
>   project has a folder, even a built-in's move resets trust. `register` in `clone.ts` now applies
>   `trusted: false` after a fill as well as after a create, so a built-in that asks for an untrusted
>   clone gets one either way. I found no security reason to keep the fill untrusted. A caller that can
>   reach a built-in import route can already import into a new trusted row.
> - I forced the flag in the broker instead of stamping a frame header. A header would have to pass
>   through the desktop broker, the relay, and every host's transport. The body rewrite stays inside
>   client-core's bridge, which every host shares.
> - The old Node default stays as it was: a URL-less create through the owner's route, a CLI add, and a
>   built-in create are trusted. Only plugin-originated rows start untrusted.
> - I didn't raise `PLUGIN_API_MAJOR`. The public contract only gained comments.
> - Size: the Node service bundle went from 1,969,684 B to 1,969,792 B, which adds 108 B. The broker
>   change is client-side.
>
> For later phases: an older client paired with this Node doesn't force the flag yet, so a client
> plugin's create through that client is still trusted until the client updates. A Node move or a
> loaded plugin's call is fixed whatever the client. `fixedBody` is available to any other bridge
> route that needs to mark a frame's request. In a full run under load, `client-core`
> `iconCensus.test.ts` "holds for the real tree" hit its 5 s timeout once, then passed on its own.
>
> What acorn-cloud would still need: nothing. Projects and the bridge are local to the Node and its
> clients.

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
