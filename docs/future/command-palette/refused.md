# Command palette: what was refused

Decided 2026-09-03. Each entry states what would reopen it.

## A plugin-rendered palette frame

Refused. The palette owns global focus, reserved keys, navigation, loading, errors, and result
invocation. Letting an iframe or remote tree redraw those semantics creates one palette per plugin,
breaks TUI parity, and widens the loaded-plugin UI boundary for no domain capability. Plugins return
facts and declare closed actions; the host draws them.

Reopens never. A genuinely custom workflow belongs in a plugin pane or overlay, not the command
palette.

## A second registry for every interactive kind

Refused. `paletteRows` already demonstrates the cost: commands and rows must be merged, filtered,
owned, and invoked through parallel code. Group, search, input, and setting are variants of a command
because shortcuts, capability gates, ownership, discovery, and outcomes are shared.

Reopens if one proposed kind no longer has command semantics—for example, a durable background job
with no user invocation.

## Returning executable commands from a loaded search response

Refused. A route response is untrusted wire input. Letting each result choose a verb, URL, or route
makes a changing server response more powerful than the reviewed manifest. Results carry display
facts and identity; the manifest search command owns one static action.

Reopens only with a separately designed, schema-bounded result-action contract, trust disclosure,
and a use case that one static action cannot express.

## Result action panels in the first version

Deferred. They are useful for operations such as promoting a Rollbar issue or acting on a container,
but they multiply authorization, confirmation, keyboard, and loaded-wire decisions before the graph
and search contracts have proved themselves. The initial result has one primary action.

Reopens after phases 0–6 ship and telemetry or user reports identify concrete secondary actions.

## Fleet search by default

Refused. It multiplies external-provider requests, latency, rate-limit pressure, result collisions,
and partial errors. Scope is declared per command and defaults to the active node. Core task and
workspace navigation may deliberately use fleet scope.

Reopens if a control plane provides a single indexed fleet query with its own authorization and
ranking semantics.

## Calling an LLM as the user types

Refused. Generation is not search: it costs money, takes materially longer, and produces a side
effect/result the user meant to request once. Generate SQL is an input command submitted explicitly
with a duplicate guard and loading state.

Reopens never for ordinary query typing. A future suggestion system would need an explicit opt-in,
budget, and cancellation contract.

## Reflecting Settings pages into commands

Refused. Settings pages are arbitrary components or remote trees, not a field schema. Scraping them
would couple the palette to rendering and create a second persistence path. Owners opt into a
setting command and share its accessor with the page.

Reopens if Settings itself moves to a typed domain schema used by every renderer; the palette could
then become another projection of that same schema.

## Free-form secret settings

Refused. The initial setting kind is a bounded choice with a visible current value. Connection keys,
HTTP variable values, and other secrets need secure input, reveal policy, validation, and richer
recovery than a palette choice.

Reopens through a dedicated secret-entry design, not by widening `setting` to arbitrary text.

## Cross-owner command parenting

Refused. A plugin inserting children into another plugin or core group creates hidden lifecycle and
presentation coupling and makes ownership unclear during disable/reload. Parents and children share
one host-stamped owner. Root descendant search keeps commands discoverable without cross-owner trees.

Reopens with an explicit command extension point owned by the parent, including an acceptance and
ordering contract.

## Replacing every picker with the command palette

Refused. The editor and GitHub file finders are commands because they have named shortcuts and one
selection outcome. A workspace topbar picker or another embedded chooser may still legitimately use
the generic overlay helper. Migration is based on semantics, not component resemblance.

Reopens per picker when it becomes a globally discoverable, context-complete command.

## Combining the work with the TUI renderer rewrite

Refused. The session is host-neutral and the TUI renderer consumes it through an adapter. Changing
the painter at the same time destroys the parity baseline and couples two high-risk programmes.

Reopens never as a combined change. Either programme may land first; the other re-verifies its
adapter before starting.

