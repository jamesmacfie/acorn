# Phase 0: the agents plugin drops the raw DOM it never needed

Status: shipped 2026-08-31.

## Goal

The context picker and the two form-wrapped settings pages in `plugins/agents/src/client` write only
kit nodes. After this phase the plugin's remaining raw DOM is exactly the three sites later phases
own: the pricing tables (phase 1), the hidden file input, and the download anchors (phase 3).

## Why this phase, and why now

These are the offences with a kit replacement already on the shelf: `Text` exists so a plugin can
say "this line is dim" without a raw element, `Checkbox` already has a `hint` prop, and the
kit-idiomatic submit pattern is sitting in the same directory in
`plugins/agents/src/client/settings/AgentSessionDefaultsSettings.tsx`. An afternoon of work removes
four of the seven files from the phase-7 baseline, and doing it first means every later phase diffs
against a plugin that is otherwise clean.

## Scope

In:

- `plugins/agents/src/client/composer/AgentContextPickerModal.tsx`: the three `<p class="muted">`
  become `Text emphasis="muted" wrap`. The `agent-context-option-empty` class is deleted outright —
  no stylesheet in the repo defines it. The `<strong>`/`<small>` pair inside the `Checkbox` label
  becomes `label={option.label} hint={option.description}`, and the `Show` around the description
  goes with it.
- `plugins/agents/src/client/settings/AgentConcurrencySettings.tsx` and
  `plugins/agents/src/client/settings/AgentPricingSettings.tsx`: the `<form onSubmit>` wrappers go.
  The submit `Button` loses its `submit` prop and gains `onPress={() => void submit()}`; the
  handlers lose their `Event` parameter, which existed only to call `preventDefault()`.

Out: the pricing page's two raw `<table>` bodies, which wait on phase 1's kit nodes — this phase
leaves the tables in place inside a page that no longer has a `<form>` around them. Also out: any
redesign toward save-on-change. Both pages keep their explicit dirty-and-save affordance; whether
they should work like the defaults page is a product question this folder does not answer.

## Design detail

**What dropping the `<form>` costs, stated so nobody rediscovers it.** Two things. Enter inside a
field no longer submits — no kit node provides that for a `Field`/`Input` group today, and this
phase accepts button-only submit rather than growing the kit for it (a door below). And the
browser's native constraint pass (`required`, `min`, `max` on the pricing inputs) no longer runs
before submit — which loses nothing real, because both pages already run the same validation in
code: the concurrency page calls the same validator the route runs, and the pricing page's draft
parser returns structured errors. The inputs keep their constraint attributes for the affordance;
the code path stops relying on them.

**The template.** `AgentSessionDefaultsSettings.tsx` is the shape to match where a choice is
ambiguous: kit nodes only, errors in an `Alert`, no wrapper element.

## Code touched

- `plugins/agents/src/client/composer/AgentContextPickerModal.tsx`
- `plugins/agents/src/client/settings/AgentConcurrencySettings.tsx`
- `plugins/agents/src/client/settings/AgentPricingSettings.tsx`

## Tests

- The plugin's existing jsdom tests for these regions still pass (the plugin `.test.tsx` tier
  renders through `@acorn/plugin-api/testkit/client`).
- A settings-page test submits via the button and asserts the save call, so the Enter-to-submit
  removal is a recorded behaviour change rather than an accident.

## Docs owed

None; no contract changes. [docs-migration.md](./docs-migration.md) has no rows for this phase.

## Doors left open

1. Enter-to-submit as a kit affordance — an `onSubmit` on `Input`, or a form-shaped node. Refused
   for now in [refused.md](./refused.md); if a third settings page wants it, that is the admission
   argument.
2. Save-on-change for the concurrency and pricing pages, deleting the submit question entirely.

## Done when

- A scan of the three files finds no raw element, no `class=`, no `style=`.
- The context picker renders identically by eye: muted description, checkbox rows with hints.
- Both settings pages save via their button and surface validation errors as before.
- `pnpm lint` and the agents plugin's tests are green.

## Verify before building

- `AgentContextPickerModal.tsx` still has the three `<p>`s and the `<strong>`/`<small>` label; the
  `Checkbox` in `packages/client-core/src/kit/components/primitives.tsx` still has `label` and
  `hint` props.
- The two settings files still wrap in `<form>` and submit through a `Button` with the `submit`
  prop; their handlers still take the event only for `preventDefault()`.
- `AgentSessionDefaultsSettings.tsx` is still kit-pure, so the template holds.
- No stylesheet defines `agent-context-option-empty` (grep the repo's `.css` files).
