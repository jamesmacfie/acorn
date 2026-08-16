# Board-drag write-back

**Unbuilt and gated** — the precondition is on record in `refused.md`: revisit when read-only boards
have real usage, so the mutation contract is designed against observed boards rather than imagined
ones. This file exists so that pickup does not start from zero.

The ungated half of this work — **a risk tier on the row action, with the host rendering the
confirmation** — **shipped on 2026-08-16**. A row action may declare `read` | `write` | `execute`
(the `ToolRisk` vocabulary verbatim); anything above `read` is armed and the host draws the
confirmation strip. Three properties of it are load-bearing here and must not be re-litigated when
the mutation contract is designed:

- the tier is an **additive optional field** on the versioned Zod schema, so an action without one
  behaves exactly as it always did;
- **the host draws the confirmation**, never the plugin — a plugin that could draw its own dialog
  could draw a reassuring one over a destructive call;
- it is not a new verb. `runNodeAction` already existed; only how dangerous one is became declarable.

That confirmation is available to the write below wherever a write is declared risky.

## The gated part

Dragging a card between board columns means mutating the underlying field on the provider.

**Why it is hard, carried forward**: value mappings are many-to-one and therefore not invertible.
GitHub's `merged` and `closed` may both land in the user's `Done` column, so dropping a card on
`Done` has no unique answer. The decided design:

- **A designated `writeValue` per (source, column)** in the mapping config. The persisted shape
  already reserves it: `PanelMappingColumn` carries a `writeValue` that the codec round-trips
  unread (`persist.ts`) — shipped precisely so this feature is a change to behaviour, not to
  storage. The editor's mapping matrix grows an optional "when dropped here, set …" per
  (source, column), offering that source's declared enum values.
- **Drag is disabled wherever no `writeValue` is set**, per card per target column: a card whose
  source has no write value for the column it is over cannot drop there, with a visible reason —
  never a silent no-op, never a guess.
- **The mutation contract is the real design work, and it is a wire change** — the only item in
  this backlog allowed to touch the node↔client contract, and it is a protocol version event. A
  collection field must be able to declare that it is writable and how — the likely shape is a
  declared per-field mutation route with the same route-space confinement as `items`, dispatched
  under the user's identity through the plugin's own connection, with the shipped risk tier's
  confirmation semantics available where the write is risky. It is deliberately not designed further here:
  design it against observed boards.
- **Optimistic update and failure surfacing are host machinery**, no wire involvement: apply the
  move locally, refetch the source, and surface failure through the existing per-source banner
  idiom (partial availability is data — the same rule the panel already lives by).

**Done when**: on a board with write values configured, dragging a card to a column issues the
declared mutation, confirms first where declared risky, moves optimistically, and on failure names
the source and restores the card; a card with no write value for the target column visibly refuses
the drop.

## Interaction boundary with the panel grid

Panel drag **shipped**, and it deliberately claims **only the panel header** as its drag surface
(`docs/dashboards.md § The grid`) precisely so a press inside a board body stays free for card drag.
That is the room this feature has to move in, and it is not incidental — keep it that way. The two
gestures must never be ambiguous, and the panel-drag design depends on the body being gesture-free.

## Verify before building

- `persist.ts` — `writeValue` still round-trips unread; the mapping matrix editor's current shape.
- `refused.md § No write-back in v1` — confirm the precondition (real usage) is met, and record
  what was observed.
- The shipped row-action risk tier (`@acorn/protocol/collections.ts`, and the confirmation strip in
  `dashboards/Panel.tsx`) — the confirmation semantics to reuse rather than re-invent.
- That the panel grid's header-only drag rule still holds, and that `BoardView` has not grown any
  pointer handling of its own in the meantime.
