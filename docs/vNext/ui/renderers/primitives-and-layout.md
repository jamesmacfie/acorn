# Primitives and layout

Status: Normative<br>
Requirement prefix: `UI-PRIM`

## Content primitives

| Component | Required properties | Behavior |
| --- | --- | --- |
| `text` | `value` ≤64 KiB, `role` | encoded selectable text |
| `heading` | `value` ≤500, `levelOffset` 0–3 | host fits contribution into heading outline |
| `icon` | Acorn/Lucide name or signed approved asset, label when standalone | inherits semantic tone/size |
| `badge` | text ≤80, tone | compact non-interactive metadata |
| `status` | label, state, optional detail/time | icon + text + tone |
| `callout` | title, body components, tone | bounded notice region |
| `code` | text ≤1 MiB, language ID, wrap | read-only encoded code |
| `keyValue` | rows ≤500 | definition-list semantics |
| `actionButton` | label, action ID, variant | invokes declared action |
| `linkIntent` | label, navigation intent | host navigation; never raw anchor behavior |
| `spinner` | label | reduced-motion-aware progress |
| `progress` | label, value/max or indeterminate | announces bounded changes |

- **UI-PRIM-001:** Text role is `body`, `label`, `caption`, `monospace`, or `secondary`; it cannot
  choose font family, size, color or arbitrary whitespace CSS.
- **UI-PRIM-002:** Markdown and HTML are not accepted by `text`, `heading`, `callout` title or
  action labels.
- **UI-PRIM-003:** Icons from signed assets are sanitized raster or approved static SVG through the
  asset pipeline; unknown names use a generic plugin icon and retain accessible label.
- **UI-PRIM-004:** Button variants are `primary`, `secondary`, `ghost`, and `danger`. `danger` is
  visual semantics only; destructive confirmation is enforced by the bound action contract.
- **UI-PRIM-005:** Progress updates are rate-limited to accessible announcements at meaningful
  thresholds and always include textual outcome.

## Layout primitives

| Component | Properties | Constraints |
| --- | --- | --- |
| `stack` | gap token, align, children | vertical logical order |
| `row` | gap token, align, wrap | horizontal; wraps in compact size |
| `grid` | 1–12 semantic columns, gap, breakpoints | host maps columns by size class |
| `section` | title/description/actions, collapsible | landmark/heading-aware bounded group |
| `tabs` | selected binding, tab IDs/labels/panels | manual activation keyboard model |
| `disclosure` | expanded binding, summary/content | host-controlled animation |
| `toolbar` | label, actions/groups | roving keyboard focus |
| `scroll` | axis, restore key | one bounded scroll owner |
| `separator` | orientation, label optional | semantic or decorative |
| `split` | primary/secondary, weight binding | two regions only, keyboard resize |
| `spacer` | named spacing token | decorative and inaccessible |

- **UI-PRIM-006:** Layout nesting depth is included in the document depth limit. `scroll` inside
  `scroll` on the same axis is invalid unless a renderer contract explicitly owns virtualization.
- **UI-PRIM-007:** Gap/spacing values are host token names, not measurements. Plugins cannot create
  negative spacing, overlap, fixed positioning or content outside allocated bounds.
- **UI-PRIM-008:** Logical child order is reading and keyboard order. Visual reordering that
  differs from the document order is prohibited.
- **UI-PRIM-009:** Tabs have 2–20 items, stable IDs and one selected enabled item. Removing the
  selected tab chooses the nearest enabled neighbor and returns focus safely.
- **UI-PRIM-010:** Section collapse and tab selection are client-session bindings unless declared
  shared product state, in which case an explicit command persists them.
- **UI-PRIM-011:** Split weights are presentation state, bounded by host minimums and never replace
  the task-level pane layout contract.

## Common state wrapper

`stateBoundary` selects one of `ready`, `loading`, `empty`, `stale`, `offline`, `denied`,
`unsupported`, or `error` and contains signed safe labels/actions for each non-ready state.

- **UI-PRIM-012:** The host may override plugin text for security, authorization, connection and
  unsupported states. Plugin recovery actions remain subject to availability and authorization.
- **UI-PRIM-013:** Error state uses stable error code, safe message, correlation ID and permitted
  retry/report actions. It never renders a stack or raw provider payload.
- **UI-PRIM-014:** Empty state is a successful authorized result with zero items and MUST NOT be
  used for permission denial or network failure.

## Acceptance

- **UI-PRIM-015:** Tests MUST cover maximum text/rows/tabs, invalid nested scroll, removal during
  focus, RTL logical ordering, zoom/wrap, reduced motion, dangerous labels/URLs/assets and every
  state-boundary transition.
