# Detail regions

This page covers how a loaded plugin reserves room above or below one of its own detail views for
other plugins' trees. Read it before you add `mounts` to a point or fill Linear's or Rollbar's. It's
part of the [plugin reference](../plugins.md), beside [remote points](./remote-points.md).

## What a detail region is

A compiled owner opens a [remote point](./remote-points.md) by drawing a `Slot` in its own tree. A
loaded owner's tree runs in a worker and can't open a slot: grafting is one level deep. So a loaded
owner names the views it wants extended, and the host draws the point outside the owner's tree.

The owner adds `mounts` to a `remote` point in its manifest:

```json
{ "id": "issue-summary", "kind": "remote", "label": "Issue summary",
  "mode": "stack", "max": 2,
  "mounts": [{ "surface": "linear-issue", "region": "header" },
             { "surface": "linear-ref", "region": "header" }] }
```

`region` is `header` (above the view) or `footer` (below it). `surface` is one of the same manifest's
project-scoped panes or reference panels. A point lists up to eight mounts, and one region of one
surface takes one point. The rest of a remote point works as usual: `mode`, `max`, and `matches` decide
who draws.

A contributor fills the point like any other remote point:

```json
{ "id": "deploys", "point": "linear:issue-summary", "label": "Deploys", "remote": "issueSummary" }
```

## What the host does

`client-core/src/host/frames/register.ts` reads `mounts` off the owner's own roster row and wraps the
owner's view. The wrapper is the host seam in `client-core/src/host/chrome/extendedPane.ts`: the
desktop draws `ChromeExtendedPane.tsx` and `DetailRegion.tsx`, and the terminal draws
`apps/tui/src/plugins/ExtendedPane.tsx`. A reference panel draws its regions in `PluginRefPanel.tsx`.

Each region is an ordinary `Slot`, a sibling of the owner's tree. The contributor's tree gets these
props, and nothing of the owner's:

| Prop | Value |
| --- | --- |
| `surface` | The owner's surface id, such as `linear-issue` or `linear-ref` |
| `item` | The resource the view shows: the routed item on a project view, the reference on a panel |
| `refId` | On a reference panel only, the same reference |
| `projectId` | On a project view only |

Read anything else through your own routes and declared capabilities. The owner's provider facts and
grants never cross. The bridge is scoped to the owner's project, or to nothing on a reference panel.

The host follows the view's selection:

- A new routed item is a props update. The contributor's worker keeps running.
- A new project or a different view remounts the contributors, because a tree's bridge binds its
  scope when it mounts.
- With no item, nothing mounts. With no contributor, the region draws nothing.

On the desktop, a region is capped at 30% of the view's height and scrolls on its own, so the owner
keeps its height and its scrolling. On the terminal, it's capped at 30% of the pane, in reading order
around the owner's view.

## Shipped points

| Point | Mounted on | Mode |
| --- | --- | --- |
| `linear:issue-summary` | The header of `linear-issue` (project detail) and `linear-ref` (reference panel) | `stack`, up to two |
| `rollbar:item-summary` | The header of `rollbar-item` (project detail) | `stack`, up to two |

Linear's `item` is the ticket identifier. Rollbar's is the rail row's `<connection>:<identifier>`.

## Limits

- Only project panes and reference panels take mounts. A task pane's selection can change inside its
  tree, where the host can't see it, so task panes wait for an owner selection contract.
- The terminal has no reference panel, so `linear-ref` regions draw on the desktop only.
- The owner can't pass actions to a region's contributors.
- A tree that emits its own `Slot` gets nothing, inside a region or out.

## Why

The host draws the region, so the owner consents in its manifest and never runs another plugin's code
in its tree. This keeps remote composition one level deep without a nested-slot protocol.
