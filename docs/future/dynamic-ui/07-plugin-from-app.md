# Phase 7: turn an app into a plugin

Status: proposed, 2026-10-01. Revised 2026-10-19 for OpenUI Lang and plans: a program isn't a plugin
package, so this phase rebuilds the app instead of copying it. Depends on
[phase 5](./05-project-apps.md).

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
