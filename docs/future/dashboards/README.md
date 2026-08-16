# Dashboards: user-composed panels over plugin data

**The owning doc for how dashboards behave is [`docs/dashboards.md`](../../dashboards.md), with the
contribution itself in [`docs/plugins.md § Descriptors`](../../plugins.md). Where anything in this
folder disagrees with those, those win. What is left to build is below: the known ceilings, then
phase 4.**

This folder is the design record from the session that preceded the build (2026-08-12): the analysis,
the prior-art survey, and the refusals. It stays because a future session should argue with the
reasoning rather than with silence — but it is no longer a description of the system. Read
`docs/dashboards.md` first, and come here for *why*.

Two research passes ground it: one mapped acorn's shipped contribution and data machinery off the
tree (`current-state.md`, now a historical snapshot), one surveyed seven external systems that solved
the same problem (`prior-art.md`).

## The end goal

The home page was nearly blank, and every user has a different "what needs my attention" shape:
Linear tickets assigned to me, PRs waiting on the security team, PRs I commented on, Actions that
failed this week, a SQL query graphed on a schedule, recent Rollbar errors. All of these are filters
over data plugins already have. The goal was that plugins expose that data in one typed shape and
users compose their own panels over it — including panels that merge sources. The motivating
scenario, used throughout the folder: **a personal todo kanban whose columns are the user's own
invention, populated by both GitHub PRs and Linear issues, with each provider's statuses mapped onto
the user's columns.** That board works end to end.

## The verdict and the core invariant

It worked, and acorn was unusually well placed — the descriptor tier ("plugin declares data, host
renders it"), the closed action-verb set, and the host-fetches-and-parses precedents (`agentContexts`,
`refResolvers`) were already the right foundation. Dashboards are that pattern grown one size: from
"one integer with a label" to "a typed collection of records."

The invariant the whole design holds on: **everything user-composed lives host-side against one typed
contract; plugins are providers of well-described records and get zero say over pixels.** Cross-source
composition, user-invented statuses, new placements — all of it is client machinery over the same
node↔client contract, so the contract never grows to chase a use case. Corollaries:

- A third-party plugin's dashboard panels ship no client bundle, trigger no trust prompt, and are
  pixel-identical to first-party ones under every appearance pack — the strongest form of the
  descriptor argument.
- Any two plugins that speak the contract can be combined without either knowing the other exists.
- New placements (Home, task panes, plugin-hosted regions, rail side panels) are additive.

The one-line rule the design succeeded or failed on: **the field-type vocabulary is where the battle
is won or lost — small, semantic, closed, versioned.** Everything else (views, generated editors,
kanban) falls out of that decision. It held: the cross-source todo board landed without one new wire
field.

## The tension with a recorded refusal, addressed up front

`docs/plugins.md` refuses host-rendered master/detail for descriptor plugins: "common is not the bar;
impossible is," because rendering a plugin's UI from data "would mean designing and eternally
versioning a widget toolkit in the wire format. The answer to that stays no."

Dashboards walk straight at that decision, so the difference is stated on the record rather than
quietly reversed. The refused thing was reproducing *a plugin's bespoke UI* from data — an unbounded
fidelity chase. A dashboard is the opposite case: **the host's own generic surface, where uniformity
across providers is the entire point.** A frame cannot participate in a kanban board alongside another
plugin's data; only typed data can — this clears the "impossible" bar. What crosses the wire is a
record schema, not a widget toolkit; the host renders its own views. The guardrail against the
versioning tax is the tiny closed field-type set plus a versioned protocol schema. When someone asks
for a field type the vocabulary can't express, the answer is a frame pane, not a wider wire format.
The refusals this design keeps are in `refused.md`, and the distinction is now recorded beside the
refusal itself in `docs/plugins.md`.

## Known ceilings in what exists

Three limits the build found that these notes did not predict. None is a contract problem; each has
a named upgrade path and none is scheduled.

- **A mapped panel's fields are the five roles and nothing else.** A role is the only thing two
  independently-written collections agree about, so once more than one source is in a panel,
  `github.repo` and `linear.identifier` have no panel-local home. The upgrade is a user-invented
  panel field with a per-source picker — the same mapping matrix, one row longer. Recorded at the
  ceiling in `dashboards/mapping.ts`.
- **A collection that describes itself only in its answer cannot be configured until it has been
  fetched once.** The editor reads the answered schema out of the node's QueryClient, so a panel
  must be drawn before its filters and board columns can be set. Run-once-and-pin below is the
  design's answer; Linear reached the case first, without it. A cheaper partial fix is making that
  read reactive (`getQueryCache().subscribe`) so a first answer arriving while the editor is open
  fills the form instead of waiting for a reopen.
- **`person` renders as a name, not an avatar.** The type table below promises the avatar. Nothing
  blocks it; no provider has made it worth the fetch.

## Still unscheduled (phase 4)

Each is independent, and none needs a contract change:

- **Charts.** `number` and `datetime` are already in the vocabulary, so this is a view kind with
  type-inferred defaults, the Observable Plot principle (`prior-art.md`, `composition.md`).
- **A discovery route**, for collections that cannot be known at manifest time — the two-route
  `agentContexts` pattern, with static declaration as the degenerate case (`data-contract.md`).
- **Run-once-and-pin**, and with it the database plugin's saved queries as collections. Self-describing
  responses shipped, so the remaining work is the pinned definition and schema-drift detection
  (`data-contract.md`).
- **Plugin-hosted regions and rail-source side panels**, built as cooperative extension points with the
  user in the contributor's seat, under the host-drawn-region rule (`placements.md`). The placement
  scope-key format already has room for both.
- **Write-back.** Read-only was not a cut corner: value mappings are many-to-one and therefore not
  invertible, so the answer is a designated write-value per (source, column). The persisted shape
  reserves the field and the codec round-trips it unread (`composition.md`, `refused.md`).

## The files

| File | What it holds |
| --- | --- |
| `prior-art.md` | The seven-system survey (Grafana, Home Assistant, Backstage, Perses, VS Code, Notion-family, others), the four recurring patterns, and the nomenclature decisions. |
| `refused.md` | What this design deliberately does not do, with reasoning and the condition that would justify revisiting each. All of it still holds. |
| `data-contract.md` | The wire contract: collections, semantic field types and roles, self-describing responses, row identity and provenance, freshness, validation stance, discovery. |
| `composition.md` | The host-side panel model: the four layers, views derived from schema, the todo board walked end to end, the generated editor, the persisted model, write-back constraints. |
| `placements.md` | Panels as placement-agnostic units; Home, task panes, plugin-hosted regions, rail side panels, scoping and survival rules. |
| `current-state.md` | acorn's machinery as verified 2026-08-12. A snapshot of the ground the design was written against, not a description of the tree. |

## Drift warning — now double

Every file path, route, constant, and behavioural claim in this folder was verified against the tree
on **2026-08-12**, and the implementation moved several of them on its way in. Treat the *mechanisms,
measurements, and decisions* recorded here as durable and the *paths as wrong until checked*. The
"verify before building" lists at the end of files 3–5 have served their purpose and are kept only as
a record of what was checked. For anything that is a statement about how the system behaves today, go
to `docs/dashboards.md`, `docs/plugins.md`, `docs/extensibility.md`, `docs/data-layer.md` or
`docs/state.md` instead.
