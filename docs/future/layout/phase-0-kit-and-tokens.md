# Phase 0: the closed kit and role tokens

Status: shipped 2026-08-29. Deviations from what is written below are listed at the end.

## Goal

Turn `packages/client-core/src/ui/` from a set of Solid primitives with `class` passthrough into a
closed kit: a fixed node set, semantic props only, a support matrix with a terminal column, and tests
that hold all three. Nothing outside the kit changes in this phase; every current consumer keeps
compiling, because the props being removed are the ones consumers should not have been using.

## Why this phase, and why first

The kit is the vocabulary every later phase is written in. Layouts are made of kit nodes, remote
trees serialise kit nodes, focus roles hang off kit nodes, and the terminal door stays open only if
every node has an 80×24 sentence from the day it exists. Doing this first also gives the per-pane
phases a compiler: once `class` is gone from `ButtonProps`, every plugin that was styling a button
fails to build, and that list is the work.

## Scope

In:

- Freeze the node set in [04-kit.md](./04-kit.md). Add the nine gap nodes: `Stack`, `Inline`,
  `Heading`, `Section`, `Fold`, `Timeline`, `Facts`, `ChipRow`, `Log`, `Grid`.
- Role token enums as exported constants and types on `@acorn/plugin-api/ui/tokens`.
- `NODE_SUPPORT` in `ui/kit/support.ts` with `dom` and `tui` columns.
- Remove `class`, `className`, and `style` from every kit node's props. Remove
  `ComponentProps<'button'>`-style spreads; each node declares its own props.
- `Only` and `Fallback` wrappers.
- Move existing kit CSS (`styles/primitives.css`, `tips.css`, the component-local styles) to read
  role tokens through the existing custom properties. No visual change is the target.
- Tests listed below.

Out: layouts (phase 1), focus behaviour on nodes (phase 2), any plugin change beyond what the type
errors force. Where a plugin passes `class` today, the phase-0 fix is the smallest thing that
compiles (drop the class, or wrap in a raw `div` that phase 5 to 8 will remove); the survey's raw-tag
count may go up in this phase and that is expected.

## Design detail

**Node props.** Each node exports its own `Props` type built only from role enums, strings for
content, booleans, numbers where a count is meant (`Meter.value`, `Tabs` count), and handler names
from the kit's event set. `ButtonProps` becomes:

```ts
export type ButtonProps = {
  label?: string
  tone?: Tone
  variant?: 'solid' | 'outline' | 'ghost'
  size?: Size
  icon?: string
  busy?: boolean
  disabled?: boolean
  href?: string           // a control that navigates is a link; keeps today's rule
  onPress?: () => void
  children?: JSX.Element
}
```

`iconOnly` is derived from `label` being absent. `target` and `rel` are set by the host from `href`.

**Role enums.** As in 04-kit.md: `space`, `size`, `tone`, `text`, `border`, `radius`. The DOM
mapping is a table from role to the custom properties already declared in `ui/tokenAxes.ts` and
`styles/tokens-style.css`; it lives in `ui/kit/roles.ts` and is the only file that names a CSS
variable outside a stylesheet.

**Support matrix.** `ui/kit/support.ts`, `as const satisfies Record<KitNode, Record<Host,
SupportLevel>>`. `Host` is `'dom' | 'tui'` from day one; only `dom` is read.

**The nine new nodes.** Implemented as Solid components in `ui/` beside the existing ones, styled
through role tokens, each with a jsdom test in the `hosts` vitest project. `Fold` replaces
`CollapsibleSection` (keep the old name as an alias until phase 9). `Facts` is `DescriptionList`
with `layout="facts"`, named. `Grid` wraps the virtualiser from `@acorn/plugin-api/ui/diff` and takes
over from the database plugin's `ResultGrid` in phase 5.

**Where classnames go.** Inward. Kit components keep their `ui-*` classes internally. Nothing exported
accepts one. `cx.ts` becomes internal.

## Code touched

- `packages/client-core/src/ui/primitives.tsx`: every `class?: string`, every
  `ComponentProps<...>` spread, `controlAttrs`' class merging.
- `packages/client-core/src/ui/*.tsx`: the component files (`Modal`, `Menu`, `Tabs`, `Picker`,
  `Drawer`, `DocumentTabs`, `FindBar`, `KeyValueEditor`, `Markdown`, `CopyButton`, `RowActions`,
  `UserAvatar`, `IconPicker`, `WorkspacePicker`, `MentionTextarea`, `Composer`).
- `packages/client-core/src/ui/tokenAxes.ts`, `styles/tokens-style.css`,
  `styles/tokens-theme.css`, `styles/primitives.css`: read by the role mapping; no token is added.
- New: `ui/kit/support.ts`, `ui/kit/roles.ts`, `ui/kit/tokens.ts`, `ui/Stack.tsx`, `ui/Inline.tsx`,
  `ui/Heading.tsx`, `ui/Section.tsx`, `ui/Fold.tsx`, `ui/Timeline.tsx`, `ui/Facts.tsx`,
  `ui/ChipRow.tsx`, `ui/Log.tsx`, `ui/Grid.tsx`, `ui/Only.tsx`, `ui/Fallback.tsx`.
- `packages/plugin-api/src/ui/*` barrels: export the new nodes and `tokens`; the surface snapshot
  test (`packages/plugin-api/src/surface.snapshot.txt`) is updated deliberately.
- Every call site in `plugins/*/src` and `packages/client-core/src` that passes `class` or `style`
  to a kit node: the compiler lists them.

## Tests

- `ui/kit/support.test.ts`: every exported node has a row; every row names a node; every row has a
  `tui` entry.
- `ui/kit/roles.test.ts`: every role in every enum has a DOM value and a terminal value (`ignored`
  allowed, missing not); every DOM value is a custom property declared in `tokenAxes.ts`.
