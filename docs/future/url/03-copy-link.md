# Phase 03: copy link

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: phase 01.
Read the [plan](./README.md), especially the decision that
[Copy link produces the exact path](./README.md#decisions).

## Deliverable

A **Copy link** action that puts an `acorn://` link to the current place on the clipboard. It is
available on a task, a project page, a plugin page under a project, a settings page, and a rail source.

## Steps

1. Add one core command, **Copy link**, that builds a link from the active Node's ID and the current
   place with `buildLink`. On a task, include the focused pane and its selected item when the pane
   reports one.
2. Show the command in the palette, in the task row's menu, in a project page's menu, in the settings
   page header, and in the rail source's menu. Use the existing menu contribution points, not a new
   one.
3. Plugin pages get the action with no plugin code. The command reads the router's current path, which
   already carries the plugin's page.
4. Confirm the copy with the same short toast other copy actions use.

## Acceptance

- Each place produces a link that phase 01's parser reads back to the same place.
- A plugin page's link opens that page through `pnpm dev:agent:ui -- --session <name> link <copied link>`.
- A link copied on one Node and opened on a device paired with a different Node shows the unpaired
  Node refusal, not the wrong data.
- `pnpm lint`, `pnpm test --filter=@acorn/client-core`, and the desktop suite pass.

## Verify before building

- Which menus accept core contributions on each of these places, and how the terminal client shows
  the same command.
- Whether a pane can report its selected item today, or whether the task link stops at the pane.
