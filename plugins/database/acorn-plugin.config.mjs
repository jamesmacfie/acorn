// The loadable-package declaration for this plugin: what `apps/node/scripts/build-plugin.mjs` reads to
// build the bundles and generate `acorn-plugin.json`. It lives here, not in the build script, so the
// plugin's declared surface is visible from the plugin's own directory.
//
// THE FIRST CONSUMER OF `document-over-frame` (docs/future/monaco.md § Sequence, step 5), and that is
// why this plugin moved rather than because the migration bought it anything on the storage path. It was
// stuck first-party for one measured reason: the pane embedded Monaco, a single-file Monaco frame comes
// to 7.93 MiB against an 8.00 MiB cap with a stub UI, and its four language-service workers (14.58 MiB)
// cannot be served AT ALL — a plugin origin serves one file and the frame CSP has no `worker-src`. The
// answer was not to widen the sandbox for every installed plugin to serve two first-party panes; it was
// for the host to own one editor and lend it. So the `layout` block below is the whole editor: the host
// draws it, and this plugin's contribution to it is two routes and a language id.
//
// `id: "database"` (the directory name, which the builder uses as the id) is load-bearing and must never
// change. It binds `/v2/p/database`, the `database` pane's persisted layout key, and — the one that
// loses data rather than just breaking a link — `<dataRoot>/plugins/database.sqlite`. Renaming it
// orphans every saved query on the machine.
//
// On the permissions, and where they differ from what the migration brief sketched:
//
//   exec: true — and this is the line to look at twice. `main/database.ts` really does run
//     `execFile('bash', ['-lc', script])`, in TWO places: the repo's `[database].url_script` to resolve a
//     connection URL, and the repo's schema script for AI generation. So "Run commands on the node" is
//     exactly what this plugin does, and the declaration is honest disclosure rather than an
//     over-declaration. Contrast rollbar/linear's `secrets: false`, the opposite case, where the plugin
//     genuinely never touches the host service.
//   core: ['tasks', 'projects:read', 'projects:config', 'fs'] — `tasks.load` to validate a task and
//     resolve its project, `tasks.root` for the worktree the script runs in, `projects.byId` for the
//     checkout path, `projects.config` for the connection script, the schema mode/value and the schema
//     notes, and `projects.assertConfigTrusted` before running any of it — cloning a repo must not be
//     enough to run its commands. `fs.resolveInRoot` confines the `file`-mode schema path to the
//     worktree. The brief listed `prefs`; nothing reads or writes one, so it is not here.
//   secrets: false — the brief sketched `true`. It is wrong, and the reason is the nicest property this
//     plugin has: the connection URL is resolved per connect and NEVER PERSISTED, so there is no
//     credential at rest for the host secret service to hold. Postgres credentials live in the reader's
//     own `.env` or come out of their own script.
//   net: [] — the plugin opens a TCP connection to whatever Postgres the reader pointed it at, which is
//     not an HTTP destination and not something a host allowlist can describe. Listing nothing says
//     "this plugin has no destination of its own", which is true.
//   api: ['core.tasks:read'] — one scope, and it is nearly nothing: the host hands the frame its
//     `taskId` in `context`, and everything the panel does goes through this plugin's own routes. The
//     scope is there for the task label the panel header shows. `core.projects:read` is NOT declared —
//     the project is resolved node-side on every route that needs it.
export default {
  name: 'Database',
  entry: '@acorn/plugin-database/node/index.ts',
  factory: 'databasePlugin',
  client: {
    entry: './src/frame/index.tsx',
    framework: 'solid',
  },
  // Staged into the built package by the builder, and opened by the host from there. The chain in
  // `plugins/database/migrations` stays the source of truth and drizzle-kit keeps generating into it.
  migrations: './migrations',
  permissions: {
    api: ['core.tasks:read'],
    events: [],
    node: { core: ['tasks', 'projects:read', 'projects:config', 'fs'], capabilities: [], secrets: false, exec: true, net: [] },
  },
  contributions: {
    frames: [{
      target: 'pane',
      // Keeps its id because it is a persisted layout key — a task that has the Database pane open has
      // that string in its stored layout, and renaming it would silently close the pane for everyone.
      id: 'database',
      label: 'Database',
      glyph: 'database',
      // Its shipped position in the switcher, declared where a loaded plugin declares one. It was
      // implied by this plugin's place in the compiled pane list; a move is not a reason to renumber
      // panes under everyone who has this one open.
      order: 70,
      // The composed pane. The host draws the SQL editor and the drag handle; this plugin's frame draws
      // the button bar, the table sidebar, the result grid and its two modals below.
      //
      // What the client DELETED in the move, which is the argument for the whole contract in one list:
      // `monaco.editor.create` and all its options, the theme application and its appearance
      // subscription, the `addCommand(⌘Enter)` binding, the `editorH` signal and the splitter's pointer
      // handlers — and the `monaco-editor` dependency itself.
      layout: {
        template: 'document-over-frame',
        document: {
          languageId: 'sql',
          read: '/v2/p/database/tasks/:taskId/scratch',
          write: '/v2/p/database/tasks/:taskId/scratch',
          // Table and column completions, answered by this plugin's node half where the schema
          // introspection already lives. `.` is what re-opens the popup after an alias.
          completions: {
            route: '/v2/p/database/tasks/:taskId/completions',
            triggerCharacters: ['.'],
          },
        },
      },
    }],
    agentContexts: [{
      id: 'saved-queries',
      label: 'Saved database queries',
      description: 'Capture saved SQL and the notes beside it. No connection URL or credential is stored to leak.',
      options: '/v2/p/database/context-options',
      capture: '/v2/p/database/context-capture',
    }],
    commands: [
      {
        id: 'open',
        title: 'Database: open pane',
        category: 'pane',
        palette: false,
        action: { verb: 'openPane', pane: 'database' },
      },
      {
        id: 'execute',
        title: 'Database: run query',
        category: 'action',
        // Reachable from the palette as well as from the chord, which is what naming the surface on the
        // action rather than deriving it from the keybinding buys.
        palette: true,
        action: { verb: 'surfaceAction', surface: 'database' },
      },
    ],
    keybindings: [
      // Was `defaultChord` on the compiled pane contribution. Same chord, declared where a loaded
      // plugin declares one.
      { command: 'open', defaultChord: 'meta+shift+j', when: 'task' },
      // ⌘Enter, and the acceptance test for the whole document-surface design: the chord is pressed with
      // focus in the HOST's editor, where this plugin's frame has no keyboard at all. The host resolves
      // it against this binding, flushes the document to the write route above, and posts `execute`
      // across the bridge — so the frame runs the query it can then read back, never the previous one.
      { command: 'execute', defaultChord: 'meta+enter', when: 'surface', surface: 'database' },
    ],
  },
}
