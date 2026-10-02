# Workstream 7: write-back

Status: proposed and gated, 2026-10-02, revised the same day. Depends on
[workstream 4](./04-row-actions-and-navigation.md)'s named actions and on the gate below. This replaces
the August `write-back.md`, which git history keeps.

## Goal

Dragging a board card into another column changes the item's value at the provider, with the host's
confirmation where the change is risky, and with a visible refusal where no change is defined.

## Milestones

None. This workstream starts only when its gate is met.

## The gate

Write-back waits for real use of read-only boards, so the mutation contract is designed against boards
people actually keep rather than imagined ones. Workstream 4 helps meet the gate honestly. Named record
actions let a board card offer buttons such as **Move to In progress**, run on the Node, which shows
whether people want to change items from a panel at all without any drag gesture or new contract.
Record how often those buttons are used before starting this workstream.

## What changed since August

The August design relied on a reserved `writeValue` per mapping column that the saved format
round-tripped unread. Workflow v2 replaced that format, and the published panel format has no such
field. Only the old internal type in `packages/dashboards-core/src/model.ts` still declares it. The
storage seam therefore doesn't exist and is part of this workstream's work.

Workflows refuse a generic provider write-back contract ([workflows](../../workflows.md)). This
workstream doesn't add one. Each write is a field mutation that the owning source declares, run through
that source's own plugin route.

## Requirements

1. On an enum column, each choice may name a write value per source: the provider value set when a
   card from that source is dropped on that choice. Value maps are many-to-one, so a drop has no
   answer without it.
2. Sources may declare writable fields: the field, the route that performs the change, and a risk tier.
   The route is confined to the plugin's own route space.
3. A drop goes through workstream 4's `act` operation on the Node, with the record reference, the
   field, and the target value. The Node reads the record's current value and the field's current
   writability, checks the account again, and refuses if the record has already moved or the change no
   longer applies.
4. Risky writes show the host's confirmation strip when the card is dropped, before anything is sent.
   Cancelling returns the card and sends nothing.
5. Each drop carries an idempotency key, so a retried request can't apply the change twice.
6. A card can drop on a choice only when that choice has a write value for the card's source and the
   source declares the field writable. Otherwise the column refuses with the reason as text, such as
   "No write value for GitHub here", never as a bare no-drop cursor.
7. After the person confirms, or immediately for a non-risky write, the card moves, the change is
   sent, and the run refreshes. A failure or a refusal names the source and the reason and returns the
   card.
8. Panel drag keeps claiming only the panel header, so a press inside a board stays free for card drag.
   The two gestures must never be ambiguous.
9. Every drop has a keyboard equivalent through workstream 4's row menu.
10. The editor's column stage offers "When dropped here, set" per choice and source, listing that
    source's writable values. The describer and the AI's requirements list cover write values.

## Done when

On a board with write values configured, dragging a card asks first where the change is risky, sends
nothing if cancelled, moves at once once confirmed, and on failure names the source and returns the
card. Dropping a card that someone else already moved is refused with that reason. A card with no write
value for the target column visibly refuses the drop. The same move works from the keyboard.

## Docs to update

- [Dashboards](../../dashboards.md): write values, drag, confirmation, and refusal.
- [Typed data sources](../../data-sources.md): writable field declarations.
- [Security](../../security.md): writes resolved on the Node, confinement, confirmation, and
  idempotency.
- [Workflows](../../workflows.md): the note that dashboard write-back is a declared field mutation, not
  a generic contract.

## Verify before building

- The gate: usage of read-only boards and of workstream 4's move buttons, with numbers.
- That the panel grid's header-only drag rule still holds and that `BoardView.tsx` has no pointer
  handling of its own.
- The `act` operation's checks and idempotency keys from workstream 4, so this workstream reuses them
  unchanged.
