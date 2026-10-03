# Replacing a core surface

This page covers how a plugin offers to draw one of acorn's own surfaces, such as the rail's task
list, and how the person and the host decide who draws it. It's part of the
[plugin reference](../plugins.md).

## Replacing a core surface

A plugin may offer a replacement for one of acorn's designated surfaces:

```json
{ "client": "./dist/client.js", "contributions": { "frames": [
  { "target": "coreSlot", "id": "board-rail", "label": "Board task list", "coreSlot": "rail.taskList" }
] } }
```

Registering takes nothing. Three plugins may offer to replace the rail's task list, and the rail keeps
drawing its own. The person picks a provider in **Settings > Plugins > Rail and surfaces > Replaced
surfaces**, and the choice is a device preference, because which list a person looks at belongs to
the screen they're using. The picker is hidden when nobody has offered a replacement.

The designated surfaces are `rail.taskList`, `pane.switcher`, `rail`, and `topbar`, and core is the
registered provider for each. `pane.switcher`, `rail`, and `topbar` require a `single` layout with one
remote-tree region, because these surfaces get changing host data and verbs an iframe can't take. The
tree receives data only. It invokes named host actions to change panes, choose a source, switch a
workspace or Node, or navigate. A device plugin can offer these surfaces without a Node half.

## Nested slots

The rail receives sources after the host's capability, integration, workspace-link, and contribution
gates. Its `slots.taskList` value is an opaque, host-minted reference. A tree places it with a `Slot`
node whose `slotRef` prop is that value. The topbar receives `slots.right` for plugin status items in
the same way. Neither nested occupant receives another reference.

A chrome surface declares `placesSlots: ["rail.taskList"]` or `placesSlots: ["topbar.right"]` when it
places the nested slot. Settings warns when the declaration leaves it out, because choosing that
provider would hide task navigation or status items. The host checks the reference when the tree
renders, and a declaration alone creates no slot.

## Core is the fallback

Core draws again at once when nobody is chosen, the chosen plugin is absent or disabled, its bundle
isn't trusted, or its component or worker fails. A provider that fails three times in a session is
skipped until the contribution set is synchronized again. The notice names the plugin, and the
settings row shows when the chosen provider is unavailable.

A `coreSlot` surface isn't a pane, so no pane verb can name it. It needs a designated slot name and a
client bundle.
