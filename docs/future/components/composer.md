# Composer

A comment/reply box: textarea, action row, inline error, busy state. GitHub-style apps grow these
everywhere; shadcn/Bootstrap have no equivalent (it's a composite), but acorn has **four
near-identical hand-rolled instances across two plugins** plus the agent composer as the maximal
case.

## Today

- github: `.composer` ×2 — review-comment composer (`PullDetail.tsx:401-412`) and conversation
  composer (`:453-473`), both `MentionTextarea` + buttons styled by a descendant
  `.composer button` rule (`pull-detail.css` — bypassing `Button`)
- linear frame: `.ln-composer` + `.ln-composer-actions` ×2 — comment and reply
  (`LinearIssueView.tsx:94-107,262-274`), `Textarea` + inline error + Button pair
- diff line composer: the shared diff toolkit already models this as `LineComposerController`
  (`@acorn/plugin-api/ui` exports the type) — chrome is per-consumer
- agents' `AgentComposer` (491 lines) is the *maximal* composer — config row, chips, mention
  autocomplete, context pickers; it should NOT collapse into this component, but its skeleton
  (textarea + actions + error + kbd hint) is the same anatomy

## Proposed API

```tsx
export function Composer(props: {
  value: string
  onInput: (v: string) => void
  onSubmit: () => void                  // also ⌘↵ / Ctrl↵
  busy?: boolean
  error?: string
  placeholder?: string
  submitLabel?: string                  // default "Comment"
  secondary?: JSX.Element               // Cancel button, "resolve" checkbox, etc.
  mentions?: MentionSource              // when set, renders MentionTextarea instead of Textarea
  hint?: JSX.Element                    // "⇧⏎ for newline" — a Kbd fragment
  class?: string
})
```

## How to build it

- A composite above the primitives: `packages/client-core/src/ui/Composer.tsx`, composed from
  `Textarea`/`MentionTextarea`, `Button` (submit gets `busy`), `Field`-style error line, and
  [Toolbar](./toolbar.md) `variant="actions"`.
- `.ui-composer` in `styles/primitives.css` (frame-served — linear is a frame consumer).
- The ⌘↵ submit chord is implemented once here; github currently documents it only in a
  placeholder string (`CreatePullForm.tsx:142`).
- Frame caveat: `MentionTextarea`'s data sources are host-side; in frames `mentions` stays unset
  and a plain `Textarea` renders — the prop split makes that legible.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- github's two `.composer` blocks (also deletes the `.composer button` descendant styling —
  their buttons become real `Button`s), linear's two `.ln-composer` blocks.
- github's create-PR form keeps `CreatePullForm` (it's a form, not a composer) but can share the
  chord + hint pieces.
- agents' composer: no migration; add a code comment pointing here so future simplification has a
  target.

## Notes

- Four consumers, all mechanical ports, minus ~60 lines of duplicated markup and two descendant
  button rules — mid-tier value, ship after the primitives it composes exist (Toolbar, Kbd).
