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
      // `list-detail`: the host draws the split, the divider and the drag handle, and the two regions
      // are two entries in one bundle. They share the selection, the draft and the send result through
      // module scope in that bundle (src/tree/panelModel.ts), which is what a loaded plugin has instead
      // of the host's `model` seam (docs/panes.md § Layout model).
      {
        target: 'pane',
        id: 'http',
        label: 'API',
        glyph: 'send',
        order: 76,
        layout: 'list-detail',
        regions: {
          list: { kind: 'remote', entry: 'list' },
          detail: { kind: 'remote', entry: 'detail' },
        },
      },
      {
        target: 'pane',
        id: 'http-project',
        label: 'API requests',
        glyph: 'send',
        scope: 'project',
        layout: 'list-detail',
        regions: {
          list: { kind: 'remote', entry: 'list' },
          detail: { kind: 'remote', entry: 'detail' },
        },
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
    commands: [
      {
        id: 'open',
        title: 'API: open request panel',
        category: 'pane',
        // Not in the group below, and not renamed: it is invisible in the palette, so the only place
        // this title is read is the shortcut editor, where it stands on its own next to a chord.
        palette: false,
        action: { verb: 'openPane', pane: 'http' },
      },
      {
        // The group the three visible rows hang under, so the palette root holds one "API" rather than
        // three. The root search still finds a child by its own words: a node is indexed under its
        // breadcrumb as well as its title (client-core/host/registries/commands/graph.ts).
        //
        // `api` rather than `http`, which is the pane's id: contribution ids are unique across the whole
        // manifest, so a group cannot be named after the surface it is about.
        id: 'api',
        title: 'API',
        kind: 'group',
        category: 'action',
      },
      {
        // This project's saved requests, searched from the palette
        // (docs/future/command-palette/command-catalog.md § HTTP).
        //
        // `scope: 'project'` is the whole boundary: the host sends the project the palette session
        // captured, the route filters on owner and project in SQL, and the command is not offered at
        // all where there is no routed project.
        //
        // `navigate`, matching the rail source above: a saved request's detail belongs to the project,
        // so picking a row changes the URL and `http-project` draws beside the list. What comes back is
        // a name, a folder and a method — the route never reads the encrypted columns, so there is no
        // secret in a row to redact (src/server/paletteSearch.ts).
        id: 'find-request',
        title: 'Find a saved request',
        parentId: 'api',
        hint: 'saved requests in this repository',
        keywords: ['http', 'api', 'request', 'endpoint'],
        category: 'navigation',
        kind: 'search',
        scope: 'project',
        route: '/v2/p/http/palette/requests',
        placeholder: 'Find a saved request…',
        onSelect: { verb: 'navigate', surface: 'http-project' },
      },
      {
        // Start a request from the palette. `surfaceAction`, not a node route, because a new request is
        // a draft in the pane and not a row on the node — the pane's own "+ Request" button does the
        // same thing, and this is that button reachable by name (src/tree/panelModel.ts).
        id: 'new-request',
        title: 'New request',
        parentId: 'api',
        keywords: ['http', 'api', 'request', 'new'],
        category: 'action',
        palette: true,
        action: { verb: 'surfaceAction', surface: 'http' },
      },
      {
        // Paste a curl command, get a saved request (docs/future/command-palette/command-catalog.md
        // § HTTP). Nothing is sent: the parser reads flags out of a token list and never runs a shell,
        // and sending stays an act the reader takes in the pane with the request in front of them.
        //
        // Task-scoped although saved requests are project-owned, because an input's success verb is the
        // context-free set and `openPane` is its only way to show the reader what was created — so the
        // import lands where a new request in a task lands anyway, on the task, until it is filed.
        id: 'import-curl',
        title: 'Import a curl command',
        parentId: 'api',
        hint: 'paste a curl command line and save it as a request',
        keywords: ['curl', 'import', 'paste', 'http'],
        category: 'action',
        kind: 'input',
        scope: 'task',
        route: '/v2/p/http/palette/import-curl',
        placeholder: 'curl -X POST https://…',
        onSuccess: { verb: 'openPane', pane: 'http' },
      },
    ],
    // Was `defaultChord` on the compiled pane contribution. Same chord, declared where a loaded plugin
    // declares one.
    keybindings: [{ command: 'open', defaultChord: 'meta+shift+h', when: 'task' }],
  },
}
