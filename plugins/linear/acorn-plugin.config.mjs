// The loadable-package declaration for this plugin. apps/node/scripts/build-plugin.mjs reads it to
// build the bundles and generate `acorn-plugin.json`.
//
// `id: "linear"` comes from the directory name and must never change. It binds `/v2/p/linear`, the
// provider id on every `integrations` row, the `providerId` on every `task_links` row, and the
// `linear` task origin. Renaming it orphans user data.
//
// On the permissions:
//
//   secrets: false. The provider spends the owner's Linear token, but never through
//     `ctx.core.secrets`. Core resolves the `integrations` row inside its own secret scope and lends
//     the key to `withConnections` for the length of the call.
//   core: ['projects:read']. Only `byId` and `externalProjects`, to turn the rail's routed project
//     into the workspace's linked Linear projects. Creating and linking a task stays in the
//     host-owned promotion flow.
//   net. uploads.linear.app is not the API. A ticket body can point at a private upload, and a frame
//     can neither reach the network nor hold a credential, so the node half fetches the file and
//     hands the frame a `data:` URL (src/server/routes/linear.ts § /uploads).
//   api: ['core.tasks:read']. The pane frame reads `/v2/core/tasks` to find which tickets this task
//     links. The ref-panel frame needs none of it; one list covers both surfaces.
export default {
  name: 'Linear',
  // The Linear mark, as one SVG path's `d` in a 24 box. The host registers it as `brand:linear`,
  // which is why every `glyph: 'brand:linear'` resolves without this plugin shipping client code
  // that draws it. From simple-icons (CC0 artwork; trademark remains Linear's).
  icon: { color: '#5E6AD2', d: 'M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z' },
  entry: '@acorn/plugin-linear/node/index.ts',
  factory: 'linearPlugin',
  client: {
    entry: './src/frame/index.tsx',
    framework: 'solid',
  },
  permissions: {
    api: ['core.tasks:read'],
    events: [],
    node: { core: ['projects:read'], capabilities: [], secrets: false, exec: false, net: ['api.linear.app', 'uploads.linear.app'] },
  },
  contributions: {
    // Three surfaces, one bundle: it decides what to draw from `bridge.context`. `providerId` on the
    // reference panel must equal the plugin id or the client adapter refuses to register it.
    //
    // The two pane surfaces differ in what they are about:
    //
    //   linear        the tickets this task links. A task pane, opened by meta+shift+L or the
    //                 command, and where a `linear.app` URL in a note or an agent transcript
    //                 resolves.
    //   linear-issue  one ticket from the project's rail list, drawn beside it at `/p/:projectId`,
    //                 with no task anywhere. That is what `scope: 'project'` buys.
    //
    // Keep both. A project-scoped task pane breaks the keybinding, the command, and every content
    // link in a note.
    frames: [
      // `providerId` marks the task pane as a linked-items view: the host hides it on tasks with no
      // linear link (client-core plugins/frames/register.ts).
      { target: 'pane', id: 'linear', label: 'Linear', glyph: 'brand:linear', order: 90, providerId: 'linear' },
      { target: 'pane', id: 'linear-issue', label: 'Linear issue', glyph: 'brand:linear', scope: 'project' },
      { target: 'refPanel', id: 'linear-ref', label: 'Linear issue', providerId: 'linear' },
    ],
    // Keyed by identifier alone, while an issue is really (integrationId, identifier). Two connected
    // Linear workspaces whose teams share a prefix collide here. A rail row click carries
    // `<connection>:<identifier>` and so is unambiguous; only a hand-typed or copied URL is not. The
    // upgrade is a connection id in the path, not worth the URL noise until someone has two.
    //
    // The `/p/:projectId/x/linear/` prefix is the host's, minted from the plugin id. A path outside
    // it is a parse error rather than a plugin claiming core's project navigation.
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
      // The rail route reads `?project=` (src/server/routes/linear.ts), so the shell offers a project
      // picker on this source and re-fetches the list when the project changes.
      projectScoped: true,
      // `navigate`, not `openPane`: the detail belongs to the project, so clicking a row changes the
      // URL and the surface beside the list follows. It is also what mounts `linear-issue` at all.
      onSelect: { verb: 'navigate', surface: 'linear-issue' },
      // Message only, no action, because no verb in the context-free set reaches a settings page:
      // `openPane` addresses a task pane, `openUrl` leaves the app, and the settings modal is shell
      // state behind a client event with no descriptor form.
      //
      // It no longer offers to link projects either. The shell hides this source outright where the
      // workspace links none (client-core/tabs/sources.ts), so the two empty lists left to explain are
      // followed projects with nothing active in them, and a repository its workspace follows Linear
      // for but which follows no Linear project of its own.
      emptyState: { message: 'No active issues in the Linear projects this repository follows.' },
    }],
    // `openPane: 'linear'` is the task pane, deliberately not the project surface. A content link is
    // clicked inside a PR conversation, a note, or an agent transcript, and each of those has a task.
    //
    // Naming a pane here says an item can land in that pane; the `linear-ref` panel above says an
    // item can also be shown on its own, over whatever the reader was looking at. The clicking
    // surface picks which (client-core/registries/contentLinks.ts § ContentLinkPresentation). A
    // plugin with items but no task pane would omit `openPane` and get the panel alone.
    //
    // Two entries for one URL shape. The pattern grammar is exact-arity by design, a bounded
    // host/path form with no tail wildcard, so a manifest string cannot backtrack the renderer.
    // Linear's own "copy link" appends a title slug, and one entry would match only the short form.
    contentLinks: [
      { id: 'linear.issue', match: 'https://linear.app/{workspace}/issue/{identifier}', openPane: 'linear', item: 'identifier' },
      { id: 'linear.issue-slug', match: 'https://linear.app/{workspace}/issue/{identifier}/{slug}', openPane: 'linear', item: 'identifier' },
    ],
    // The enrichment half of the same relationship, and why github no longer depends on this package.
    // Resolves a set of identifiers across every connected workspace, with a ten-minute cache.
    refResolvers: [{ id: 'linear-refs', kind: 'linear.issue', resolve: '/v2/p/linear/issues' }],
    // The viewer's own active issues as typed records a user can compose a panel over
    // (@acorn/protocol/collections.ts). Scoped to the person, not to a project, which makes it a
    // different question from the rail source above.
    //
    // No static `schema`, deliberately. A Linear status is `{ name, type, color }` where only `type`
    // means the same thing in every workspace, and `name` is whatever that workspace called it. A
    // schema written here would render every board in vocabulary nobody there uses. The response
    // carries its own schema and folds the real names in (src/shared/collections.ts). The cost is
    // that a panel editor can offer no views until the first fetch.
    //
    // `refresh` is the only TTL a collection route without the sync engine has: Linear's reads fan
    // out across connections with per-item freshness, so there is no single resource for
    // `serveThenRevalidate` to hold. Ten minutes, matching LINEAR_ISSUES_STALE_AFTER_MS.
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
