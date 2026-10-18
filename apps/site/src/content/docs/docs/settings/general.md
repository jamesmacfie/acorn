---
title: General
description: Every setting in the General group, which belongs to the device you're using.
sources:
  - docs/frontend/settings-pages.md
  - docs/ui-design/appearance.md
  - packages/client-core/src/features/settings/corePages.ts
  - packages/client-core/src/features/settings/AppearanceSettings.tsx
  - packages/client-core/src/features/settings/appearancePrefs.ts
  - packages/client-core/src/features/settings/uiStyles.ts
  - packages/client-core/src/features/workspaces/workspaceRailPrefs.ts
  - packages/client-core/src/features/notifications/settings.ts
  - packages/client-core/src/features/settings/NotificationSettings.tsx
  - apps/desktop/src/client/CliSettings.tsx
  - apps/desktop/src/client/BackgroundSettings.tsx
  - docs/shell/process.md
covers:
  - appearance
  - notifications
  - shortcuts
  - cli
  - background
checked: 52225e24f
---

This page lists every setting in **Settings** > **General**. Every page here is stored on **This
device**: it changes this screen, not the Node, so each of your devices keeps its own.

## Appearance

How acorn looks on this device ([Appearance](/docs/using/appearance-themes-and-styles/)).

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Show workspace rail** | Shows the rail of workspace icons at the far left. Reads **Show project rail** when projects are kept separate. | This device | Off |
| **Style** | Shapes, fonts, and spacing: one of four style packs, or one a plugin adds. | This device | Terminal |
| **Match the system's light or dark mode** | Follows the operating system's light or dark mode. | This device | On, until you pick a theme |
| **Theme** | The colors, while not matching the system. | This device | Light |
| **Light theme**, **Dark theme** | The theme for each mode, while matching the system. | This device | Light, Dark |

## Notifications

How acorn tells you an agent needs you, and when
([Notifications and the inbox](/docs/using/notifications-and-the-inbox/)).

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Send a test** | Sends a test notification through the channels that are on. | | |
| **Play a sound** | A sound with each notification. | This device | On |
| **Show a system notification** | A notification from the operating system. | This device | On |
| **Show a count on the app icon** | A count on the app's icon. Shown only where the app can draw one. | This device | On |
| **An agent needs me** | Notify when an agent is waiting on a permission, a question, or a gate. | This device | On |
| **An agent finishes** | Notify when an agent's turn ends. | This device | On |
| **An agent fails** | Notify when an agent's turn fails. | This device | On |

## Keyboard shortcuts

Every shortcut, grouped as **Global**, **Panes**, **Tasks**, and each plugin's own, with its chord. To
change one, click it and press the new keys. **Unbind** removes it. [Keyboard
shortcuts](/docs/using/keyboard-shortcuts/) lists the defaults and covers conflicts.

**Shortcuts for removed plugins**, under **Removed plugins**, clears the shortcuts you set for plugins
you've since uninstalled.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| Each shortcut | The chord that runs it. | This device | Its built-in chord |

## Command line

The `acorn` command for your terminal.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Location** | Where the `acorn` command is. **Add acorn to PATH** installs it in a folder on your shell's `PATH`, and **Update the acorn command** points it at this app when it points to another copy. | This device | Not installed |

The command runs with this app, so it stays in step when the app updates.

## Background

What happens when you close the desktop window. Only the desktop has this page.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Keep the Node running when the window closes** | Closing the window leaves this computer's Node running, with an icon in the menu bar or system tray, so clients on other machines keep working. The icon's menu shows the Node's state and address, and has **Open acorn**, **Pair another client…**, and **Quit acorn**. | This device | Off |
| **Open acorn at login** | Opens acorn at login with no window, in the tray. Available only while the first switch is on. | This device | Off |

While the window is closed, this computer shows no acorn notifications, sounds, or app icon count.
Clients on other machines still show them. A client on this computer that asks to pair opens the
window, and quitting from the tray opens it to ask about anything still running. On Linux with GNOME,
the icon shows only with the AppIndicator extension installed.

## In the terminal

The terminal client draws its own **Notifications** page, which shows how it alerts you in the
terminal. **Appearance** and **Keyboard shortcuts** name the terminal client's own `acorn.json`, where
you set them by hand. **Command line** doesn't apply: you're running the command already. **Background** is the desktop's
alone.
