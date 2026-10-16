# Phase 9: plugin panels drawn with more care

Date: October 16, 2026. Status: done on October 17, 2026. Depends on [phase 1](./01-navigation.md).

## Completion note

Landed on October 17, 2026. `PluginPanel.tsx` draws every block with the kit's parts. The first
`status` block is a header: the label in the kit's `Heading`, the state as a `Badge` toned by
severity, and the detail's lines as `Text`, the first bold, a second holding "→" in monospace, the
rest muted. **Refresh** and **Open in Acorn** are `IconButton`s at its right. Each block is the kit's
`Section` with its title and count. Rows and later `status` blocks are kit `Row`s with an icon from
the `SEVERITY` table. Links are stacked rows with the address shown without its scheme, a **Copy**
icon button, and, for a web address that answers, the whole row as a link with a faint arrow. The log
source is a ghost `Picker`, and the lines are the kit's `Log`. A `danger` header marks the panel's
tab. [Plugin panels](../../browser-extension/plugin-panels.md),
[browser panel](../../plugin-authoring/browser-panel.md), the site's page on workflows and plugin
panels, and the site's plugin panel picture are updated. The block contract is unchanged.

Decisions and deviations:

- The tab's marker is the severity table's red `circle-x`, named "Needs attention", not a dot.
  `TabDef.marker` draws an icon, and the Agents and Runs markers are icons too. `panelMarker` in
  `PluginPanel.tsx` makes it, beside the table, and `Workspace.tsx` reads it as it reads `runsLive`.
- The header's badge takes the block's severity, as designed, so an open pull request with a failing
  check reads **Open** in red. The prototype shows it green.
- The log lines don't repeat the source's name in bold on each line. The picker in the section's
  header already names it, and the kit's `Log` takes plain lines. `Log` is the part plugins and the
  terminal client draw logs with, so using it beat keeping a sidebar-only `pre`.
- The picker's filter reads "Filter sources", not "Filter containers". The block is generic, and a
  plugin's sources need not be containers.
- **Refresh** turns while a read it or a source pick started is out, and during the first read. A
  read the Node's change hint starts doesn't turn it. `refresh` and `pickSource` return the read's
  promise for that.
- **Copy** is the kit's `IconButton` with the panel's own copied state, not the kit's `CopyButton`.
  `CopyButton`'s look is in `copy.css`, which `@acorn/client-core` doesn't export, and adding an
  export means raising the package's export ceiling for one small button.
- A link that opens is the kit `Row`'s own `href`, which sets `target="_blank"` for an outside
  address. The row already ignores a click on a control inside it, so **Copy** doesn't follow the
  link.
- A later `status` block's detail is the row's tip. Neither plugin sends one, so the row stays one
  line.
- With no `status` block first, the header still draws **Refresh** and **Open in Acorn**, with
  nothing at the left.
- The blocks sit in `.panel-blocks`, so the sidebar's `.view > section` padding doesn't double the
  kit sections' own. The old `.panel-block` rules are gone. Two rules remain in `sidebar.css`: the
  header's layout, and a 24em cap on the log's height.
- The site's page said none of the shipped plugins has a browser panel. It now names the GitHub and
  Docker panels.

How close this is to the desktop and terminal: neither draws `browserPanelView` at all. A panel is
an extension-only surface, so there was no second renderer to share. What the panel draws with is
shared: `Heading`, `Badge`, `Text`, `Inline`, `Stack`, `Section`, `Row`, `IconButton`, `Picker`, and
`Log` are kit parts, and the terminal host has all of them. Sidebar-only, so a plugin can't reach it:
`PluginPanel`, `PanelHeader`, `Block`, `Copy`, and the `SEVERITY` table, plus `.panel-head` and
`.panel-blocks .ui-log-lines` in `sidebar.css`. To draw a panel on the desktop or in the terminal,
move `PanelHeader` and `Block` into the kit, or into `@acorn/client-core` beside it, as a
`BrowserPanelBlocks` component taking the view and the two callbacks, and drop the header's two CSS
rules for `Inline` with `spread`. The extension would then pass `OpenInAcorn` in as the header's
action. That needs a host that wants to show a panel, such as a task pane, which no plan has yet.

For later phases:

- A panel's header and rows are kit parts with no sidebar CSS beyond `.panel-head`.
- Tests: `PluginPanel.test.tsx` has `header`, `rows`, `mark`, and `logLines`, and picks a log
  source through `pickFrom(panel, 'Log source', …)`. `pnpm dev:extension:ui pick "Log source" db`
  does the same in a browser.

## Goal

The pull request and Docker panels read at a glance. The first status block becomes a header with its
state as a badge. Rows get status icons. Links drop their scheme, open on a click, and copy from an
icon. **Refresh** and **Open in Acorn** move into the header as icons. The block contract doesn't
change in this phase, so every plugin's panel improves at once.

## In the prototype

