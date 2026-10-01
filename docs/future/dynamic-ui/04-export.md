# Phase 4: export an app as a plugin

Status: proposed, 2026-10-01. Depends on [phase 3](./03-project-apps.md).

## Goal

An app that has grown into a product leaves the app namespace and becomes an ordinary loaded plugin,
with its dependencies declared, so it can gain a node half, settings, routes, or anything else a plugin
can have.

## What the owner gets at the end

- **Export as plugin** on a project app, which writes a plugin package folder.
- A package that installs through the normal flow and trust prompt, and runs the same UI.
- `requires.plugins` filled in from the app's declared data sources.

## Starting point

- Phase 3's project apps, each with a manifest that declares its data sources.
- Installing from a folder and the manifest's `requires` key
  ([installing a hand-written package](../../plugin-authoring/installing-a-hand-written-package.md),
  [the manifest](../../plugin-authoring/the-manifest.md)).

## Requirements

1. **Export as plugin** asks for a plugin ID outside the reserved app prefix, a display name, and a
   destination folder.
2. The package holds the head revision's client tree and a manifest that declares a pane with that
   tree, the same data sources, and `requires.plugins` listing each source's plugin with its running
   major version as the range.
3. The app's state is written beside the package as a seed file the owner can load or discard. The
   plugin does not read it automatically.
4. The package installs through **Install from folder**, shows the ordinary trust prompt, and needs no
   app trust.
5. The app stays until the owner deletes it. Export changes nothing about it.
6. The exported package passes the plugin package checks the scaffold's tests run.

## Out of scope

- Publishing the plugin anywhere. Export writes a folder.
- Converting app state into a plugin database.
- Keeping the app and the plugin in sync after export.

## Steps and checkpoints

**Checkpoint 1.** Export an app that reads two data sources from two plugins. The manifest's
`requires.plugins` lists both, with major ranges.

**Checkpoint 2.** Install the folder. The trust prompt lists what the manifest declares. The plugin's
pane runs the same UI as the app.

**Checkpoint 3.** Disable one of the two source plugins. The exported plugin reports the missing
dependency the way any plugin with an unmet `requires` does.

## Docs that change

- [Plugin authoring](../../plugin-authoring.md): exporting an app as a starting point for a plugin.
- [Testing](../../testing.md): the manual checks above.

## Verify before building

- How the host reports an unmet `requires.plugins` entry, so the exported package behaves the same.
- Whether the scaffold's package checks can run against an arbitrary folder.
