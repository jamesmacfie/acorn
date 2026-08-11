# User extensions: acorn modifying acorn

Design notes from the bb-comparison session (2026-08-12). Nothing here is scheduled; this folder
records the analysis so a future project starts from conclusions instead of re-deriving them. Two
deep research passes ground it: one traced bb's self-modification loop end to end in its actual
code (vendored at `references/bb` at the time — see the drift warning below), one inventoried
acorn's shipped plugin system, trust model, and extension points.

## The end goal

acorn's functionality and UI are governed by the connected node. Plugins loaded on the node decide
what panes, sources, tools, and routes exist. So if the agent running inside acorn can write a
plugin package onto the node and acorn can load it, **the agent has modified acorn itself** — no
fork, no core change, no app release. This is the property bb is known for ("you can use bb to
modify bb"), and it falls out of acorn's architecture rather than needing to be bolted on.

## The verdict

It works, and acorn is unusually well placed. bb proves the product experience is worth chasing and
shows exactly which mechanics make the loop feel alive: source-loaded plugins, hot swap with
rollback, live UI reconciliation, and agent-facing authoring docs generated from the running app.
What bb does *not* have is a trust boundary — its plugins are full-trust in-process code and the
install warning is the whole security model. acorn's sandbox, per-bundle trust, and deliberately
agent-unreachable install route are the opposite end of the same trade: trust versus loop speed.

The design position of this folder: **do not adopt bb's trust model to get bb's loop.** Build a
dev loop a human enters once per plugin, after which iteration is frictionless. The four things
standing between acorn and the loop today are all deliberate decisions (no bundler at node runtime,
nothing hot-reloads, install is device-only, trust is per bundle hash), and each has a designed
answer that keeps the boundary — see `agent-authored-plugins.md`.

## Recommended build order

1. **Agent-authored plugin profile** — a documented no-bundler contract (plain ESM node half,
   single-file vanilla-JS frame). Zero new runtime dependencies. (`agent-authored-plugins.md`)
2. **Reload path** — node-side candidate hot swap + client-side "plugins changed" reconcile. The
   biggest lift, smaller than it looks. (`agent-authored-plugins.md`)
3. **Approval-mediated install** — the agent's install request becomes a human approval through the
   existing agent-tool permission flow; the device performs the install. (`agent-authored-plugins.md`)
4. **Dev trust grant** — per (pluginId, device) while in dev mode, replacing per-hash prompts.
   (`agent-authored-plugins.md`)
5. **Agent enablement** — authoring skill, generated API types from the running node, seeded
   prompt in settings. (`agent-authored-plugins.md`)
6. **Themes as validated tokens** — the best first self-modification demo, and safer than bb's raw
   CSS. (`extension-points.md`)
7. **Declarative chrome + context menus**, then **cooperative cross-plugin extension points**.
   (`extension-points.md`)

Plugin updates and schema migrations are mostly already solved by shipped machinery; the residue
(downgrades, reload × migration) and the stance to adopt are in `plugin-updates-and-data.md`.

## The files

| File | What it holds |
| --- | --- |
| `bb-reference.md` | Self-contained record of bb's mechanics — written to survive `references/bb` being deleted. Ends with a steal/adapt/refuse table. |
| `current-state.md` | acorn's plugin system as verified 2026-08-12: loader, installer, trust, change model, contribution inventory, storage, and the four deliberate blockers. |
| `agent-authored-plugins.md` | The core design: the dev loop, its four pieces, build order, and what keeps it maintainable. |
| `plugin-updates-and-data.md` | Updating existing plugins that own DB tables — what's already built, the hard residue, the stance. |
| `extension-points.md` | The three new extension surfaces (themes, declarative chrome, cooperative cross-plugin) and the one bb mechanism to refuse. |

## Drift warning — read this before building

Every file path, route, constant, and behavioral claim in this folder was verified against the
tree on **2026-08-12**. The codebase will drift before this is built; `references/bb` may move or
disappear entirely. Treat the *mechanisms, measurements, and decisions* recorded here as durable
and the *paths* as hints. Each file carries a short "verify before building" list naming the seams
most likely to have moved. The owning docs for current behavior are `docs/plugins.md`,
`docs/security.md`, `docs/extensibility.md`, and `docs/third-party/README.md` — where this folder
disagrees with those, those win.
