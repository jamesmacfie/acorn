---
title: Plugins
description: Every setting in the Plugins group, for the plugins on a Node and what shows in this device's left rail.
sources:
  - docs/frontend/settings-groups.md
  - docs/frontend/rail-and-routing.md
  - docs/security/plugin-install.md
  - docs/security/plugin-bundles.md
  - packages/client-core/src/features/settings/corePages.ts
  - packages/client-core/src/features/settings/plugins/PluginPage.tsx
  - packages/client-core/src/features/settings/plugins/ModelGrantSection.tsx
  - packages/client-core/src/features/settings/plugins/RailSurfacesSettings.tsx
covers:
  - plugins
  - rail-surfaces
checked: 'ec0e73ca1'
---

This page lists every setting in **Settings** > **Plugins**. **Installed** is stored on the Node, and its
header picks which Node with more than one. **Rail and surfaces** is stored on **This device**.

## Installed

Every plugin on the Node, and those installed on this device alone. **All**, **Needs you**, and **This
device** filter the list. **Install…** adds one
([Plugin trust and permissions](/docs/security/plugin-trust-and-permissions/#install-a-plugin-on-a-node)).
**Manage** opens a plugin's page, with three tabs, and a **Logs** tab while it's in development mode:

| Tab | What it holds |
| --- | --- |
| **Overview** | Whether it's on, and **What it adds**: its rail icons, settings pages, commands, agent tools, data sources, and skills, each with a switch where it has one. Its model allowance, when it generates text. |
| **Permissions** | **What it may do**, with wide grants marked **Broad access**, and **Approvals on this computer**, with **Revoke approval** for each approved version. |
| **Versions** | The installed version, **Update**, and **Danger zone**. |

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Enabled**, on **Overview** | Turns the plugin on or off on the Node. | Node | On |
| A skill's switch | Whether agents may load that skill. | Node | On once approved |
| **Revoke approval** | Stops this device running that version, until you approve it again. | This device | |
| **Development mode** | Trusts new versions of the plugin from this Node without asking. | This device | Off |
| **Uninstall, keep its data**, **Uninstall and delete its data** | Removes the plugin from the Node. A plugin on this device alone has **Remove from this device**. | Node | |

**Create a plugin** starts a prompt in the open task's agent: **Ask an agent** to write a plugin, or
**Start** a data source built from your connections. You decide whether to install what it writes.

## Rail and surfaces

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Show … in left rail**, under **Left rail** | Shows or hides a plugin's icon in the left rail. A hidden one still opens from the command palette. | This device | Shown, unless the plugin asks to start hidden |
| **Task list in the rail**, **Pane switcher**, **Left rail**, **Top bar**, under **Replaced surfaces** | Which plugin draws that part of acorn, when a plugin offers to replace it. | This device | acorn's own |

A plugin's page can carry the same **Show in left rail** switch in its strip. Both write the same
choice.

## In the terminal

Both pages open in the desktop app. **Rail and surfaces** names the terminal client's own `acorn.json`,
where you set its left rail by hand.
