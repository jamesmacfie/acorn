# 06-6. A plugin's page puts its tabs in the middle, and one tab is often empty

**Status:** not started. Batch B06. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

A plugin's page opens with a **Status** section, then its tab strip, then the tab's sections. So the
strip sits about 190 pixels down the page and **Status** sits outside every tab. The **Settings** tab
says "This plugin has no settings page." for most plugins. **Versions** shows its facts as setting
rows with the value as the description, a fifth read-only shape. A tab that is usually empty is a
click that teaches nothing.

## Where to see it

Settings › Installed › **Manage** on any plugin (linear is a good one). Look at **Overview**,
**Settings**, **Permissions**, and **Versions**.

## Already done

- K5 shows the plugin's name in the title, breadcrumb, **Enabled** switch, tab strip, and
  confirmations. The **Status** line keeps the id on purpose.
- K2's 05-2 took the fill off the strip and put its first label on the content edge.

## The fix

All in `packages/client-core/src/features/settings/plugins/PluginPage.tsx`:

- Around `:113-131`: the **Enabled** row and the status alert become the first rows of **Overview**.
- Around `:135-137, 220-247`: fold the **Settings** tab into Overview's **What it adds**. Settings
  pages and replaced surfaces are things a plugin adds, like commands and agent tools. That leaves
  three tabs.
- Around `:376-390`: the **Versions** facts become `Facts` in the settings grid (B05's column rule),
  in a section with a name that does not repeat the tab, for example **Installed version**. Plan
  decision 11 renames a section rather than hiding its label, which keeps a place for a help mark.
- Around `:198, 203`: links are ghost sm buttons (see [06-12](./06-12-links-to-other-pages.md)).

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `:113` | Status / {id} {version}, {origin}. | Remove the description | The title and the versions section say it. |
| `:114` | Takes effect when the node next starts. / Takes effect at once on this device. | Rewrite second | Takes effect when the node next starts. / Applies right away on this computer. |
| `:115` | Required. acorn needs it to run. | Keep | |
| `:154` | Read from the node this window runs on, not the node in the header. Switch the app to that node to see what the plugin adds there. | Rewrite, keep inline | This shows what the plugin adds on the node this window uses, not the one in the header. To see the other, switch the window to that node. |
| `:202` | {n} tools for agent sessions. | Rewrite | {n} agent tools |
| `:207` | Events it announces / Other plugins may listen for these. | Move to `help`, rewrite | Help: "Other plugins can react to these." |
| `:214` | Nothing it adds is on this device right now. A plugin that is off or waiting for approval registers nothing here. | Rewrite | It isn't adding anything right now. A plugin that's off or waiting for approval adds nothing. |
| `:226` | This plugin has no settings page. | Remove | The tab folds into **Overview**. |
| `:241` | Offers to draw {labels} instead of acorn. | Rewrite | Can replace acorn's {labels}. |
| `:316` | It declares no permissions. / A built-in plugin ships with acorn and runs with acorn's own access. | Rewrite first | It doesn't ask for any permissions. / (keep) |
| `:320` | Approvals on this device / Each bundle this device runs was approved here, by its exact bytes. | Rewrite, move to `help` | Label **Approvals on this computer**. Help: "You approve each version of a plugin before this computer runs it." |
| `:321` | Built in. Its interface ships with acorn, so there is nothing to approve. / No decision recorded yet. | Rewrite | Built in, so there's nothing to approve. / No approvals. |
| `:336` | This device trusts every new bundle of this plugin without asking. End it when you stop working on the plugin. | Rewrite | This computer runs each new version of this plugin without asking. Turn it off when you finish working on the plugin. |
| `:338` | Development mode trusts every new bundle without asking, for a plugin you are writing. | Rewrite | For a plugin you're writing: runs each new version without asking. |
| `:339` | Development mode trusts every new bundle without asking. It starts when you approve an agent's request to install a plugin it is writing. | Rewrite | Runs each new version without asking. It turns on when you let an agent install a plugin it's writing. |
| `:343, 345` | Dev trust / End dev mode | Rewrite | Turn on / Turn off |
| `:376` | Versions (section) | Rewrite | A name that does not repeat the tab (decision 11). |
| `:377` | {version}, for plugin API {n} / Ships with this version of acorn. | Rewrite first | {version}. The API version goes to `help`. |
| `:381` | bundled with acorn (Source value) | Rewrite | Built in |
| `:387` | Fetches the newest version from its source. A new bundle asks for trust again. | Rewrite, keep inline | Gets the newest version from where it was installed. You approve it before it runs. |
| `:436-445` | Remove from this device / … This cannot be undone. | Keep | |

Rows 822, 840, 851, and 853 follow the vocabulary rule: "this computer" in static copy. Row 184 is
[06-14](./06-14-rail-and-surfaces.md)'s.

## What earlier batches give you

- **`help`** on `SettingsSection` and `SettingRow` (K3).
- **The `Facts` column rule** (B05): `.ui-settings-section .ui-dl[data-layout='columns']` uses the
  setting grid's columns, with the value end-aligned.

## Risk and checks

- Before you start, check which plugins actually have a settings page, so the folded list is right
  for them.
- Screens: a plugin page's four tabs before, three after. Check a plugin with a settings page and one
  without.
- Tests: client-core (`PluginPage` and settings search, if a section id moves).