- Scenarios: **Pull request panel** and **Docker panel**. In the Docker panel, switch the log source.
- Notes: `pr` at line 1316 and `docker` at line 1318.
- Code: `prView` at line 1009 and `dockerView` at line 1037. `row` and `linkRow`, under `prView`, draw
  a block's row and a link. The `logs` case of `pickerSpec` at line 1080 is the log source picker. In
  `tabStrip` at line 774, the pull request tab carries a red dot.
- Today: `references/extension-ux/today/09-panel-github-dark.png`.

## Starting point

- `apps/extension/src/sidebar/PluginPanel.tsx` draws a `BrowserPanelView` as text: a **Refresh** row,
  then each block. A `status` block is a line with its detail as preformatted text. A `logs` block's
  source is a native select. Only a web address that answers opens in a tab, and anything else is
  copied.
- The contract is `browserPanelView` in `packages/protocol/src/plugin/handoffs.ts`. It has four block
  kinds, `status`, `links`, `rows`, and `logs`, and it's strict: a field this build doesn't know
  refuses the whole view.
- The GitHub plugin builds its view in `plugins/github/src/server/browserPanel.ts`. Its status block's
  `label` is "Pull request #482", its `state` is Open, Draft, Merged, or Closed, and its `detail` is
  the title, the branches, the merge line, unresolved threads, and auto-merge, one per line.
- The Docker plugin builds its view in `plugins/docker/src/server/browserPanel.ts`.

[Plugin panels](../../browser-extension/plugin-panels.md) documents the contract and today's drawing.

## The design

### The header

The view's first block, when it's a `status` block, becomes the header:

- On the left, a large line: the label, such as "Pull request #482", then the state as a kit `Badge`
  toned by the block's severity.
- Under it, each line of `detail`. Draw the first line in bold, the second in monospace when it
  holds "→", and the rest as muted lines. Those are the GitHub plugin's lines today, and a plugin
  that sends one line gets one bold line.
- On the right, two icon buttons: `refresh-cw` labelled "Refresh", which spins while a read is out,
  and `arrow-up-right` labelled "Open in Acorn".

The bold first line and the monospace "→" line read a convention out of free text. That's a shortcut,
and a comment in the code should say so. The proper fix is the optional field in "Later" below.

A `status` block that isn't first draws as a row, with the icon its severity gives.

### Rows

Each row of a `rows` block, and each later `status` block, draws as a kit `Row`: an icon by severity,
the label, and the state at the right. A panel's severity is one of `info`, `warn`, `danger`, and
`pending`. There's no "ok": the GitHub plugin sends `info` for a passing check and an approving
review. Map severity to icons once, beside the `TONES` table `PluginPanel.tsx` already has:

| Severity | Icon | Tone |
| --- | --- | --- |
| `info` | `circle-check` | ok |
| `warn` | `circle-alert` | warn |
| `danger` | `circle-x` | bad |
| `pending` | `circle-dashed` | faint |

The prototype spins a check in progress and draws a requested reviewer as a dashed circle. Both arrive
as `pending`, so this phase draws both dashed. A spinner on a reviewer who hasn't looked yet would say
something false.

A section header names each block with its title and the count of its rows.

### Links

Each link is a row: a `link` icon, the label, and under it the address without `https://` or
`http://`. At the right, a copy icon button, which turns into a check for a moment after copying. A
web address that answers also shows a faint `arrow-up-right`, and a click on the row opens it. Any
other address, such as `postgres://localhost:5432`, or one with `ready: false`, has no arrow and opens
nothing.

### Logs

The log source becomes a small ghost button in the block's header, opening the kit's `Picker` with
"Filter containers". The lines draw in a monospace block with the source's name in bold at the start
of each, as the prototype's `LOGS` shows.

### The tab's marker

When the header's severity is `danger`, the panel's tab in phase 1's tab strip shows a small red dot.

## Changes

1. Redraw `PluginPanel.tsx` as above. Keep its handling of a failed read and of a panel that goes.
2. Move **Refresh** and **Open in Acorn** into the header.
3. Add the severity table and the link rows.
4. Replace the logs select with a `Picker`.
5. Report the header's severity to the tab strip.
6. Update `PluginPanel.test.tsx` for each block kind and for the copy and open rules.
7. Update [plugin panels](../../browser-extension/plugin-panels.md).

## Later

The prototype shows an icon on each summary line, such as a red `circle-x` on "Some checks are
failing". A line's meaning isn't in the contract, so this phase can't draw that. An optional
`lines: { text, severity, glyph? }[]` on the `status` block would carry it. The contract is strict, so
an extension that doesn't know the field refuses the whole view. Ship the field in the extension and
the protocol first, then have the GitHub plugin send it in a later release.

## Acceptance

- The pull request panel's header reads "Pull request #482" with an **Open** badge, the title in bold,
  and the branches in monospace.
- A failing check shows a red `circle-x`, and the Pull request tab shows a red dot.
- A link reads `github.com/acme/billing/pull/482`, opens on a click, and copies from its icon.
- The Docker panel's `postgres://` port copies and doesn't open.
- Switching the log source reads that container's lines.
