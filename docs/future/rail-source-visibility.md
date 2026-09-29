# Optional plugin icons in the left rail

Status: product requirements proposal, 2026-09-29. No implementation has started.

## Summary

Let a plugin offer a browse source whose icon is hidden from the desktop left rail by default, while
letting the user show or hide that icon later. A plugin with a settings page can place the standard
visibility switch on that page. The same switch remains available under **Settings > Plugins** so a
user can recover a hidden source even when the plugin has no settings page. Hiding an icon does not
disable the plugin, remove its browse surface, or remove its other contributions.

The author declares a default and optional placement. The host owns the switch, its preference, and
the palette entry that opens a hidden source. Authors do not need to read shell preferences or add a
new bridge call. Existing plugins continue to show their icons by default.

## Problem and evidence

A plugin can omit a rail source and still contribute commands, panes, and settings. Once it declares a
source, however, the desktop rail shows its icon whenever the source passes the existing plugin,
integration, workspace, and `when` gates. A compiled client can make `when` read its own reactive
state, but a loaded plugin's source is a static manifest descriptor. Its settings frame can write
`plugin:<id>:*` state but cannot change host rail visibility. The current source-order preference
changes position only; it has no visibility value.

Data flows through `packages/protocol/src/plugin/manifest/chromeDescriptors.ts`, the Node's plugin
manifest reader, the active roster and client distribution, and
`packages/client-core/src/host/chrome/chromeRegister.ts` into the source registry. The desktop rail
filters registered sources in `packages/client-core/src/features/tabs/railSources.ts` and draws them
in `packages/client-core/src/features/tabs/TabRail.tsx`. `apps/desktop/src/client/App.tsx` separately
checks whether a selected source remains available. The terminal uses the same availability list in
`apps/tui/src/chrome/model.ts`, but presents sources in a text menu rather than an icon rail.

That last distinction matters: **visible in the left rail** is a presentation preference, not an
availability gate. A compiled command such as Docker's **Open Docker** selects its source directly.
Filtering a hidden source out of `availableSources()` would cause such a command to open a source that
the desktop then rejects as unavailable.

## Goals

- A loaded, compiled, or device-held client plugin can declare that one of its sources starts hidden
  from the desktop left rail. The omitted declaration keeps today's visible default.
- The user can change that choice without restarting the app or the Node, and the choice survives a
  desktop restart and a plugin update.
- A plugin author can place a host-rendered **Show in left rail** switch on one of the plugin's own
  settings pages without writing state synchronization or receiving shell preference access.
- The user can always find the switch in **Settings > Plugins**, even if the source starts hidden or
  the plugin has no custom settings page.
- A hidden but available source remains reachable through the desktop command palette. Commands,
  panes, routes, notices, and source-related capabilities keep their normal behavior.

## Scope

This proposal covers the desktop icon rail. The terminal's source menu stays as it is, and a desktop
visibility preference does not hide a terminal menu row. The terminal has no equivalent plugin
settings-page host today, so this proposal does not invent one. Plugin enablement, provider
connection, workspace mapping, and the rail's order and collapse settings retain their existing
meaning. Core sources, including Home, are not user-hideable through this plugin setting.

## User experience

1. On first use, the desktop shows the icon unless the source declares `showInRailByDefault: false`.
   The plugin remains installed, and its settings and other commands remain available.
2. **Settings > Plugins** shows a **Show in left rail** switch for each active plugin source. Use the
   source label when a plugin contributes more than one. If the source cannot appear because a
   provider or workspace gate is closed, keep the saved switch value and explain that the icon will
   appear when the source becomes available.
3. If the plugin asks to place the switch on one of its settings pages, the desktop draws the same
   host-owned control above that page's plugin content. Both locations read and write one preference.
   The control stays outside a loaded frame or remote tree.
4. Changing the switch updates the rail immediately. Turning it off while its source is selected
   returns the user to Home. Reopening that source from the palette displays its browse surface even
   though the icon remains hidden. Turning the switch on adds the icon without changing the current
   view.
5. The desktop palette offers **Open <source label>** for every hidden, available plugin source. The
   host creates this command; authors do not need to declare it. The command selects the source on
   the active Node and uses the same project navigation rule as clicking its rail icon. If the source
   needs a project and none is available, the palette keeps its error visible instead of closing on
   an apparent success. Existing plugin search and action commands remain separate.
6. A hidden source that becomes unavailable disappears from the palette until its normal gates pass
   again. Its visibility preference remains saved. Disabling or uninstalling the plugin removes its
   live controls and palette entry; reinstalling with the same plugin and source IDs restores the
   user's visibility choice.

## Plugin authoring contract

Add optional `showInRailByDefault?: boolean` to both `SourceContribution` and the loaded source
descriptor. Absence means `true`. This is a default, not a forced state: a user override takes
precedence. The source is registered in either case. A plugin that needs no browse surface continues
to omit `sources` entirely.

