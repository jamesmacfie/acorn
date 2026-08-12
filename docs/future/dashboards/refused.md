# What is refused, on the record

Design notes from the dashboards session (2026-08-12). Nothing here is scheduled. Each refusal
carries its reasoning and what would have to change to revisit it — so a future session argues
with the reasoning, not with silence.

## No plugin-shipped panel components, no widget toolkit in the wire format

The master/detail refusal (`docs/plugins.md:283-288`) holds: the host will not render a plugin's
bespoke UI from data, because that means eternally versioning a widget toolkit in the wire format.
Dashboards clear the bar only because the host renders *its own* generic views over a record
schema (`README.md § The tension`). When a plugin needs UI the field-type vocabulary can't
express, the overflow path is a **frame pane** — the escape hatch is planned, not fought
(`prior-art.md`, the VS Code lesson). Revisit only if the descriptor-vs-frame doctrine itself
changes.

## No new field type without a fight

The field-type and role vocabularies are closed and budgeted (`data-contract.md`): Grafana ended a
decade with eight field types. Every addition is rendered for every provider forever. The default
answer to "we need a richer type" is a frame pane; the second answer is composing existing types;
adding a type is the last answer and a protocol version event.

## No write-back in v1

Dragging a kanban card is a mutation, and value mappings are many-to-one, so the inverse is
ambiguous (`composition.md § Write-back`). Shipping read-only first is not a cut corner — it
avoids designing a per-field mutation contract and its trust story under time pressure. The
mapping config's persisted shape reserves room (per-(source, column) records that can grow a
`writeValue`). Revisit when the read-only surface has real usage and the mutation contract can be
designed against observed boards.

## No cross-collection joins

A panel unions collections and maps fields; it does not join them ("show each PR with its linked
Linear issue" as one row). Joins need key relationships the contract doesn't express, and
Notion-family systems ship successfully without them (`prior-art.md`). The existing
`contentLinks`/`refResolvers` machinery already covers the adjacent need (linked references
resolved and rendered on demand). Revisit if union + mapping demonstrably fails the todo-board
class of use cases — and then consider a declared relation-by-role before a general join.

## No sniffed wire shapes

`PluginRailItems` is sanitized field-by-field rather than schema-parsed; that pattern is not
repeated. Collections get real Zod schemas in `@acorn/protocol` from day one
(`data-contract.md § Validation stance`) — the `agentContexts`/`refResolvers` template. This is a
deliberate, argued exception to "reads are not validated": a loaded plugin's response is untrusted
wire rendered under the host's chrome, exactly the boundary where all four existing exceptions
sit.

## No dashboard machinery reachable from frames

Panel and dashboard definitions are host-owned config in core persistence — never in a frame's
`state.get/set` prefs namespace, never writable through the bridge, and host panels never render
inside a frame document (`placements.md § The host-drawn-region rule`). A frame that could edit
panel definitions could point the host's chrome at routes of its choosing; the composition layer
stays entirely on the host side of the trust boundary. Revisit never; widen the placement
constraint vocabulary instead.

## No per-plugin "dashboard" contribution kind

A plugin does not ship a prebuilt dashboard ("install github, get a PR dashboard") as a distinct
contribution in v1 — that is Backstage's model, and it forecloses nothing here since a plugin can
achieve the effect later via defaults. If pre-built starter panels prove wanted, the shape is a
plugin-suggested *panel definition* the user accepts into their own composition — suggestions,
not owned surfaces — so ownership of composed panels stays with the user.
