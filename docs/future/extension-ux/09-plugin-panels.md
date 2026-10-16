# Phase 9: plugin panels drawn with more care

Date: October 16, 2026. Status: proposed. Depends on [phase 1](./01-navigation.md).

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
