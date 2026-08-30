# Rail controls and plugin-published status markers

Status: **done 2026-08-30.** Slices 1 and 2 shipped 2026-08-27. Slice 3 was superseded by the
`annotation` kind (docs/plugins.md § Cooperative extension points), which shipped 2026-08-29, and the
draw site it was waiting for shipped with layout phase 10: `core:task` is declared in
`@acorn/protocol/extensionPoints.ts` and drawn by `client-core/src/tasks/taskAnnotations.ts`.

The rail audit of 2026-08-27 planned three slices. Two shipped and their behaviour is owned by the
docs, not by this file: [ui-design.md § Rail controls and status markers](../ui-design.md) for the
component and the marker model, [plugins.md § Rail markers](../plugins.md) for the compiled
contribution, [frontend.md § Registries and plugins](../frontend.md) for the registry, and
[panes.md](../panes.md) for why a pane marker is not a pane freshness hook. The full plan, with its
current-state survey, presentation contract, collision policy, test plan, and STOP conditions, is in
git history: `git log --follow -- docs/future/rail-tab.md`.

## What shipped

- One host-owned `RailTab` for every control in both rails: semantic `glyph`, `tone`, `accent`,
  `active`, `busy`, `sublabel`, and resolved `markers`. The 44px and 52px bottom-control mismatch is
  gone.
- A pure marker model (`packages/client-core/src/tabs/railMarkers.ts`): stable ids, one of `icon`
  or `dotTone`, an ordered placement preference, host priorities above a clamped plugin range,
  deterministic allocation, every unplaced marker kept in the tooltip legend.
- A compiled registry (`ctx.railMarkers.register`) that core and docker publish through. The
  `tabrail.task-row` component slot and `DockerRailBadge.tsx` are deleted.

## Slice 3, and why it is not built here

Slice 3 was a manifest `railMarkers` contribution: one node-scoped route per loaded plugin returning
a bounded batch of markers keyed by task, source, or pane, fed into the same allocator. The
constraints it settled still hold and are worth keeping on the record: one batched read per plugin
and node, never a request per visible control; a 256-marker response cap with malformed items
dropped individually; exactly one of `icon` or `dotTone`; a non-empty label; priorities clamped to
`0..100`; `bottom-center` reserved for host lifecycle; ownership checks that a source or pane target
names a surface the same plugin declared; and no click verb.

It is not built as a rail-specific contribution. A marker on a task row is a fact pinned to an item
another surface draws, which is the **annotation** kind in [docs/future/layout/](./layout/README.md)
([03-extension-kinds.md](./layout/03-extension-kinds.md) § Annotations). The `core:task` annotation
point, keyed by task id, is the loaded-plugin rail marker: batched by the host, drawn by the host,
provenance stamped, arbitrated by the same allocator. Building it as annotations gives docker's rail
row, a diff line, and an editor gutter one mechanism rather than three. Every wire constraint above
carries over to that point's row.

The annotation kind itself shipped in phase 4 of the layout programme: the manifest key, the batched
POST, the host-side sanitiser, the provenance stamp and the draw site on `DiffPane`. `core:task` waited
for the allocator above, and phase 10 declared it. Nothing in the mechanism changed — it is one more
`annotation` point — but the *drawing* is the rail's rather than `AnnotationMarks`': a 52-pixel square
has no room for a line of text, so a mark becomes a rail marker with the icon in a free corner and the
words in the hover legend, and the contributor's id goes in the legend line rather than beside the
icon. That translation is the host's decision about its own surface, and it is why the mark shape
carries a severity and an icon and no geometry.

Core declares the point in `@acorn/protocol/extensionPoints.ts` because core has no manifest to declare
it in, the same way `CORE_HOOK_POINTS` are named there. The wire constraints above carry over: one
batched read per contributor for the whole visible list, display strings only, and provenance stamped
by the host.

## Maintenance notes that survive

- `RailTab` is not exported from `@acorn/plugin-api/ui`: plugin frames do not draw shell rails, and
  plugins publish marker data rather than rendering the control.
- Placement requests are preferences, never guarantees. A sixth visual position needs a reason
  overflow-in-legend cannot serve; a 52px control has a strict information budget.
- A CSS selector in a feature or plugin stylesheet that positions a rail marker is the regression
  signal that placement escaped the host.
