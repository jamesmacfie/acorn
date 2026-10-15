---
title: Advanced
description: Every setting in the Advanced group, which belongs to the device you're using.
sources:
  - docs/frontend/settings.md
  - packages/client-core/src/features/settings/corePages.ts
  - packages/client-core/src/features/settings/DeviceConfigSettings.tsx
  - packages/client-core/src/features/settings/ExtensionPointsDev.tsx
  - apps/desktop/src/client/pageContributions.tsx
covers:
  - device-config
  - clear-cache
  - extension-points
checked: 52225e24f
---

This page lists every setting in **Settings** > **Advanced**. Every page here is stored on **This
device**.

## Device config file

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **File** | Shows where this device's `acorn.json` is: your appearance, shortcut, and layout choices. **Open file** opens it to edit by hand. | This device | |

## Clear cache

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Saved copies of what acorn loaded**, under **This window** | **Clear cache and reload** deletes this window's saved copies and reloads. Your tasks and settings aren't affected. | This device | |

The top bar's menu has the same **Clear cache**.

## Extension points

For plugin authors: every place a plugin can draw inside another plugin, what uses each, and
contributions that match nothing.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Which plugin draws this** | When two plugins offer to draw the same place, which one does. | This device | The point's own plugin |

**Language services** lists the plugins that add hover and diagnostics for a language.

## Not listed here

Development builds of the desktop app add a style gallery to this group, for writing style packs. It
isn't in a release build, so this reference leaves it out.

## In the terminal

These pages open in the desktop app. **Device config file** names the terminal client's own
`acorn.json`.
