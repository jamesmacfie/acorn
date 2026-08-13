# Ecosystem: acorn as a shell over third-party plugins

Design notes from the ecosystem-feasibility session (2026-08-14). Nothing here is scheduled; this
folder records the assessment so a future project starts from conclusions instead of re-deriving
them. It is the umbrella over four folders that already hold the detailed designs —
`docs/future/user-extensions/`, `docs/future/dashboards/`, `docs/future/debug-plugin/`, and
`docs/future/architecture/` — plus `docs/extensibility.md` and `docs/security.md`. Where this
folder disagrees with any of those, those win.

## The end goal being assessed

A user points acorn at a folder on their machine — or at GitHub, or a marketplace — and installs
their own plugins onto the desktop node or a remote node. Long term, acorn becomes a shell: a
small core owning what security and universality demand, and everything else a plugin. Users
compose their own experience — dashboards, plugins, plugins talking to each other. Third-party
authors get developer experience good enough that building a quality acorn plugin is an afternoon,
not a week.

## The verdict, in plain words

This is feasible, and most of the design work is already done and written down. Nothing in acorn's
architecture fundamentally blocks it. What stands in the way is four deliberate decisions, each
with a recorded rationale and a designed answer:

1. A plugin's node half runs inside the node process with the node's full access. The permission
   system describes what a plugin asks for; it does not stop a plugin taking more. Fine for
   plugins you wrote. Not fine for a marketplace. The fix (one child process per plugin) is
   designed in `docs/security.md` as "rung 2" and was deliberately kept a refactor, not a
   redesign.
2. Plugin packages are not signed, and there is no discovery surface. Hash pinning and audited
   installs exist; signing and a marketplace do not.
3. Nothing reloads. Installing or updating a plugin needs a node restart and a renderer reload.
   The fix is designed in `docs/future/user-extensions/agent-authored-plugins.md` and is smaller
   than it looks.
4. An external author cannot build a plugin today, because `@acorn/plugin-api` only resolves
   inside this workspace. The rest of the developer-experience gaps are catalogued with plans in
   `docs/future/debug-plugin/`.

The one place the vision collides with a decision this repo defends well is the "permanent"
first-party tier: streams, in-shell components, and Electron-main code stay first-party, and the
Monaco finding proved heavyweight surfaces get *host-owned surfaces plugins borrow*, not a wider
sandbox. So the honest end state is not a thin shell. It is a fat, opinionated core — security,
transport, trust, the workspace/task model, a few host-owned surfaces — with everything
integration-shaped, data-shaped, and workflow-shaped as plugins. That is most of the vision, and
it is the part users care about. `shell-vision.md` records this stance and why.

## Recommended build order

1. **The agent-authored dev loop** — the five items in `docs/future/user-extensions/README.md`
   (authoring profile, reload path, approval-mediated install, dev trust grant, agent
   enablement). This delivers "point at a folder and iterate" and the self-modification loop.
2. **Developer experience, in parallel** — the eight findings in `docs/future/debug-plugin/`
   (failure visibility first), plus making `@acorn/plugin-api` installable from outside the
   workspace. (`dx.md`)
3. **Rung-2 containment** — the long pole, and the gate on anything marketplace-shaped. Ship it
   before any discovery surface exists. (`blockers.md`)
4. **Dashboards phases 1–3** — per `docs/future/dashboards/README.md`. Independent of the above;
   this is where plugin composition becomes visible to users.
5. **Distribution, last** — signing, the remaining `docs/future/bundle.md` release work so a
   remote node is a download, then discovery. `docs/extensibility.md` already says ecosystem work
   goes last; this folder agrees and says what "last" contains. (`work-plan.md`)

## The files

| File | What it holds |
| --- | --- |
| `blockers.md` | The four gates between today and strangers installing plugins — each with its designed answer and owning doc. |
| `shell-vision.md` | The tension between "acorn as shell" and the permanent tier line, and the stance adopted. |
| `work-plan.md` | The sequenced work with dependencies, sized honestly, pointing at the owning design docs. |
| `dx.md` | What "world-class plugin DX" requires, what exists, what is missing, and the differentiator. |
| `references-survey.md` | What the projects in `references/` do, which ones acorn can replace, and the five capabilities that recur across all of them. |

## Drift warning — read this before building

Every behavioral claim in this folder was verified against the tree and the owning docs on
**2026-08-14**. The codebase will drift before this is built; `references/` may move or be
deleted. Treat the *decisions and orderings* here as durable and the *paths* as hints. The owning
docs for current behavior are `docs/plugins.md`, `docs/security.md`, `docs/extensibility.md`, and
`docs/third-party/README.md` — where this folder disagrees with those, those win.
