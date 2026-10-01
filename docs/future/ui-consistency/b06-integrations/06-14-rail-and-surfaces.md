# 06-14. Rail and surfaces repeats its section's sentence on every row

**Status:** not started. Batch B06. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The **Left rail** section says a hidden source still opens from the palette. Then each of its rows
says the same thing again, or explains when its icon appears. Every row is two or three lines, and the
page's one decision per row, a switch, sits among 16 lines of the same words. The same "show this in
the rail" switch also appears on a plugin's Overview tab with a visible label, where every other row
switch has none. Replaced surfaces repeat the plugin id and a warning, and show a failed surface as an
11-pixel lower-case line with a dash.

## Where to see it

Settings › Rail and surfaces. Replaced surfaces with an offer, and a failed surface, need a plugin
that offers one; read those from code.

## Already done

- K5 changed the row descriptions to plugin names ("From the Linear plugin.") and gave the
  replaced-surface options plugin names. The option format itself is left for this batch.

## The fix

- `packages/client-core/src/features/settings/plugins/RailSurfacesSettings.tsx:50-55`: a row's
  description says only its exception, and is empty otherwise. Say "Shows once you connect
  {provider}" only when a missing connection is the reason. `railSources.ts` (around `:41`) has
  `providerId`. A source can also be hidden by `requires`, `when`, or a workspace that follows no
  project, so do not claim a connection is the reason in those cases.
- `PluginPage.tsx:186-193`: the rail switch uses `ariaLabel`, not a visible label.
- `RailSurfacesSettings.tsx:115`: the option reads "{label}, from {plugin label}".
- `:121-124`: the warning becomes the row's description.
- `:128`: the fallback becomes the row's `error`, and the `.plugin-failed` rule (`plugins.css`,
  around `:47`) goes.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `RailSurfacesSettings.tsx:62` | Which plugin sources have an icon in the left rail. A hidden source still works: its commands, panes and notifications stay, and the palette opens it. | Rewrite, keep inline | Choose which icons show in the left rail. A hidden one still works from the command palette. |
| `RailSurfacesSettings.tsx:50-55` | From the {plugin} plugin. / Hidden until you show it. / The command palette opens it either way. / Its icon appears once the source is available, such as when its connection is signed in. | Rewrite | Only the exception: "Hidden until you show it." or "Shows once you connect {provider}." Otherwise no description. |
| `RailSurfacesSettings.tsx:64` | No plugin adds a source to the left rail. | Rewrite | No plugins add icons to the left rail. |
| `RailSurfacesSettings.tsx:98` | Some plugins offer to draw one of acorn's own surfaces. Nothing is replaced until you pick it here, and acorn draws its own again if that plugin is turned off or its surface fails. | Move to `help` on **Replaced surfaces**, rewrite | Some plugins can draw one of acorn's own areas, such as the top bar. Nothing changes until you pick one here. If the plugin stops working, acorn goes back to its own. |
| `RailSurfacesSettings.tsx:100` | No plugin offers to draw one of acorn's surfaces. | Rewrite | No plugins can replace any of acorn's areas. |
| `RailSurfacesSettings.tsx:112` | acorn's own | Keep | |
| `RailSurfacesSettings.tsx:115` | {label} ({plugin}) — hides the task list | Rewrite | {label}, from {plugin label}. The warning moves to the row's description. |
| `RailSurfacesSettings.tsx:121-122` | {label} hides the task list. / … hides plugin status items. | Rewrite, keep inline | As the row's description: "{label} hides the task list." |
| `RailSurfacesSettings.tsx:128` | that surface failed — acorn's own is showing | Rewrite | As the row's `error`: "That plugin's version failed, so acorn's own is showing." |
| `PluginPage.tsx:184` | Hidden by default. The command palette can still open it. / The command palette opens it whether or not its icon shows. | Rewrite first, remove second | Hidden until you show it. / (nothing) |
| `corePages.ts:177` | exclusive slot (search keyword) | Keep | Search only, never shown. |

## Risk and checks

- Before you start, read `railSources.ts` to list every reason a source can be hidden.
- Screens: Rail and surfaces, and a plugin page's Overview.
- Tests: client-core.
