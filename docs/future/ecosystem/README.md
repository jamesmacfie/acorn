# Ecosystem: acorn as a shell over third-party plugins

Design notes from the ecosystem-feasibility session (2026-08-14), pruned 2026-08-16 to what is
still ahead. Nothing here is scheduled. It is the umbrella over the remaining design material —
`docs/future/dashboards/` and `docs/future/compiled-tier.md` — plus `docs/extensibility.md` and
`docs/security.md`. Where this folder disagrees with any of those, those win.

## The end goal being assessed

A user points acorn at a folder on their machine — or at GitHub, or a marketplace — and installs
their own plugins onto the desktop node or a remote node. Long term, acorn becomes a shell: a
small core owning what security and universality demand, and everything else a plugin. Users
compose their own experience — dashboards, plugins, plugins talking to each other. Third-party
authors get developer experience good enough that building a quality acorn plugin is an afternoon,
not a week.

## Where this stands (2026-08-16)

Much of the original assessment has shipped. The agent-authored dev loop is real: the authoring
contract is `docs/plugin-authoring.md`; a loaded plugin hot-reloads in place
(`POST /v2/core/plugins/:id/reload`, candidate-then-commit, a `plugins:changed` event the client
re-syncs on); the agent raises installs through an approval-mediated tool and iterates under a
per-(plugin, node) dev grant; plugin themes, declarative chrome, context menus, cooperative
extension points and exclusive slots are manifest vocabulary (`docs/plugins.md`,
`docs/ui-design.md § Plugin themes`). The node-first review's contracts also landed: the
client↔node version contract (`docs/api-reference.md § Versioning`), the platform seam, and
node-side ownership of user compositions (`docs/state.md`).

What remains is exactly three programs plus one map:

1. **The front door** — `@acorn/plugin-api` still only resolves inside this workspace. Publishing
   it is the whole of what blocks a genuinely external author. (`dx.md`)
2. **Rung-2 containment** — the long pole, and the hard gate on anything discovery-shaped. A
   loaded plugin's node half still runs in-process, disclosed rather than contained.
   (`blockers.md`)
3. **Dashboards** — phases 1–3 of `docs/future/dashboards/README.md`. Independent of the above;
   this is where plugin composition becomes visible to users.
4. **Distribution, last** — signing, the `docs/future/bundle.md` release work so a remote node is
   a download, then discovery over signed packages. (`work-plan.md`)

`docs/future/compiled-tier.md` is not a phase — it is the standing per-plugin map for shrinking
the compiled tier, consulted whenever a move is considered.

## The files

| File | What it holds |
| --- | --- |
| `blockers.md` | The gates still standing between today and strangers installing plugins — each with its designed answer and owning doc. |
| `shell-vision.md` | The tension between "acorn as shell" and the permanent tier line, and the stance adopted. |
| `work-plan.md` | The remaining sequenced work with dependencies, pointing at the owning design docs. |
| `dx.md` | What "world-class plugin DX" still requires, and the differentiator. |
| `references-survey.md` | What the projects in `references/` do, which ones acorn can replace, and the five capabilities that recur across all of them. |

## Drift warning — read this before building

Behavioral claims here were verified against the tree on **2026-08-14** and re-checked
**2026-08-16**. The codebase will drift before the rest is built; `references/` may move or be
deleted. Treat the *decisions and orderings* here as durable and the *paths* as hints. The owning
docs for current behavior are `docs/plugins.md`, `docs/plugin-authoring.md`, `docs/security.md`,
`docs/extensibility.md`, and `docs/third-party/README.md` — where this folder disagrees with
those, those win.
