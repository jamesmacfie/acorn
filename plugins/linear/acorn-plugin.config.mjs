// The loadable-package declaration for this plugin: what `apps/node/scripts/build-plugin.mjs` reads
// to build the bundles and generate `acorn-plugin.json`. It lives here, not in the build script, so
// the plugin's declared surface is visible from the plugin's own directory.
//
// The first plugin to use every kind of contribution at once, and the first to have another plugin
// rendering one of its surfaces: plugins/github draws `linear-ref` beside a pull request through the
// ref-panel registry, without importing linear.
//
// `id: "linear"` (the directory name, which the builder uses as the id) is load-bearing and must
// never change. It binds `/v2/p/linear`, the provider id on every stored `integrations` row, the
// `providerId` on every `task_links` row, and the `linear` task origin. Renaming it orphans real
// user data.
//
// On the permissions, and where they differ from what the migration brief guessed:
//
//   secrets: false — the brief expected `true` "because the provider spends the owner's Linear token",
//     and it does, but never through `ctx.core.secrets`. Core resolves the `integrations` row inside
//     its own secret scope and lends the key to `withConnections` / a mirrored resource for the length
//     of the call. `true` here would be a grant with no call site, and a disclosure that overstates.
//   core: ['projects:read'] — only `byId` and `externalProjects`, to turn the rail's routed project
//     into the workspace's linked Linear projects. Not `projects:config` (no scripts), not
//     `projects:write`, no `tasks` facet: creating and linking a task stays in the host-owned
//     promotion flow, which is why the frame's `api` list has no task WRITE scope either.
//   api: ['core.tasks:read'] — the pane frame reads `/v2/core/tasks` to find which tickets this task
//     links. The ref-panel frame needs none of it; one list covers both surfaces, which is the
//     coarsest thing here and the reason it stays a one-item list.
export default {
  name: 'Linear',
  // The Linear mark, as one SVG path's `d` in a 24 box. The host validates the grammar and registers
  // it as `brand:linear` under the id it stamps from this package's directory, which is why every
  // `glyph: 'brand:linear'` below and in src/server/provider.ts resolves without this plugin owning
  // any client code that draws it. From simple-icons (CC0 artwork; trademark remains Linear's).
  icon: { d: 'M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z' },
  entry: '@acorn/plugin-linear/node/index.ts',
  factory: 'linearPlugin',
  client: {
    entry: './src/frame/index.tsx',
    framework: 'solid',
  },
  permissions: {
    api: ['core.tasks:read'],
    events: [],
    node: { core: ['projects:read'], capabilities: [], secrets: false, exec: false, net: ['api.linear.app'] },
  },
  contributions: {
    // THREE surfaces, one bundle: it decides what to draw from `bridge.context`. `providerId` on the
    // reference panel must equal the plugin id or the client adapter refuses to register it.
    //
    // `linear-issue` is the surface the move to a loaded package lost, and getting it back is what
    // `scope: 'project'` is for. Linear genuinely has two pane-shaped views and they differ in what
    // they are ABOUT, not in how they look:
    //
    //   linear        the tickets THIS TASK links. A task pane, opened by meta+shift+L or the command,
    //                 and the target a `linear.app` URL inside a note or an agent transcript resolves
    //                 into — all of which need a task, and have one.
    //   linear-issue  ONE ticket from the project's rail list, drawn beside it at `/p/:projectId`, with
    //                 no task anywhere. This is where the old `SourceRouteContribution` pointed, and
    //                 without it every rail row click outside a task was refused with "open a task
    //                 first — this opens a pane, and a pane belongs to a task."
    //
    // Keeping BOTH is why nothing regresses. Had the task pane simply become project-scoped, the
    // keybinding, the command and every content link in a note would have quietly stopped resolving.
    frames: [
      { target: 'pane', id: 'linear', label: 'Linear', glyph: 'brand:linear', order: 90 },
      { target: 'pane', id: 'linear-issue', label: 'Linear issue', glyph: 'brand:linear', scope: 'project' },
      { target: 'refPanel', id: 'linear-ref', label: 'Linear issue', providerId: 'linear' },
    ],
    // Keyed by identifier alone, while an issue is really (integrationId, identifier) — the same
    // trade-off the compiled route made, with the same reasoning: two connected Linear workspaces whose
    // teams share a prefix would collide here. A rail row click carries `<connection>:<identifier>` and
    // so is unambiguous; only a hand-typed or copied URL is, and the upgrade is a connection id in the
    // path, not worth the URL noise until someone has two.
    //
    // The prefix is the HOST's: `/p/:projectId/x/linear/` is minted from the plugin id, and a path
    // outside it is a parse error rather than a plugin quietly claiming core's project navigation.
    routes: [{
      id: 'linear.issue-route',
      path: '/p/:projectId/x/linear/issues/:identifier',
      surface: 'linear-issue',
      item: 'identifier',
      order: 60,
    }],
    sources: [{
      id: 'linear-issues',
      label: 'Linear',
      glyph: 'brand:linear',
      order: 20,
      providerId: 'linear',
      items: '/v2/p/linear/rail-items',
      // `navigate`, not `openPane`: the detail belongs to the project, so clicking a row changes the URL
      // and the surface beside the list follows. It is also what mounts `linear-issue` at all.
      onSelect: { verb: 'navigate', surface: 'linear-issue' },
      // Message only, and the missing action is the honest part. The destination is Settings → this
      // workspace → Linked provider projects, and NO verb in the context-free set can reach it:
      // `openPane` addresses a task pane, `openUrl` leaves the app, and the settings modal is shell
      // state behind a client event with no descriptor form. Rather than widen the verb set for one
      // caller, the state says where to go and the person goes there. Recorded as a gap in
      // docs/third-party/linear.md § finding 1.
      emptyState: { message: 'No linked Linear projects. Choose some in Settings → this workspace → Linked provider projects.' },
    }],
    // Still `openPane: 'linear'`, the TASK pane, and deliberately not the project surface. A content link
    // is clicked inside something — a PR conversation, a note, an agent transcript — and every one of
    // those already has a task or its own better answer.
    //
    // It is no longer the only destination, and that is the interesting part. Naming a pane here says
    // "an item can land in this pane"; the `linear-ref` panel above says "an item can also be shown on
    // its own, over whatever the reader was looking at". WHICH of the two a click gets is the clicking
    // surface's call, not this file's — a PR conversation asks for the panel so the reader keeps their
    // place, a note takes the pane (client-core/registries/contentLinks.ts § ContentLinkPresentation).
    // A plugin with items but no task pane would omit `openPane` entirely and get the panel alone.
    //
    // TWO entries for one URL shape, and that is the finding rather than a style choice. The pattern
    // grammar is exact-arity by design — a bounded host/path form with no tail wildcard, so a manifest
    // string cannot backtrack the renderer — and Linear's own "copy link" appends a title slug. One
    // entry would silently recognise only the short form, which is the rarer of the two in practice.
    contentLinks: [
      { id: 'linear.issue', match: 'https://linear.app/{workspace}/issue/{identifier}', openPane: 'linear', item: 'identifier' },
      { id: 'linear.issue-slug', match: 'https://linear.app/{workspace}/issue/{identifier}/{slug}', openPane: 'linear', item: 'identifier' },
    ],
    // The enrichment half of the same relationship, and the reason github no longer depends on this
    // package at all. The route already existed and already had these semantics — resolve a set of
    // identifiers across every connected workspace, ten-minute cache — so declaring it is one row; what
    // changed is that its answer is now the host's shape rather than a Linear-flavoured one.
    refResolvers: [{ id: 'linear-refs', kind: 'linear.issue', resolve: '/v2/p/linear/issues' }],
    // The viewer's own active issues as typed records a user can compose a panel over
    // (@acorn/protocol/collections.ts). Scoped to the PERSON, not to a project — which is what makes it
    // a different question from the rail source above rather than the same one in a second shape.
    //
    // NO static `schema`, deliberately. A Linear status is `{ name, type, color }` where only `type`
    // means the same thing in every workspace and `name` is whatever this workspace called it — so a
    // schema written here would render every board in vocabulary nobody in that workspace uses. The
    // response carries its own schema instead and folds the real names in (src/shared/collections.ts).
    // The cost is that a panel editor can offer no views until the first fetch, which is the trade the
    // optional field exists for.
    //
    // `refresh` is this plugin's, and it is the only TTL a collection route without the sync engine has:
    // Linear's reads fan out across connections with per-item freshness, so there is no single resource
    // for `serveThenRevalidate` to hold. Ten minutes, matching LINEAR_ISSUES_STALE_AFTER_MS.
    collections: [{
      id: 'issues-mine',
      name: 'My Linear issues',
      items: '/v2/p/linear/collections/issues-mine',
      refresh: 600,
    }],
    commands: [{
      id: 'open',
      title: 'Linear: open linked issues',
      category: 'pane',
      palette: false,
      action: { verb: 'openPane', pane: 'linear' },
    }],
    keybindings: [{ command: 'open', defaultChord: 'meta+shift+l', when: 'task' }],
  },
}
