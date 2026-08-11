# CollapsibleSection

A titled disclosure section: SectionHeader plus open/close, with optional persisted state and
count/actions slots. shadcn has Accordion and Collapsible; Bootstrap has Accordion and Collapse.
acorn's strongest single consumer already exists: github's PullDetail is **eight** of these in a
column, each hand-written.

## Today

Three mechanisms in circulation:

- Native `<details>`: github's `<details class="nav-section">` ×8 with localStorage persistence
  via an inline `rememberOpen` closure (`PullDetail.tsx:25-29,233-423`, `PullSummary.tsx:87`);
  agents' reasoning/tool/manifest folds (`AgentEventCard.tsx:38,81`, `toolRendererRegistry.tsx:10`);
  core's `WorkspaceProjectSettings.tsx:64` and `PluginTrustDialog.tsx:226`
- Signal + button: context's expander rows (`ContextPane.tsx:164-167,206-213` — two different
  twist-glyph markups in one file), `NodeDevices.tsx:45`, `NodeGate.tsx:37`, notes' "+ memory"
  toggle with no `aria-expanded` (`MemorySection.tsx:106`)
- Set-based collapse: docker's group headers (`DockerBrowse.tsx:146-150`), github's checks steps
  (`ChecksPanel.tsx:48-55`, no `aria-expanded`), terminal's none

Plus the persistence half: `rememberOpen` writes `localStorage['section-open:<key>']` — a shared
concern implemented inline.

## Proposed API

```tsx
export function CollapsibleSection(props: {
  label: JSX.Element
  count?: number                 // SectionHeader's existing count slot
  actions?: JSX.Element          // rendered in the summary row, click-isolated from the toggle
  level?: 'pane' | 'group' | 'sub'
  persistKey?: string            // localStorage-backed open state
  open?: boolean                 // uncontrolled default / controlled override
  onToggle?: (open: boolean) => void
  class?: string
  children: JSX.Element
})
```

Renders native `<details>/<summary>` (free keyboard + semantics; every current `<details>` site
keeps its behaviour), with the summary composed from `SectionHeader`'s label/count/actions
structure so the closed state looks exactly like a section header.

## How to build it

- `packages/client-core/src/ui/CollapsibleSection.tsx`. The persistence write is a plain
  localStorage effect — allowed in ui/ by the same carve-out `DiffRows.tsx` already has for
  `lib/draftState` (`tools/arch/boundaries.test.ts` documents it); if reviewers prefer, take
  `persistKey` handling through a tiny `lib/` helper instead.
- CSS: reuse `.section-header[data-level]` for the summary (the primitive already emits the shared
  class); add `.ui-fold` for the details/marker styling — hide the UA marker, draw the twist from
  tokens (`--marker-w`), rotate on `[open]`.
- `actions` must `stopPropagation` on the summary so a CopyButton in the header (github does this
  at `PullDetail.tsx:234`) doesn't toggle the fold.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- github PullDetail's eight sections + PullSummary's one — delete `rememberOpen`, pass
  `persistKey`. This is the flagship migration; do it first and the component is proven.
- docker's group headers (they're also rows — pair with [tree-row.md](./tree-row.md); pick per
  site), github's checks steps (gains `aria-expanded`).
- context's two expander markups; notes' "+ memory" toggle (gains `aria-expanded` and a label that
  reflects state); `NodeDevices`' toggle.
- agents' event-card folds can stay raw `<details>` — they're content folds inside a card, not
  titled sections; migrating them would add noise. Note this in the component doc.

## Notes

- Accordion behaviour (only one open) has zero current consumers — skip it.
