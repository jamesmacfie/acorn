# Phase 7: turn an app into a plugin

Status: built, 2026-10-20, except the picture in requirement 3. Depends on
[phase 5](./05-project-apps.md). The shipped behavior is in
[project apps](../../agent-built-apps/project-apps.md#turn-into-a-plugin), which wins where this page
disagrees.

## Completion note, October 20, 2026

**What landed.** All in `plugins/trellis`, plus two small changes to the scaffold package.

- **The button.** **Turn into a plugin** sits in a project app's toolbar in the Apps source
  (`TurnIntoPlugin.tsx`). Its dialog asks for a plugin ID, a display name, and a folder. **Choose…**
  picks a parent folder on the local Node and fills in `<parent>/<plugin ID>`, as
  `npm create acorn-plugin` makes a folder of its own.
- **The package.** `POST /apps/:appId/plugin`, device only, calls `writePluginPackage`
  (`server/pluginPackage.ts`). It refuses any folder that holds anything, with 409. It writes
  `scaffoldFiles(id, name)` from `create-acorn-plugin`, adds `requires` to the manifest, and writes the
  app's saved state as `app-state.seed.json`. Every file is written with the `wx` flag. The body's ID,
  name, and `requires` are checked with `pluginManifestShape`'s own fields.
- **Requirements.** `pluginRequirements` (`client/pluginExport.ts`) reads the plugin ID of every
  inline query in the head's plans, keeps the ones the Node's plugin list knows, and gives each the
  major of its installed version. A compiled plugin gets no range, because it has no version and the
  loader ignores one. Core's sources need nothing.
- **The task and session.** `turnIntoPlugin` writes the package, adds the folder as a project in the
  app's workspace (or alone, when workspaces are off), creates a project-folder task there, and starts a
  session with the brief in `pendingForkContext`, as **Edit in a new task** does. The brief carries the
  head program, the plans, every revision note, the `requires` list, and the instructions:
  `plugin_authoring` first, a tree pane over the same sources, a dashboard region for `Panel` plans,
  never read the seed file on its own, and `plugin_request` with `dev: true`. The window opens the task
  on its Agent pane.
- **The scaffold.** `index.d.mts` declares its exports, and is published with it, so a TypeScript
  caller can import it. Its run-as-a-command check now tests that `process.argv[1]` exists before
  `realpathSync`, so importing it from a Node whose start path isn't a file can't throw.
  `tools/arch/boundaries.test.ts` lets plugins import `create-acorn-plugin`, which depends on nothing.

**Decisions and deviations.**

- **No picture of the app.** Nothing in the host captures pixels, and a page-to-canvas copy doesn't
  work in the macOS webview, which blocks reading a canvas drawn from HTML. A native capture command is
  a desktop feature of its own. The dialog asks the owner to paste a screenshot with the first message
  instead. The brief has the program, which is the app's layout.
- **The seed file is inside the folder.** "Beside the package" could mean a sibling of the folder, but
  writing outside the folder the owner chose would surprise them. The plugin never reads it, and the
  brief says so.
- **The folder becomes a project.** A task runs in its project's folder or a worktree of it, so the
  only way to have the session work inside the package is a project for the folder. That adds a
  project to the workspace. The owner can remove it, and the folder stays.
- **`requires` is computed in the client.** The Node half of a plugin can't read the plugin list, and
  the client already reads it. The route takes the list and checks its shape.
- **The brief is a draft attachment, not a sent turn,** for phase 4's reason: the owner sends it.
- **Saved queries add no requirement.** A plan's saved query names its source only in the query
  library. Agents write inline queries, as the plan guide asks. The code marks it as a shortcut.
- Sizes: the Node service graph is 1,896,774 bytes, 35 more than phase 6. The scaffold loads with the
  app routes, which are lazy. The dialog loads with the Apps source's detail, which is lazy too.

**Verify-before-building answers.**

- A task can run with the destination as its working folder only if the folder is a project. A task
  with no branch runs in its project's folder, so the host adds the folder as a project.
- The host reports an unmet requirement at load: a missing plugin reads "requires the plugin '\<id\>',
  which is not installed on this node", and a wrong major names both versions. The loader doesn't
  check disabled plugins (`resolveRequires` in `packages/node-core/src/server/plugins/loader.ts`), so
  turning a source plugin off leaves a dependent loading, for every plugin alike.
- The scaffold's checks can't run against an arbitrary folder. `index.test.ts` checks the output of
  `scaffoldFiles` and the packed package, not a folder. The same checks for any folder are the
  install itself: the manifest parser, the loader, `init`, and the trust prompt.

**Checks run.** Unit tests: `routes.test.ts` (the package, its manifest parsed with
`pluginManifestShape`, the seed, a busy folder left alone, a bad ID, a relative path, a task app),
`pluginExport.test.tsx` (the requirements), the rest of `plugins/trellis` (49), `apps/tui`'s
`trellis.test.tsx`, `create-acorn-plugin` (24), and the architecture rules (95). The full `pnpm lint`
and `pnpm test` passed. Live, in a `pnpm dev:agent` window with a managed Claude Code session (Opus 5.5, Auto mode). No
account-free source belongs to a loaded plugin there, and the `acme-data` example fails its `init` in
that window, so two throwaway plugins outside the repository, `scratch-deploys` 3.2.0 and
`scratch-incidents` 2.0.1, each served a static source from the bundled-plugins folder. A project app,
Release watch, listed deploys with ticks and drew the incidents plan as a `Panel`.

- Checkpoint 1: passed. Before the first turn, the manifest listed `scratch-deploys` at `3` and
  `scratch-incidents` at `2`, the seed held the tick, and the task opened on the folder's project with
  "Release watch · plugin brief" attached.
- Checkpoint 2: passed, with one substitute. The session took one turn and $2.30. It kept
  `requires`, and rebuilt the deploys list as a tree pane with ticks. A loaded plugin can't read another
  plugin's source directly, so it added a derived source with the deploys as its input and vendored the
  SDK's data helper. It reserved a dashboard region for incidents panels. The session's own `acorn`
  tool server failed to start in the test window, so `plugin_request` wasn't available and the folder
  went in through **Install from folder**. The trust prompt listed the read, the data source, and the
  region. After the read was approved, the pane showed the same three deploys, with no ticks, because
  the plugin doesn't read the seed.
- Checkpoint 3: passed, with a finding. Turning `scratch-incidents` off and restarting left the new
  plugin running, as it would any plugin. With `scratch-incidents` removed, the new plugin's row read
  "requires the plugin 'scratch-incidents', which is not installed on this node". The app stayed at v1
  with its tick.

The terminal client wasn't run live, for phase 3's reason. The dialog uses only shared kit
components, and **Choose…** hides there because the terminal has no folder picker.

**For later phases.**

- `plugin_authoring` doesn't say how a plugin's Node half reads another plugin's data source. The agent
  worked out the derived-source route from the SDK on its own. One paragraph there would save the next
  session that time.
- A disabled dependency doesn't stop a dependent loading. If owners expect it to, that's a loader
  change for every plugin, not for this one.
- `pnpm --filter @acorn/site stale` lists three pages that cite the scaffold's `index.mjs`. The change
  there is the import check only, so they weren't edited.

## Goal

An app that has grown into a product leaves the language's limits behind and becomes an ordinary
loaded plugin, with its dependencies declared, so it can gain a node half, settings, routes, or
anything else a plugin can have. An agent rebuilds the UI as a tree pane, with the app as its brief.

## What the owner gets at the end

- **Turn into a plugin** on a project app, which writes a plugin package folder and starts an agent
  session that rebuilds the app's UI in it.
- A package that installs through the normal flow and trust prompt, and does the job the app did.
- `requires.plugins` filled in from the data sources the app's plans read.

## Starting point

- Phase 5's project apps, each with dependencies the host reads from its plans.
- Plugin regions, where a plugin's own surface holds dashboard panels
  ([placements](../../dashboards/placements.md#plugin-regions)).
- The scaffold, `plugin_authoring`, and dev mode, which an agent already uses to write a plugin
  ([start from the scaffold](../../plugin-authoring/start-from-the-scaffold.md),
  [activation](../../plugins/activation.md)).
- Installing from a folder and the manifest's `requires` key
  ([installing a hand-written package](../../plugin-authoring/installing-a-hand-written-package.md),
  [the manifest](../../plugin-authoring/the-manifest.md)).

## Requirements

1. **Turn into a plugin** asks for a plugin ID, a display name, and a destination folder.
2. The host writes the scaffold's package into the folder, with a manifest that declares one pane and
   `requires.plugins` listing each data source's plugin with its running major version as the range.
3. The host starts an agent session in a task whose working folder is the destination, with the brief
   attached: the app's head program, its plans, its revision notes, and a picture of the app.
4. The agent rebuilds the UI as a tree pane over the same data sources, using `plugin_authoring` and
   dev mode. Where the app drew a plan with `Panel`, the plugin can reserve a dashboard region and the
   owner can publish the plan as a panel there.
5. The app's state is written beside the package as a seed file the owner can load or discard. The
   plugin does not read it automatically.
6. The package installs through **Install from folder** and shows the ordinary trust prompt.
7. The app stays until the owner deletes it. Turning it into a plugin changes nothing about it.
8. The package passes the plugin package checks the scaffold's tests run.

## Out of scope

- Publishing the plugin anywhere. This phase writes a folder.
- Converting app state into a plugin database.
- Keeping the app and the plugin in sync afterwards.
- Copying the program into the plugin with a runner. See
  [refused](./refused.md#exporting-a-program-with-a-runner).

## Steps and checkpoints

**Checkpoint 1.** Turn an app that reads two data sources from two plugins into a plugin. The
manifest's `requires.plugins` lists both, with major ranges, before the agent writes anything.

**Checkpoint 2.** Let the session finish, then install the folder. The trust prompt lists what the
manifest declares. The plugin's pane does the job the app did, over the same data.

**Checkpoint 3.** Disable one of the two source plugins. The plugin reports the missing dependency the
way any plugin with an unmet `requires` does.

## Docs that change

- [Plugin authoring](../../plugin-authoring.md): turning an app into a plugin as a starting point.
- [Testing](../../testing.md): the manual checks above.

## Verify before building

- Whether a task can run with the destination folder as its working folder, so the session writes
  inside its own folder.
- How the host reports an unmet `requires.plugins` entry, so the rebuilt package behaves the same.
- Whether the scaffold's package checks can run against an arbitrary folder.
