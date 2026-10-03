# Terminal sources and settings

This page covers how the terminal client draws a manifest rail source, a loaded document region, and
the Settings route. It's part of [the terminal client](../tui.md).

## A descriptor source's list

A compiled plugin's rail source is a component, which is kit and draws here. A manifest plugin's
source is a descriptor, and the host draws its list. On the desktop that's `ChromeSourcePanel`, built
from DOM.

`packages/client-core/src/host/chrome/sourcePanel.ts` is the seam, the same shape as
`KIT_COMPONENTS` and the layout table: each host package supplies its own, and the DOM's is the
fallback. It hands back a whole contribution, because the desktop draws one view across the window
while this host puts the list in Browse and the detail in the main area.

`apps/tui/src/plugins/SourcePanel.tsx` is this host's version. Everything that isn't drawing is
imported: `readRailItems` and `chromeKey` are the query, so both hosts share one cache entry,
`runChromeAction` is what a row press does, and `projectSurfaceRegistry` gives the detail, the same
view the desktop draws beside its list. Two things are left out on purpose: the create-task menu on a
row, and dashboard panels beside the list.

`/`, the `search` intent, so `Ctrl+F` works too, puts the keys in a title filter above the rows.
Typing narrows the list, `↓` goes back to the rows, and Escape leaves the panel. The field draws only
once there's a list, because entering a region lands on its first row, else its first stop, and a
field above an empty list would take the keys so `j` typed a `j`. `↓` stops at the last stop, so a
filter matching nothing leaves the caret alone. Escape doesn't stop. The filter is per source and
goes with it.

The source-panel factory is keyed by `(pluginId, descriptorId)`. A contribution resync updates a
signal holding the current descriptor and returns the same `regions.list` and `regions.detail`
functions. So `Dynamic` updates labels and props in place, instead of remounting the list and losing
its caret, virtual window, and query subscriptions.

## A loaded document region

Loaded pane registration is shared by both hosts. For a manifest `document` region it uses
`packages/client-core/src/host/frames/documentSurface.ts` to pick the host's editor, as a `remote`
region picks the tree renderer. The terminal supplies `apps/tui/src/plugins/DocumentSurface.tsx`: an
editable text field for a writable route and a text view for a read-only one. It bounds the declared
route, reads and saves through the Node API, and hands the sibling plugin tree a live `read`, `write`,
and `flush` handle. A pane shortcut pressed in the field flushes before it runs. The field is plain
text, with no highlighting or completions.

## Settings

**Open settings** in the `Ctrl+K` palette opens the Settings route. It lists the desktop's nine
groups, then a group's pages, then one page. Escape climbs one level at a time: an open detail, the
page, the group, then the route. The list is the registry the desktop reads. Core's pages come from
`packages/client-core/src/features/settings/corePages.ts`, which the desktop's
`apps/desktop/src/client/pageContributions.tsx` also uses, and the roster's plugins register theirs
through `ctx.settingsPages`. So the groups, order, labels, and scopes match the desktop.
`apps/tui/src/chrome/settingsPages.tsx` decides what this host draws:

- A plugin page written with the kit draws as is, through the terminal versions of `SettingsSection`
  and `SettingRow`. A row with `from` shows where its value comes from and no control. A `help` text
  prints as a gray line under the description, because there's no hover. The agents, Docker, and
  Workflows pages draw this way.
- Notifications has its own terminal form. Its **Terminal alerts** row shows the mode
  `ACORN_TUI_NOTIFY` chose, whether the variable or the default set it, and whether this terminal
  takes a notification sequence. The event switches and the test notification are the desktop's. The
  sound, system notification, and app icon switches are absent.
- Every other core page, and the terminal plugin's drawer page, shows **desktop app** beside it.
  Opening it says why this host doesn't draw it and where to go. A Node page's change on the desktop
  applies here, because the Node keeps it. A device page's change doesn't. For Appearance, Keyboard
  shortcuts, Rail and surfaces, and Device config file, the page names this client's own
  `acorn.json`. Overview also offers **Set up acorn**.

A page runs inside the desktop's unsaved-changes and detail seams, so a form with **Save** and
**Cancel** asks before Escape drops it, and a list page's detail adds its name to the breadcrumb.
`confirmAction` from `@acorn/plugin-api/ui/host` is a real dialog here
(`apps/tui/src/chrome/Confirmation.tsx`). It draws over whatever has the screen, keeps that view
mounted, and starts its caret on **Cancel**. A notice target of kind `settings` and
`presentation:open-settings` open the route on their page. A section in a deep link is ignored,
because this host can't scroll a page to one. The place in the route lasts for the session.