Add optional `railSourceVisibility?: string[]` to a general settings-page contribution and to a
loaded settings frame descriptor. Each ID must name a source owned by the same plugin; reject unknown
or foreign IDs at manifest validation or compiled registration, with a useful diagnostic. The host
renders one switch per named source, in declared source order. A plugin with several settings pages
chooses which page carries the control; it need not repeat it. Without this field, the switch lives
only under **Settings > Plugins**. A page with no source may not declare the field.

For example, a loaded plugin can declare the following fields alongside its existing source and
settings-region declarations:

```json
{
  "contributions": {
    "sources": [{
      "id": "board",
      "label": "Board",
      "glyph": "layout-dashboard",
      "order": 50,
      "items": "/v1/p/board/items",
      "showInRailByDefault": false
    }],
    "frames": [{
      "target": "settings",
      "id": "board-settings",
      "label": "Board",
      "railSourceVisibility": ["board"],
      "layout": "single",
      "regions": { "body": { "kind": "remote", "entry": "settings" } }
    }]
  }
}
```

The example illustrates the added fields, not a complete installable manifest. The authoring guide
and scaffold should show the small hidden-by-default variant without requiring a settings page. A
plugin settings page that wants the switch adds one `railSourceVisibility` entry; its own code does
not call the preference API. Document that source IDs are stable user-preference keys.

## State and boundary rules

Store an explicit `true` or `false` override per `(pluginId, sourceId)` in a host-owned device
preference. An absent override reads the source declaration's default. Keep this separate from
`rail_order`: dragging icons and toggling visibility must not overwrite each other's writes. The
preference is device-wide across Nodes that offer the same plugin and source ID, matching the
desktop's existing rail-order scope. Retain entries for temporarily absent sources as inert data.
Bound and validate the map when reading it, and give `acorn.json` a matching declarative projection
if device rail preferences continue to be mirrored there.

The Node and plugin runtimes do not receive this preference. A loaded settings frame cannot write it
through `state.set`, a Node route, or its own manifest. The host renders and handles the switch based
on the active, accepted plugin declaration and checks source ownership again on the client. A plugin
cannot place a switch for a core source or another plugin's source.

Keep the existing source registry and `availableSources()` as the answer to **can this source open?**
Apply the user's visibility choice only when projecting the desktop's icon list. The desktop's
selected-source validity check must continue to use availability, so a palette-opened hidden source
stays open. The toggle-off action performs the one explicit fallback to Home. The generated palette
command uses the same availability checks as a rail click and disappears on plugin unload, trust
loss, Node switch, or provider/workspace gate failure.

## Acceptance criteria

- A plugin source with no added fields behaves exactly as before, including its rail position and
  command behavior.
- A loaded source with `showInRailByDefault: false` has no desktop icon on first use, has a palette
  opener when available, and appears immediately when switched on. A compiled and a device-held
  source follow the same rule.
- The same saved value appears under **Settings > Plugins** and on the plugin settings page that
  declares `railSourceVisibility`. Changing either updates both and the rail without a restart.
- A hidden source can be opened from the palette, including a project-scoped source. Hiding the
  currently selected source returns to Home. Reordering sources does not change visibility.
- Availability gates still hide disconnected, disabled, unaccepted, and irrelevant sources. Hiding an
  icon changes none of the plugin's commands, routes, panes, notifications, or source data.
- A foreign or missing `railSourceVisibility` ID receives a clear author-facing error. A plugin
  update, Node switch, disable and re-enable, and uninstall and reinstall do not leak controls from
  a previous active declaration.
- A terminal session continues to list the source in its text menu regardless of the desktop rail
  preference.

## Delivery and verification

Implement the contract and validation in protocol and plugin registration, the device preference
and settings controls in client-core, and the desktop rail projection and palette opener in the
desktop/shared host layer. Keep the palette command host-owned and scoped to its source; do not add a
general plugin navigation bridge verb. Review existing compiled **Open <source>** commands for
duplicate palette rows when their source is hidden, and consolidate only the duplicates while
retaining specialist search commands.

Tests should cover default and override precedence, a settings-page and **Settings > Plugins**
round trip, ownership rejection, selected-source fallback, palette opening of hidden and
project-scoped sources, plugin unload and Node switching, and the unchanged terminal menu. Update
the owning plugin authoring, descriptor, frontend, state-ownership, palette, and testing docs when
behavior ships. Run `pnpm lint` and the relevant protocol, client-core, desktop, and terminal tests.
Test the desktop switch, rail, and palette in a real Tauri window with the isolated agent driver.

## Verify before building

- Recheck the source and settings contribution schemas, active-roster adaptation, and plugin API
  compatibility rules. Paths here identify owners, not frozen APIs.
- Confirm the settings host can render a control outside both a remote tree and a frame, and that
  **Settings > Plugins** can identify active client-only and Node-delivered sources.
- Confirm the desktop and terminal palette hosts' command registration and disposal behavior before
  adding a generated command. Check for duplicate first-party source-opening commands.
- Verify where the desktop stores device preferences and how `acorn.json` handles preference writes,
  malformed entries, and retained unknown source IDs.
