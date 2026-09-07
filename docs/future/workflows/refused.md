# Refused: what was considered and set aside, with the argument

Part of [docs/future/workflows/](./README.md). Each of these will be asked for again, and the
request will sound reasonable. This file exists so the argument is had once.

## A separate `edges` list

proliferate's wire shape: `nodes[]` and `edges[{from, to}]`. Refused for `after` on each step,
because every existing TOML file keeps its meaning with no migration, because a step's dependencies
sit beside the step that has them, and because a second top-level section is a second thing to
validate against the first. The editor derives edges and can draw them either way.

## A `parallel` group step

Keep the list linear and add a kind whose children run together. Refused because it boxes the model
in the moment a node needs two upstreams from different groups, which the synthesiser in the owner's
first workflow needs on day one.

## Always a child task per parallel step

Refused as the default. Investigate, review, and summarise do not write, and a worktree per reader
is what made fan-out feel heavy. A step asks for a worktree when it will write.

## One implicit context string

A single free-text context per run and `${context}` in prompts. Refused because a workflow cannot
ask for two different things or say that one is required, and because the item menu cannot tell
which field the link belongs in.

## Relying on task-context injection for inputs

Attach the item to the task as a link and let the context assembler tell the agent. Refused as the
only path because a `terminal:command` step reads no context, and because a task may track several
items and the workflow needs the one it was started from.

## Moving the TOML into the database

Refused, again. A repo file is hashed by the trust snapshot and reviewed in a pull request; a row is
typed by the owner behind the device gate. They are different trust stories and stay different
stores with one merged read. Save to repo converts one into the other on purpose.

## Project-only or node-wide definitions

Project-only makes a general "investigate an issue" workflow a copy per project. Node-wide makes
nothing about a repo checkable at authoring time. Workspace with an optional project is the shape
the rail already has.

## JSON Schema forms

A kind ships a JSON Schema for `with` and the host renders it. Refused because the host would need a
schema-to-form renderer that works in cells, and because model lists and run targets are dynamic and
JSON Schema has no way to say "fetch these". A closed field vocabulary with an options route is what
`CredentialField` and collection params already are.

## A plugin-rendered inspector

A kind names a remote tree the plugin renders into the inspector. Refused because every kind then
needs a client bundle, the host cannot validate or index the form, and the built-ins would be the
only kinds drawn one way. Descriptors are data; a form is a descriptor.

## A PTY per command, or a per-node tee

Every command in a visible terminal. Refused because a clean stdout out of a PTY stream is lossy and
a headless node with no client attached still has to hold the PTY. A tee on demand was refused as a
second code path to keep honest. `terminal:run-target` is the node for "a process I want to look
at".

## `database:write`

Deferred, not refused. It needs an execute-tier ceiling check and an audit row, and nothing in the
first workflow writes. The read-only refusal in `database:query` is the seam it would open.

## A canvas first, or a canvas as a rectangle

Canvas first was refused because the list is kit-only and works in both hosts, and every rule the
canvas needs is proven on the list. A canvas as a rectangle (an iframe owning pixels) was refused
because the terminal draws a rectangle as one muted line, and the kit's admission rule is the way a
canvas gets a cell projection.

## A task pane, or the Settings page, as the editor

A definition is not task state and outlives the task. Settings has no project in scope for run
targets and saved queries, and no terminal counterpart.

## A separate start dialog from the item menu

Refused because the promote-to-task modal already knows how to create or attach, and two modals that
create tasks drift.

## Grouping workflow sessions in the agent sidebar

Refused because the run pane owns steps and the sidebar would duplicate it. A glyph on the row and a
chip in the header are enough to get from a session to its run.

## Rerun from an arbitrary node

Refused for this programme. Rerunning from a done node means unwinding its successors' handoffs and
outputs, and deciding what a downstream node that already consumed them should see. Retry of a
failed node covers the case the owner hits.

## A minted `id` beside `name`

proliferate's rule. Refused because `${steps.s3.output}` is worse to read in a TOML file than
`${steps.reproduce.output}`, and because every existing file would need `id` defaulted on load. The
editor rewrites references on rename instead.

## Positions in the definition

Refused. A definition travels between a file, a row, and a run's frozen copy, and none of them care
where a card was. Device preferences keyed by definition id hold them.

## Triggers and schedules for database rows

Deferred. The sweep reads files; reading rows too is small, but a row that fires on its own is a row
that runs an agent when nobody typed anything, and that wants the same trust thinking the file layer
had. Not in this programme.

## Agent tools that start or drive a run

`agent_spawn` and friends. [orchestration.md](../orchestration.md) owns them and its spawn ledger.

## Editing a live run's definition

A run freezes its definition at start and stays that way. The editor does not offer to retarget a
run; retry with an edited prompt patches one step of the frozen copy and records that it did.

## A second run list

The merged list at Settings → Runs stays as it is. The run pane is addressed by task, and
`@acorn/protocol/runs.ts` already says when a core runs table would be earned.
