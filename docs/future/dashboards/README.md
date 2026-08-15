# Dashboards: user-composed panels over plugin data

Design notes from the dashboards session (2026-08-12). Nothing here is scheduled; this folder
records the analysis so a future project starts from conclusions instead of re-deriving them. Two
research passes ground it: one mapped acorn's shipped contribution and data machinery off the tree
(`current-state.md`), one surveyed seven external systems that solved the same problem
(`prior-art.md`). The owning docs for current behavior are `docs/plugins.md`,
`docs/extensibility.md`, and `docs/data-layer.md` — where this folder disagrees with those, those
win.

## The end goal

The home page is nearly blank, and every user has a different "what needs my attention" shape:
Linear tickets assigned to me, PRs waiting on the security team, PRs I commented on, Actions that
failed this week, a SQL query graphed on a schedule, recent Rollbar errors. All of these are
filters over data plugins already have. The goal is that plugins expose that data in one typed
shape and users compose their own panels over it — including panels that merge sources. The
motivating scenario, used throughout the folder: **a personal todo kanban whose columns are the
user's own invention, populated by both GitHub PRs and Linear issues, with each provider's
statuses mapped onto the user's columns.**

## The verdict and the core invariant

It works, and acorn is unusually well placed — the descriptor tier ("plugin declares data, host
renders it"), the closed action-verb set, and the host-fetches-and-parses precedents
(`agentContexts`, `refResolvers`) are already the right foundation. Dashboards are that pattern
grown one size: from "one integer with a label" to "a typed collection of records."

The invariant that makes the whole design hold: **everything user-composed lives host-side
against one typed contract; plugins are providers of well-described records and get zero say over
pixels.** Cross-source composition, user-invented statuses, new placements — all of it is client
machinery over the same node↔client contract, so the contract never grows to chase a use case.
Corollaries:

- A third-party plugin's dashboard panels ship no client bundle, trigger no trust prompt, and are
  pixel-identical to first-party ones under every appearance pack — the strongest form of the
  descriptor argument (`ChromeSourcePanel.tsx:20-25`).
- Any two plugins that speak the contract can be combined without either knowing the other exists.
- New placements (Home, task panes, plugin-hosted regions, rail side panels) are additive.

The one-line rule the design succeeds or fails on: **the field-type vocabulary is where the battle
is won or lost — small, semantic, closed, versioned.** Everything else (views, generated editors,
kanban) falls out of that decision. See `data-contract.md`.

## The tension with a recorded refusal, addressed up front

`docs/plugins.md:283-288` refuses host-rendered master/detail for descriptor plugins: "common is
not the bar; impossible is," because rendering a plugin's UI from data "would mean designing and
eternally versioning a widget toolkit in the wire format. The answer to that stays no."

Dashboards walk straight at that decision, so the difference is stated on the record rather than
quietly reversed. The refused thing was reproducing *a plugin's bespoke UI* from data — an
unbounded fidelity chase. A dashboard is the opposite case: **the host's own generic surface,
where uniformity across providers is the entire point.** A frame cannot participate in a kanban
board alongside another plugin's data; only typed data can — this clears the "impossible" bar.
What crosses the wire is a record schema, not a widget toolkit; the host renders its own views.
The guardrail against the versioning tax is the tiny closed field-type set plus a versioned
protocol schema. When someone asks for a field type the vocabulary can't express, the answer is a
frame pane, not a wider wire format. The refusals this design keeps are in `refused.md`.

## Recommended build order

1. **The contract** — protocol Zod schemas (collection schema + rows + provenance), the manifest
   key, the host-side reader, plugin-owned TTLs. Prove it by expressing GitHub PRs and Linear
   issues as collections: two providers, one schema. (`data-contract.md`)
2. **The surface** — Home becomes a dashboard: grid of panels, add/remove/reorder, list + table +
   stat views, per-panel refresh, a versioned persisted model with panel definitions independent
   of placement. (`composition.md`, `placements.md`)
3. **Derived views and mapping** — the schema-generated panel editor (filter/sort/group with
   field-aware inputs), multi-collection panels, the mapping step (field mapping, value mapping,
   derived enum), and kanban as group-by. This phase is the todo-board scenario. (`composition.md`)
4. **Later, each independently** — charts, the discovery route for saved database queries
   (run-once-and-pin ships whenever the database collection lands), plugin-hosted placements and
   rail side panels, write-back. (`data-contract.md`, `placements.md`, `refused.md`)

The shared components a dashboard needs already exist: `Card`, `Table`, `EmptyState`, `StatusDot`
and `Meter` are on `@acorn/plugin-api/ui`. Only `skeleton` was never built, and `EmptyState busy`
covers most of what it was for.

## The files

| File | What it holds |
| --- | --- |
| `prior-art.md` | The seven-system survey (Grafana, Home Assistant, Backstage, Perses, VS Code, Notion-family, others), the four recurring patterns, and the nomenclature decisions. |
| `current-state.md` | acorn's relevant machinery as verified 2026-08-12: contribution tiers, the descriptor read path, the three data paths, freshness policy, Home/FleetHome, shared-component gaps, hard gates. |
| `data-contract.md` | The wire contract: collections, semantic field types and roles, self-describing responses, row identity and provenance, freshness, validation stance, discovery and run-once-and-pin. |
| `composition.md` | The host-side panel model: the four layers, views derived from schema, the todo board walked end to end, the generated editor, the persisted model, write-back constraints. |
| `placements.md` | Panels as placement-agnostic units; Home, task panes, plugin-hosted regions (the host-drawn-region rule), rail side panels, scoping and survival rules. |
| `refused.md` | What this design deliberately does not do, with reasoning and revisit conditions. |

## Drift warning — read this before building

Every file path, route, constant, and behavioral claim in this folder was verified against the
tree on **2026-08-12**. The codebase will drift before this is built. Treat the *mechanisms,
measurements, and decisions* recorded here as durable and the *paths* as hints. Files 3–6 carry a
short "verify before building" list naming the seams most likely to have moved. Where this folder
disagrees with `docs/plugins.md`, `docs/extensibility.md`, or `docs/data-layer.md`, those win.
