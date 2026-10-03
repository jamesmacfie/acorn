# Forward compatibility

This page covers what happens when a plugin declares something this build of acorn doesn't know. It's
part of the [plugin reference](../plugins.md).

## Forward compatibility

The rule is that unknown input is kept or skipped and reported, never dropped silently:

- A schedule state row whose declaration is gone is kept and shown. Disabling a plugin doesn't delete
  the owner's pause or its run history.
- `apiVersion` is a range, so a manifest written for the next acorn can name this one
  ([the compatibility promise](./publishing.md#the-compatibility-promise)).
- An unknown `permissions.node.core` facet is skipped, and an unknown manifest key is stripped by the
  schema. Rejecting either would make a manifest from a later build fail to load.
- An unknown settings `category`, `settingsScope`, or `railSourceVisibility` source leaves the page in
  its default place and is reported.

`parsePluginManifest` returns an `unknown` list beside the manifest: unknown top-level keys, unknown
contribution kinds, and unknown core facets. It compares the raw JSON with what came out of the
schema, so there's no key list to keep in step. The list rides the roster row to the device, which
raises one attention row per entry. The wording says this version of acorn doesn't recognize the
entry, so it was ignored, and that the plugin didn't fail.

Some old input is known and rejected with a named reason instead: the removed `contributions.palette`
and `contributions.collections` keys, and a command without `kind`.

These rows, and every other row a loaded plugin raises through `contributions.attention`, land on the
plugin's own rail source when it has one and on **Settings > Plugins > Installed** when it doesn't.
The manifest names no target, and the wire carries display strings only
([rows and targets](../notifications/rows-and-targets.md#what-a-row-points-at)).

A kit node a tree names that this host doesn't know draws a labeled placeholder and records a row on
the plugin's page. A settings page that uses `SettingsSection` or `SettingRow` should raise the floor
of its `apiVersion` range to a release that has them.
