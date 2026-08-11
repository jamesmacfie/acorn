# SegmentedControl

A small group of mutually-exclusive (or independently-toggling) buttons: unified/split diff,
Aa/\b/.* search flags, containers/images/volumes/networks sub-nav. shadcn calls the pieces Toggle
and ToggleGroup; Bootstrap has button groups with checkbox/radio behaviour. acorn has at least
**six hand-rolled implementations**, no two sharing markup, half missing ARIA.

## Today

Single-choice (radio semantics):

- github: `.diff-viewmode` `role="group"` + `aria-pressed` buttons (`DiffToolbar.tsx:52-58`)
- agents: `.agent-center-segments` ×2 — bare `Button`s with `classList={{active}}`, borders
  collapsed via `:last-child` (`AgentCenter.tsx:203-231`, `agent-center.css:70-81`)
- docker: `.docker-tabs.docker-subnav` — the tab class doing segmented duty, no roles
  (`DockerBrowse.tsx:285-289`)
- core: `.integration-provider-chips` (`IntegrationsSettings.tsx:155-162`) is chip-shaped but
  radio-natured

Independent toggles (checkbox semantics):

- editor: `.search-toggle` ×3 with `aria-pressed` — Aa, \b, .* (`SearchPanel.tsx:78-82`,
  `search.css:31-55`)
- github: `.diff-find-btn` Aa toggle (`DiffToolbar.tsx:44-46`)
- terminal: a lone `aria-pressed` topbar toggle borrowing the theme-toggle's class
  (`slotContribution.tsx:17`)

## Proposed API

```tsx
export function SegmentedControl<T extends string>(props: {
  options: readonly { value: T; label: JSX.Element; title?: string; disabled?: boolean }[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  ariaLabel: string
  class?: string
})

export function ToggleButton(props: ButtonProps & {
  pressed: boolean
  onToggle: (pressed: boolean) => void
})
```

Two components because the semantics genuinely differ: SegmentedControl is
`role="radiogroup"`/`aria-checked` with arrow-key movement (reuse the roving logic from
`ui/Tabs.tsx`); ToggleButton is a Button with `aria-pressed` and a pressed style.

## How to build it

- `packages/client-core/src/ui/primitives.tsx`; `.ui-segments` / `.ui-btn[data-pressed]` in
  `styles/primitives.css` (frame-served). The collapsed-border trick from agent-center becomes the
  base look; packs can round the group (`--radius-control` on the ends).
- ToggleButton is mostly Button + one data attribute — implement it as a `pressed` prop ON
  `Button` if that reads better; the separate name exists so call sites are greppable. Either way
  the pressed style must be distinct from hover in every pack.
- Export both from `@acorn/plugin-api/ui`.

## Refactors

- github's view-mode group and Aa toggle; editor's three search toggles (they keep their compact
  labels — `label` is JSX).
- agents' two segment groups (delete `.agent-center-segments`).
- docker's sub-nav — decide honestly: it navigates between object *lists*, so shared `Tabs` is
  arguably righter; either way it stops being a bare-button strip with no roles.
- core's provider chips when integrations settings are next touched; terminal's topbar toggle →
  ToggleButton (and stops borrowing `.theme-toggle`'s class).
- preview's loading/stop flip button (`PreviewPane.tsx:115`) → ToggleButton.

## Notes

- Don't merge with Tabs: tabs switch *panels* and get `tablist` semantics; segments switch a
  *value*. The docker case shows the boundary is judgement — the doc-comment should state it.
