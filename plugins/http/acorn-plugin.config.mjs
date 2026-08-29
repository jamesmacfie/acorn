// The loadable-package declaration for this plugin: what `apps/node/scripts/build-plugin.mjs` reads
// to build the bundles and generate `acorn-plugin.json`. It lives here, not in the build script, so
// the plugin's declared surface is visible from the plugin's own directory.
//
// The first plugin to move out with TABLES, which is why it is the one worth moving: it is the only
// candidate that exercises the whole storage path — a manifest-declared migrations directory staged
// inside the package, `ctx.storage.open()` with the database id bound from the manifest, and a schema
// change arriving through the installer against a database that already has rows in it.
//
// `id: "http"` (the directory name, which the builder uses as the id) is load-bearing and must never
// change. It binds `/v2/p/http`, the `http` pane's persisted layout key, and — the one that loses data
// rather than just breaking a link — `<dataRoot>/plugins/http.sqlite`. Renaming it orphans every saved
// request and every project variable on the machine.
//
// On the permissions, and where they differ from what the migration brief sketched:
//
//   exec: true — the brief did not list it, and the brief was wrong. `command`-kind variables run a
//     user-typed shell command at send time (server/send.ts runs `bash -lc` under a shared deadline), so
//     "Run commands on the node" is exactly what this plugin does. The call site is `node:child_process`
//     rather than `ctx.core.proc`, which does NOT make the disclosure an over-declaration: the manifest
//     block is what the owner is told about behaviour, and rung 1 shapes `ctx` for cooperative code —
//     it was never a sandbox (docs/security.md). database declares the same for the same reason.
//     Contrast rollbar/linear's `secrets: false`, which is the opposite case: there the plugin does not
//     touch the host service at all, and claiming it would have overstated.
//   secrets: true — unlike those two, this one really does call `ctx.core.secrets`, on every read and
//     write. Saved URLs, headers, bodies, auth blocks and variables are encrypted at rest with the
//     node's key, so the ciphertext cannot be opened without it.
//   core: ['tasks', 'projects:read', 'identity'] — `tasks.load` to check a task belongs to the project it
//     claims and `tasks.root` to resolve `{{worktree}}`; `projects.byId` for the project and its checkout
//     path. `identity` is the newest and the narrowest: the `http:request` workflow step (src/node/
//     workflowStep.ts) runs with no HTTP request to take an owner from, and the project's saved
//     variables are per-owner rows, so it asks core who this node is bound to. Not `projects:config`
//     (this plugin's commands come from its own tables, not from repo config), not `projects:write`, no
//     `prefs` (the brief listed it; nothing reads or writes one).
//   net: [] — and this is the honest awkward one. The plugin's node half calls `fetch` on whatever URL
//     the owner typed, which is the entire feature; there is no host list that describes "anywhere the
//     user points it", and the field is a declaration of INTENDED egress rather than an enforced
//     allowlist. Listing nothing says "this plugin has no destination of its own", which is true and is
//     the most useful thing it can say. What the owner needs to understand about this pane is on the
//     `exec` and `secrets` lines above, not here.
//   api: ['core.projects:read'] — one scope. The frame reads the project it was opened for (for its name)
//     and, on the settings surface, the project list to choose from. `core.tasks:read` is NOT declared:
//     the host hands the frame its `taskId` in `context`, and everything the panel does with a task goes
//     through this plugin's own routes, which need no bridge scope at all.
export default {
  name: 'HTTP',
  entry: '@acorn/plugin-http/node/index.ts',
  factory: 'httpPlugin',
  client: {
    entry: './src/tree/index.tsx',
    // The bundle runs in a worker and emits a tree of acorn's own component names; the builder maps
    // this key to the Vite transforms that compile JSX into that tree rather than into a document.
    framework: 'solid',
  },
  // Staged into the built package by the builder, and opened by the host from there. The chain in
  // `plugins/http/migrations` stays the source of truth and drizzle-kit keeps generating into it.
  migrations: './migrations',
  permissions: {
    api: ['core.projects:read'],
    events: [],
    node: { core: ['tasks', 'projects:read', 'identity'], capabilities: [], secrets: true, exec: true, net: [] },
  },
  contributions: {
    // The one thing this plugin does that a person reviewing the node would want to know about, and
    // could not otherwise see: a workflow step made an outbound request from this machine, unattended,
    // with the owner's saved variables and secrets resolved into it (src/node/workflowStep.ts).
    //
    // Deliberately not every send. The API pane is a person typing a request and watching the answer;
    // putting each of those on the trail would bury the unattended ones, which are the reviewable
    // event. The host qualifies this as `http:request.sent`.
    auditActions: [{ id: 'request.sent', label: 'Workflow sent an HTTP request' }],
    // THREE surfaces, one bundle: it decides what to draw from `bridge.context` (src/frame/app.tsx).
    //
    // `http` keeps its id because it is a persisted layout key — a task that has the API pane open has
    // that string in its stored layout, and prefixing or renaming it would silently close the pane for
    // everyone who had it open.
    //
    // `http-project` is the surface the move would otherwise have LOST. The compiled rail Source was a
    // whole panel component; a descriptor source is a list of rows the host draws, and a row click has to
    // land somewhere. `openPane` needs a task and the rail often has none, so the answer is the same one
    // linear reached: a project-scoped pane, mounted beside the list, addressed by the route below.
    frames: [
      // `single`, not `list-detail`, even though the panel is a split. The two columns share the
      // selection, the draft and the send result, and two regions are two renderers with no way to hold
      // one signal between them — so the split is a `ListDetail` inside the one tree.
      {
        target: 'pane',
        id: 'http',
        label: 'API',
        glyph: 'send',
        order: 76,
        layout: 'single',
        regions: { body: { kind: 'remote', entry: 'pane' } },
      },
      {
        target: 'pane',
        id: 'http-project',
        label: 'API requests',
        glyph: 'send',
        scope: 'project',
        layout: 'single',
        regions: { body: { kind: 'remote', entry: 'pane' } },
      },
      {
        target: 'settings',
        id: 'http-variables',
        label: 'API requests',
        group: 'general',
        order: 66,
        layout: 'single',
        regions: { body: { kind: 'remote', entry: 'settings' } },
      },
    ],
    routes: [{
      id: 'http.request-route',
      path: '/p/:projectId/x/http/requests/:requestId',
      surface: 'http-project',
      item: 'requestId',
      order: 60,
    }],
    // What the rail lost, stated plainly: the compiled Source rendered the entire panel — tree, URL bar,
    // response — inside the rail. This lists the project's saved requests and nothing else, and
    // exploration moved into the frame beside it. That is the rollbar trade-off, taken deliberately: the
    // alternative is growing the descriptor vocabulary until it is a UI framework.
    sources: [{
      id: 'http-requests',
      label: 'API',
      glyph: 'send',
      // Rail position, declared. Was implied by this plugin's place in the compiled client list.
      order: 50,
      // No `providerId`: nothing backs this with a connected account. Saved requests are local, so the
      // source is always visible — like docker's.
      items: '/v2/p/http/rail-items',
      onSelect: { verb: 'navigate', surface: 'http-project' },
      emptyState: { message: 'No saved requests in this project yet. Open the API pane in a task to make one.' },
    }],
    agentContexts: [{
      id: 'saved-requests',
      label: 'Saved HTTP requests',
      description: 'Capture request shapes with authorization, header values, variables and bodies redacted.',
      options: '/v2/p/http/context-options',
      capture: '/v2/p/http/context-capture',
    }],
    commands: [{
      id: 'open',
      title: 'API: open request panel',
      category: 'pane',
      palette: false,
      action: { verb: 'openPane', pane: 'http' },
    }],
    // Was `defaultChord` on the compiled pane contribution. Same chord, declared where a loaded plugin
    // declares one.
    keybindings: [{ command: 'open', defaultChord: 'meta+shift+h', when: 'task' }],
  },
}
