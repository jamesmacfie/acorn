# Phase 2: a Link node, for clickable text inside a sentence

Status: not started. Waits on nothing.

## Goal

The kit has a word for a clickable run of text inside flowing prose, and the github pull overview
uses it. The last raw anchor written by a compiled pane is gone.

## Why this phase, and why now

`plugins/github/src/client/pullDetail/PrOverview.tsx` splits a pull title into ref tokens and renders
each resolved token as `<a class={REF_LINK_CLASS}>` with a click handler — the "Solid-rendered twin"
of `linkifyRefs`, which mints the same anchors imperatively over provider-supplied HTML
(`packages/client-core/src/host/registries/panes/contentLinks.ts`). The declarative twin writes a
raw element because the kit gives it nothing: `Button` with `href` renders a real anchor but is a
control with button geometry, wrong on a text baseline inside a `Heading`; `Text` is presentational
and deliberately has no press handler; `Chip` is a boxed token, not words in a sentence. The owner's
decision (README § Decisions taken) is a dedicated node rather than a pressable `Text`, because the
kit is one intent per node and "this text acts" is a different intent from "this text is dim".

## Scope

In:

- A `Link` kit node: children (text), `onPress`, optional `href` for the genuine-navigation case
  (renders a real anchor with real link semantics — middle-click, copy — where given; the ref-token
  case has no URL and gives none). Accent-toned, underline on hover on the DOM host; underlined or
  reverse-video, pressable, on the terminal. Support row `tui: 'full'`.
- The support matrix, the 80 by 24 table, the DOM host component table, and the tree protocol node
  list, same paperwork as phase 1.
- `PrOverview.tsx` migrates: `RefText`'s anchor becomes `Link onPress`, and the file's import of
  `REF_LINK_CLASS` goes.

Out: `linkifyRefs` and the imperative anchors it mints. Provider HTML is set through `innerHTML`
inside surfaces that are rectangle territory on a terminal, so those anchors never reach a host that
cannot draw them; the constant and the stylesheet rules stay for that path. Also out: restyling —
`Link` on the DOM host wears the same three declarations the class wears today, moved into the kit's
own stylesheet.

## Design detail

**One Solid call site is enough, and here is why the admission holds.** The kit's bar is that a node
speaks for more than one caller. The second caller is latent but structural: every pane that renders
provider text with resolvable refs wants exactly this, and today they either go through `linkifyRefs`
(imperative, rectangle-bound) or cannot do it at all. Adding the node is what lets future panes
choose the declarative path; refusing it preserves a raw-DOM ritual. The 80 by 24 sentence is
one line: "the text, underlined, pressable."

**What `Link` is not.** Not a `Button` variant — no padding, no border, no toolbar membership. Not
a router primitive — it does not know about routes; a caller that navigates passes the navigation in
`onPress` like every other handler in the kit.

## Code touched

- `packages/client-core/src/kit/components/content/Text.tsx`'s folder gains the node (a sibling
  file, `Link.tsx` (new))
- `packages/client-core/src/kit/tokens/support.ts`, `packages/client-core/src/host/tree/components.ts`,
  the tree protocol node list under `packages/protocol/src/tree/`
- `plugins/github/src/client/pullDetail/PrOverview.tsx`
- The kit stylesheet, taking over the `ref-inline-link` declarations from
  `packages/client-core/src/infra/styles/integrations.css` for the node (the class itself stays for
  `linkifyRefs`)

## Tests

- `kitTable.test.ts` and the support tests pass with the new row.
- A jsdom test on the pull overview: a title with a ref token renders a pressable link that calls
  the open handler with the item id.

## Docs owed

- `docs/ui-design.md` § Every node at 80 by 24: the `Link` row.
- A sentence in `docs/plugins.md` § The tree contract only if it enumerates node names.
- See [docs-migration.md](./docs-migration.md).

## Doors left open

1. `Link` learning `data-ref` semantics so `linkifyRefs` output and kit output converge on one code
   path, if a second declarative caller appears.
2. External URLs: a `Link` with `href` opening through the system opener on the terminal, which is
   the same behaviour the rectangle placeholder already promises.

## Done when

- `PrOverview.tsx` contains no raw anchor and no `REF_LINK_CLASS` import.
- The link renders on the text baseline inside the `Heading` as before, and clicking a ref opens the
  Linear issue.
- `pnpm lint` and the affected tests are green.

## Verify before building

- `PrOverview.tsx` still renders `<a class={REF_LINK_CLASS}>` in a local `RefText` component and is
  still the only compiled pane doing so (grep `REF_LINK_CLASS` across `plugins/`).
- `REF_LINK_CLASS` is still defined in `contentLinks.ts` and re-exported through
  `packages/plugin-api/src/client.ts`; the CSS is still the three declarations in
  `integrations.css`.
- The kit still has no node named `Link` or `Anchor` in `support.ts`.
