# Phase 10: one Settings page

Date: October 16, 2026. Status: proposed. Independent of the other phases, apart from Settings opening
from [phase 1](./01-navigation.md)'s top bar. [Phase 11](./11-connect.md) needs this phase's rename.

## Goal

Settings is one scrolling page instead of five tabs that don't fit. Today the last tab reads
"Appearan". **Sites** merges Permissions and Projects, since both are lists of websites. **Forget**
moves into each Node's ⋯ menu, away from the switch it sat one click from. A Node can be renamed here,
which lets pairing drop its name field.

## In the prototype

- Scenarios: **Settings** and **Add a site**. Change the theme in **Settings**, and watch the panel
  change.
- Notes: `settings` at line 1327 and `add-site` at line 1331.
- Code: `settingsView` at line 1044 draws the page, `siteModal` at line 1066 the dialog, and the
  `node:` case of `menuView` at line 1139 a Node's menu. `THEMES` and `themeSwatch` follow
  `settingsView`. The `theme` and `siteproj` cases of `pickerSpec` at line 1080 are the two pickers.
- Today: `references/extension-ux/today/15-settings-nodes-dark.png` to
  `19-settings-appearance-dark.png`.

## Starting point

- `apps/extension/src/sidebar/Settings.tsx` draws five kit `Tabs`: **Nodes**, **Projects**,
  **Permissions**, **Notifications**, and **Appearance**. Nodes lists each paired Node with **Use** and
  **Forget**, then **Pair a Node**.
- `apps/extension/src/sidebar/SiteAccess.tsx` lists the sites the extension may read, each a switch
  that asks the browser for optional host access.
- `apps/extension/src/sidebar/ProjectSites.tsx` lists every project's site associations, and `AddSite`
  is its dialog, with a native project select.
- `apps/extension/src/sidebar/appearance.ts` lists `THEMES` and `STYLES`. A theme of null follows the
  system.
- The host has no rename operation. `FleetStore.rename` in `packages/custody/src/broker/fleetStore.ts`
  already renames a Node's row and keeps the rest.

[Set up and troubleshoot](../../browser-extension/setup.md),
[project sites](../../browser-extension/project-sites.md), and
[request notifications](../../browser-extension/notifications.md) document today's controls.

## The design

The page has four sections, top to bottom.

### Nodes

A **Nodes** header with **Pair** at its right, a small ghost button with a plus, which opens pairing.
Then one row per paired Node:

- Leading, a dot: green or red for the Node in use, by its state, and an idle dot for the others.
- The Node's name, with its address in monospace under it.
- Trailing, an **In use** tag for the Node in use, or **Use** for another. Then a ⋯ menu with
  **Rename**, **Copy address** with the address as its note, a separator, and **Forget** *name*, in
  danger red.

**Rename** turns the name into a field in place. Enter saves and Escape cancels. It calls a
`node.rename` bridge operation with `nodeId` and `label`, the same limits `node.collect` puts on a
label, which calls `FleetStore.rename` and returns `{ nodes, activeNodeId, status }`, as `node.forget`
does. The name is this browser's own, so it renames nothing on the Node or in other clients.

**Forget** asks first, with the kit's `ConfirmButton`, as removing a pairing is hard to undo.

### Sites

A **Sites** header with **Add site** at its right. Then one row per website, merged from site access
and project associations:

- Leading, the plugin's logo for a site a plugin uses, such as GitHub or Linear, and a muted `globe`
  otherwise.
- The host, then what the extension does there in muted type: "Task chips on pull requests", "Look up
  issues", "Suggests web-app", or "Branch marker for Runn". A site with several uses lists them
  joined with commas.
- Trailing, for a site that suggests a project, a ⋯ menu that edits or removes that association. Then
  a switch: the browser's access to the site.

The switch is browser access and nothing else. Turning it off leaves a project's association in place,
which only means the panel can't read that site's pages. Delete the two explanations: "The sites the
extension may read, and what it reads them for." and "The panel suggests a project on these pages.
They give Acorn no access to a site."

Build the merged list in a function of its own, with tests, from what `SiteAccess` and
`ProjectSites` read today. One host can carry several associations and several uses. Key the row by
the access pattern the browser grants, since that's what the switch changes.

### Add a site

The dialog keeps its fields, as `siteModal` draws them:

- **Project**, the kit's `Picker`, with each project's workspace as its note.
- **Match**, a `SegmentedControl` with **Domain**, **Starts with**, **Exact page**, and **Regex**.
- The address or pattern, starting from the page beside the panel, as `pageSuggestion` does today.
  Under it, a green check and "Covers this page" when the value matches the page. Show nothing for a
  pattern.
- **Cancel** and **Add site**.

### Notifications

One row, "When an agent needs you", with "For projects of the page you are on" under it, and a switch.
It asks for the optional `notifications` permission as today.

### Appearance

- **Theme**, a small button with the theme's swatch and name, opening a `Picker` with "Filter themes",
  each row with its swatch. A **System** row comes first, for a theme of null.
- **Style**, a `SegmentedControl` with **Terminal**, **Modern**, **Cozy**, and **Cute**.

The themes' colours live only in `packages/client-core/src/infra/styles/tokens-theme.css`, scoped to
`:root`, so a swatch can't read another theme's colour from CSS. Add each theme's background colour as
a third value in `THEMES`, and a test that parses `tokens-theme.css` and checks each value against the
theme's background token, so the two can't drift.

## Changes

1. Replace the tabs in `Settings.tsx` with four sections.
2. Add the Node rows and their menu. Add `node.rename` to the protocol, the host, the host's tests,
   and [native messaging](../../browser-extension/native-messaging.md).
3. Build the merged site list, and draw it. Fold `SiteAccess.tsx` and the list part of
   `ProjectSites.tsx` into it.
4. Redraw `AddSite` with the project `Picker` and the "Covers this page" check.
5. Add the theme swatches, their test, and the theme picker.
6. Update `ProjectSites.test.tsx`, and add tests for the merged list, rename, and forget.
7. Update [set up and troubleshoot](../../browser-extension/setup.md) and
   [project sites](../../browser-extension/project-sites.md).

## Acceptance

- Settings shows Nodes, Sites, Notifications, and Appearance on one page in a 320-pixel-wide panel,
  with no clipped label.
- Renaming a Node changes its name in Settings and in **Go to task**'s footer, and survives the
  browser restarting.
- **Forget** asks before it removes a Node.
- Turning off `linear.app` asks nothing and removes the browser's access. Turning it on asks the
  browser.
- **Add site** with **Domain** on `app.acme.test` shows "Covers this page".
- Picking **Nord** changes the panel's colours at once.

## Risks

Merging the two lists hides the difference between access and association, which today's two tabs
spell out. The row's description says what each site is used for, and the switch only ever means
access. Keep it that way.
