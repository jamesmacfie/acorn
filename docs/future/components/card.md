# Card

A bordered surface grouping related content, optionally selectable/clickable. shadcn's Card and
Bootstrap's Cards are their most-used layout components. acorn repeats the recipe
`border: var(--surface-border); border-radius: var(--radius-surface); background: var(--card-bg)`
in at least **ten separate rules**, three of them in one stylesheet.

## Today

- onboarding: `.wizard-card` (selectable choice card with title/desc/tag — `wizard.css:76-98`),
  `.wizard-project` (form surface — `:151-160`), `.wizard-device` (code/credential block —
  `:108-116`) — three cards in one file
- core: `.fleet-card` (`nodes.css:198`), `.integration-card` (`integrations.css:113`),
  `.node-row`/`.node-step`/`.node-alarm` (`nodes.css:54,143,104`), `.ws-group` (subgrid card,
  `onboarding.css:41`)
- agents: `.agent-request-card` (warn left-stripe — `managed-agents.css:102-135`),
  `.managed-agent-provider-card`, `.agent-center-provider` — three card shapes, three stylesheets
- github: `.comment-card` (+ absolute CopyButton — `Conversation.tsx:53`), `.file-thread-card`
  (~90 lines of CSS for one composite card — `pull-detail.css:331-434`); both use the left accent
  stripe `border-left: var(--stripe-w) solid …`
- changes: `.review-note` (warn left-stripe — `changes.css:81-103`)

Recurring aspects: plain surface / interactive-selectable / tone stripe on the left edge.

## Proposed API

```tsx
export function Card(props: {
  interactive?: boolean          // renders <button>, hover + :disabled states (wizard-card)
  selected?: boolean
  stripe?: 'accent' | 'warn' | 'danger'   // the left edge marker
  pad?: 'sm' | 'md'
  class?: string
  children: JSX.Element
})
```

No mandated Header/Body/Footer sub-components — acorn's cards are small and dense; slots would
mostly get in the way. The one structured need (title + desc + tag on the wizard card) is fine as
children.

## How to build it

- `packages/client-core/src/ui/primitives.tsx`; `.ui-card` in `styles/primitives.css`
  (frame-served). Tokens: `--surface-border`, `--radius-surface`, `--card-bg`, `--stripe-w`;
  `data-interactive`, `data-selected`, `data-stripe`, `data-pad`.
- The stripe uses the same `--stripe-w` marker the diff/comment cards already use, so packs that
  zero the stripe width (Terminal pack borders philosophy — see the border-role memory in the
  repo docs) degrade consistently.
- This is where style packs win big: Modern's rounded inset cards vs Terminal's flat squares is a
  single selector per pack instead of ten.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- onboarding's three card rules (`wizard-card` → `interactive`, keep its inner spans as local
  classes); the card *grid* (`.wizard-cards`) stays local layout.
- agents' request card (`stripe="warn"`), provider cards (`interactive`).
- github's comment card and changes' review note (`stripe`), leaving their inner composite
  structure alone — the Card is the shell, not the contents.
- core's fleet/integration/node cards as those files are touched.
- The `.gallery-*` blocks in StyleGallery should showcase Card once it exists.

## Notes

- Don't force `Row` content into Cards: `Row`'s doc note (style packs may render rows AS cards —
  Modern's inset rounded row) means Card and Row must share surface tokens but stay distinct
  components with distinct semantics (grouping vs list item).
