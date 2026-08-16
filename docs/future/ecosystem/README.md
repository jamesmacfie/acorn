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

The front door is now finished too. `npm create acorn-plugin` and `acorn-plugin-sdk` both ship
(`packages/create-acorn-plugin`, `packages/plugin-sdk`), so an author with no checkout gets the whole
no-bundler profile in one command or the typed bridge if they run a bundler
(`docs/plugins.md § What is published`); and as of **2026-08-16** the **folder install** works on every
build, so the directory the scaffold just wrote installs on a packaged acorn instead of being refused
(`docs/security.md § Installing from a folder`).

What remains is exactly three programs plus one map:

1. **Rung-2 containment** — the long pole, and the hard gate on anything discovery-shaped. A
   loaded plugin's node half still runs in-process, disclosed rather than contained.
   (`blockers.md`)
2. **Dashboards** — shipped (`docs/dashboards.md`); the remaining backlog is
   `docs/future/dashboards/`. Independent of the above; this is where plugin composition becomes
   visible to users.
3. **Distribution, last** — signing, the `docs/future/bundle.md` release work so a remote node is
   a download, then discovery over signed packages. (`work-plan.md`)

`docs/future/compiled-tier.md` is not a phase — it is the standing per-plugin map for shrinking
the compiled tier, consulted whenever a move is considered.

Before picking one up, read `work-plan.md § What is actually waiting on something`. The short version:
all three are startable today except discovery, which is hard-gated on containment — and the only item
no amount of effort routes around is the Apple Developer Program purchase, which macOS node downloads
and desktop auto-update are both stuck behind.

## The files

| File | What it holds |
| --- | --- |
| `blockers.md` | The gates still standing between today and strangers installing plugins — each with its designed answer and owning doc. |
| `shell-vision.md` | The tension between "acorn as shell" and the permanent tier line, and the stance adopted. |
| `work-plan.md` | The remaining sequenced work with dependencies, pointing at the owning design docs. |
| `references-survey.md` | What the projects in `references/` do, which ones acorn can replace, and the five capabilities that recur across all of them. |

`dx.md` was here and is gone: everything it asked for shipped. The bar it set is below; the
differentiator it argued is in `shell-vision.md`; the residue it asked people to watch is enforced in
code rather than described in prose — the scaffold's drift lock
(`packages/create-acorn-plugin/index.test.ts`), the published declaration's
(`packages/plugin-sdk/src/contract.test.ts`), the testkit deep-import ceiling (`MAX_DEEP_IMPORTS` in
`tools/arch/boundaries.test.ts`), the three `// prune candidate` markers in
`packages/plugin-api/src/client/index.ts`, and the unverified-chrome list in `docs/future/live-qa.md`.

## The bar for plugin DX

A stranger with no checkout of this repo can go from "I want a pane that shows X" to a working,
installable plugin in an afternoon, and from there to something they'd publish in a weekend — without
reading acorn's source. Concretely: install one package, follow one guide, get errors that name
themselves, test without the host, and iterate without restarts.

Every clause in that sentence holds today, the last one included since the folder install landed. What
clears it: one authoring document
(`docs/plugin-authoring.md`) and one command (`npm create acorn-plugin`); a reload-shaped loop with a
dev grant that keeps trust prompts out of iteration; an agent taught by `plugin_authoring` from the
live schema rather than from memory, with `plugin_request` turning its installs into human approvals;
failures that name themselves (roster `reason`/`stage`, the attention inbox, labelled frame
placeholders); a real context from `@acorn/plugin-api/testkit`; a pinned API surface; and host-owned
storage.

Deliberately not built: a JSON Schema for `acorn-plugin.json`. The install error already names the
offending field paths and `plugin_authoring` serves the live vocabulary from the Zod schema — a second
schema would be a second source of truth for the one failure mode the first two already catch.

## Drift warning — read this before building

Behavioral claims here were verified against the tree on **2026-08-14** and re-checked
**2026-08-16**. The codebase will drift before the rest is built; `references/` may move or be
deleted. Treat the *decisions and orderings* here as durable and the *paths* as hints. The owning
docs for current behavior are `docs/plugins.md`, `docs/plugin-authoring.md`, `docs/security.md`,
`docs/extensibility.md`, and `docs/third-party/README.md` — where this folder disagrees with
those, those win.