- `ui/kit/props.test-d.ts`: a type-level test that no exported node props type accepts `class`,
  `className`, or `style`, and that role-typed props reject an arbitrary string.
- `ui/adoption.test.ts`: keep as is this phase; it inverts in phase 9.
- `styles/tokenAxes.test.ts` stays green; no token is added or moved.
- jsdom tests for the nine new nodes in the `hosts` project.

## Docs owed

- `docs/ui-design.md` § "Primitive adoption ratchet", § "How the primitives are built", § "Migration
  tiers and their two invariant tests" become one section, "The closed kit," describing role tokens,
  the support matrix, and the no-class rule. § "Token axes" gains the role mapping table.
- `docs/architecture-overview.md` § "Documentation map" gains this folder.
- `docs/testing.md` § "Test layers" gains the three kit invariants.

## Doors left open

- The `tui` column and the terminal value per role exist and are tested for presence.
- `Only` and `Fallback` exist so a plugin can be written against a second host now.
- No node takes a pixel, a colour, or a class.

## Done when

- `pnpm lint` and `pnpm test` are green.
- The desktop app renders every pane as it did, verified against the `docs/testing.md` smoke
  checklist; visual drift is limited to spacing that was previously set by a plugin class.
- `grep -rn "class=" plugins/*/src --include=*.tsx | grep -v 'class="' ` finds no kit node receiving a
  class (raw `div`s may still carry one until phases 5 to 8).
- The three kit invariant tests exist and pass.

## Verify before building

- `packages/client-core/src/ui/primitives.tsx` still holds `ButtonProps` with `ComponentProps<'button'>`
  and `class?: string` at the lines the survey saw (around 14 and 34).
- `packages/client-core/src/ui/tokenAxes.ts` and `styles/tokenAxes.test.ts` exist and the test
  passes on `main`.
- `packages/plugin-api/src/surface.test.ts` snapshots the `/ui` barrel; confirm how a deliberate
  surface change is recorded.
- The jsdom `hosts` vitest project in `packages/client-core/vitest.config.ts` exists and can render a
  component (the memory index says it renders the seven contribution hosts).
- Re-run the raw-tag survey command from [02-survey.md](./02-survey.md) to get current counts.

## What shipped, and where it differs

The kit is closed. `ui/kit/tokens.ts`, `ui/kit/roles.ts` and `ui/kit/support.ts` hold the role enums,
the two host mappings, and the support matrix; the ten nodes are in `ui/`; `Only` and `Fallback` sit
beside them; and no exported node accepts `class`, `className`, `style`, or `classList`. Behaviour
now lives in [ui design](../../ui-design.md) § The closed kit.

Nine deviations, each taken deliberately:

1. **`Button` keeps `iconOnly` and the `bare` variant.** The sketch above derives `iconOnly` from an
   absent label and lists three variants. Both would have cost real affordances: 64 call sites say
   `iconOnly` while still passing a glyph as a child, and `bare` is the borderless button the whole
   app uses inside rows and strips. `label` is the accessible name, and doubles as the visible text
   when the button has no children.
2. **`onPress` replaced `onClick` and `onActivate`, but the text controls keep their own handlers.**
   `Input`, `Textarea` and `Composer` take `onKeyDown`, `onPaste`, `onDrop` and the rest, because
   [doors left open](./09-doors-left-open.md) puts exactly those three nodes on the other side of the
   no-key-events rule. Everything else hears an intent.
3. **`Select` takes `options`, not `<option>` children.** A plugin writing raw tags into a control is
   what the closed kit is for. The hidden native `<select>` stays as the value store and the form
   participant, so the popup is still the only part the kit draws.
4. **`Section` has no `collapsed`.** A section that opens and closes is a `Fold`. Two components with
   the same job is what the kit exists to stop.
5. **`Facts` takes `items` with JSX values.** The sketch says `[[label, value]]`. A fact's value is
   often a `Badge` or a `StatusDot`; its label is always a string.
6. **`StatusDot` gained `mixed` as a flag.** `mixed` is two states at once, not a seventh tone, so it
   sits beside `tone` rather than inside the enum.
7. **The tone vocabularies converged on the role enum.** `bad` became `danger`, `add` became `ok`,
   `del` became `danger`, `success` became `ok`, `info` became `muted`. Two vocabularies stayed
   because they are not the kit's: a collection's enum tone is a wire value and still says `bad`, and
   a rail marker dot still says `bad` and `mixed`. `railDotProps` on
   `@acorn/plugin-api/client` is the one translation between them.
8. **`Row` takes `offset` and `height` in pixels.** A virtualizer computes both and no stylesheet
   can. It is the one place a node turns a number into a length, and it takes numbers rather than a
   style object.
9. **`adoption.test.ts` lost one check rather than keeping all of them.** The invariant that every
   primitive appends the caller's class cannot survive the removal of the class; `props.test-d.ts`
   is what holds that ground now. The rest of the ledger stays until phase 9.

Two things the phase says it wants that this change did not do:

- **Per-plugin restyling of kit nodes is gone, not ported.** 282 selectors across 36 stylesheets
  styled a kit node through a class a plugin handed it, and dropping the class left them matching
  nothing. They were deleted rather than re-pointed, except where a rule set a pane's structure: the
  Agent Center list, the session sidebar, and the kit's own internals now reach their targets by
  position. So a number of buttons, chips, alerts and toolbars wear the kit's own padding and weight
  instead of a plugin's. That is the drift phases 5 to 8 were always going to produce; it arrives
  here instead.
- **The smoke checklist has not been run.** `pnpm lint` and `pnpm test` are green, and the
  eyes-on pass in [testing](../../testing.md) is still owed.
