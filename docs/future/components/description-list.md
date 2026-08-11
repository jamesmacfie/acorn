# DescriptionList

Label/value pairs: response headers, container info, usage stats, issue facts, node fingerprints,
shortcut tables. Bootstrap covers this with `<dl>` utilities; shadcn leaves it to Table. acorn has
written the same two-column (or auto-fit) label/value grid at least **nine times**, split between
`<dl>` markup and div-pairs, with no shared geometry.

## Today

- http: `.http-kv-list` `<dl>` grid — response headers and failure detail
  (`plugins/http/src/frame/ResponseView.tsx:98-107,139-154`, `http.css:334-342`)
- linear: `.ln-facts` `<dl>` with `auto-fit minmax(9.375rem,1fr)` (`LinearIssueView.tsx:160-179`)
- rollbar: `Fact` component — div pairs inside a `.rb-stats` auto-fit grid
  (`RollbarItemView.tsx:33-38,85-92`, used again in occurrence detail `:174-177`)
- docker: `.docker-info` `<dl>` `max-content 1fr` grid, reused for stats
  (`ContainerDetail.tsx:241-289,357-365`, `docker.css:91-93`)
- agents: `.agent-usage-values` `<dl>` (`AgentUsageSection.tsx:58-67`, `agent-usage.css:71-73`)
- core: `.fleet-card-stats` (`FleetHome.tsx:88-122`), `.node-fingerprints` (`nodes.css:117-134`),
  `.help-list` (`overlays.css:67-85` — also the shortcut editor grid in
  `ShortcutsSettings.tsx:127-151`)
- onboarding: `.wizard-keys` `<dl>` with `<kbd>` terms (`OnboardingWizard.tsx:335-339`)

Two recurring layouts cover all of them: **columns** (label left, value right, `max-content 1fr`)
and **facts** (auto-fit tiles, label above value).

## Proposed API

```tsx
export function DescriptionList(props: {
  layout?: 'columns' | 'facts'
  size?: 'sm' | 'md'
  class?: string
  children: JSX.Element
})
DescriptionList.Item = (props: {
  label: JSX.Element
  mono?: boolean               // docker's .mono value cells
  class?: string
  children: JSX.Element        // the value; can be an anchor, a Chip, a <kbd>…
})
```

Renders a real `<dl>`/`<dt>`/`<dd>` (items wrap in a div for grid placement, the pattern linear
already uses). Semantics for free, and it forces the label to exist — half the hand-rolled sites
have no accessible pairing.

## How to build it

- `packages/client-core/src/ui/primitives.tsx`; `.ui-dl` in `styles/primitives.css`
  (frame-served — http/linear/rollbar/database frames are heavy consumers). `data-layout`,
  `data-size`; grid tokens only.
- `facts` layout: `repeat(auto-fit, minmax(9.375rem, 1fr))` — lifted from rollbar/linear, the two
  best current implementations.
- No data props (no `items={[]}` array API) — children composition matches how every current site
  builds them, and keeps the component out of the business of formatting values.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- Frames: http's two `<dl>`s, linear's facts, rollbar's `Fact` (delete the local component).
- docker's info/stats lists; agents' usage values.
- Core: fleet card stats; node fingerprints; `.help-list` (both the shortcuts overlay and
  `ShortcutsSettings` — pairs nicely with [kbd.md](./kbd.md)); onboarding's shortcut `<dl>`.
- github's ad-hoc `files · +N / −N` meta run (`PullSummary.tsx:63`) is NOT this — it's an inline
  meta line; leave it.

## Notes

- Values that are big widgets (progress meters in docker stats) still fit — `<dd>` takes JSX.
- If a site needs sorting/filtering it has outgrown this and wants [table.md](./table.md).
