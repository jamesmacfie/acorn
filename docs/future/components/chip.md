# Chip

A compact interactive tag: removable ("×"), clickable, or colour-driven by data. The existing
`Badge` is deliberately static — a display token. The codebase keeps needing the interactive
sibling and building it by hand. shadcn approximates this with Badge + Button composition;
Bootstrap with dismissible badges. The `Badge dashed` prop was literally added for one of these
(`primitives.tsx:88` documents it was built for the Database example-picker's add-chip) and the
plugin still hand-rolls the chip.

## Today

Removable chips (label + × button):

- agents: `.agent-attachment-chip`, `.agent-context-chip` + `.agent-chip-remove`
  (`AgentComposer.tsx:350-385`, `managed-agents.css:294-324`)
- database: `.db-chip` + `.db-chip-x`, plus dashed `.db-chip-add` (`GenerateSqlModal.tsx:92-103`,
  `database.css:326-336`)
- github: `.label-row` with hover-revealed `.label-row-remove` (`PullDetail.tsx:302`,
  `pull-detail.css:199-242`)

Clickable chips (chip as button):

- github: `.branch-chip` with hover-revealed copy (`PullSummary.tsx:55-61`), `.identity-chip`
  (`:52`); docker: `.docker-port-chip` (opens a port — `ContainerDetail.tsx:256-264`),
  `.docker-chip` (`DockerTaskPane.tsx:40`)

Colour-driven state pills (background from data, not from a tone enum):

- linear frame: `.ln-state` / `.ln-label-chip` with `--state-color`/`--label-color` inline vars
  (`LinearIssueView.tsx:69,137,143`)
- github renders the same Linear data shell-side as `.integration-row-state` with the same
  `--state-color` trick (`PullDetail.tsx:279`) — two implementations of one visual
- onboarding: `.wizard-added-name` (`wizard.css:131-148`); http: `.http-method-chip[data-method]`
  with per-verb colours (`http.css:92-104`); docker: `.docker-stale-chip`; notes:
  `.notes-scope-pill`; context: `.context-origin-badge`, `.context-stale-pill`; memory:
  `.context-tray-kind`; github: `.state-badge`, `.pr-badge`

## Proposed API

```tsx
export function Chip(props: {
  tone?: BadgeTone                   // Badge's enum, same tokens
  color?: string                     // arbitrary provider colour → sets --chip-color;
                                     // renders the ::before dot + tinted border like .ln-state
  onRemove?: () => void              // trailing ×; hover-reveal via data attr, packs decide
  onActivate?: () => void            // whole chip clickable (renders a <button>)
  leading?: JSX.Element              // Icon / StatusDot
  size?: 'xs' | 'sm'
  dashed?: boolean                   // the add-chip affordance
  class?: string
  children: JSX.Element
})
```

Element switches on interactivity: `onActivate` → `<button>`, otherwise `<span>` (with the ×
being its own small button). `color` sanitises to a CSS color value before hitting a style attr.

## How to build it

- `packages/client-core/src/ui/primitives.tsx`, `.ui-chip` in `styles/primitives.css`
  (frame-served — linear/http/database frames are primary consumers). Radius via `--radius-chip`
  (already exists — wizard uses it), padding `--pad-chip`.
- Share the tone tokens with `.ui-badge` so Badge and Chip are visibly one family; `data-dashed`
  reuses Badge's dashed rule.
- The hover-reveal of `onRemove` should be a `data-reveal` behaviour on the chip
  (`:hover/:focus-within` → visible), matching the pattern used by rows — see the Row extensions
  in the [README](./README.md).
- Export from `@acorn/plugin-api/ui`.

## Refactors

- Frames first (they gain the most, having no shared CSS): linear's `.ln-state`/`.ln-label-chip`,
  http's method chip (a `tone` map per verb, or `color`), database's three chip classes (and
  finally use the dashed style built for it).
- agents' two composer chips; docker's three; github's label rows (`onRemove`), branch chip
  (`onActivate` + CopyButton composition), state/draft badges (plain `Badge` is enough for those
  two — migrate to Badge, not Chip).
- memory/context/notes pill spans → `Badge` or `Chip` per interactivity.
- Delete `.integration-row-state`'s bespoke rule once github's shell-side Linear pill uses
  `Chip color`.

## Notes

- Rule of thumb for call sites: static label → `Badge`; interactive or data-coloured → `Chip`.
  Write that sentence into the component JSDoc; the survey shows the distinction is the thing
  people keep re-deciding.
