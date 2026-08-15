# The compiled tier: the map for shrinking it

From the node-first session (2026-08-15). Nothing here is scheduled. This file is the standing
answer to "which compiled plugin moves to the loaded tier next, what blocks it, and what gets
deleted when it goes." It does not change the tier line — `docs/extensibility.md § Two tiers,
permanently` stands, and so does "do not migrate for tidiness." What the end goal adds is a third
honest reason to move a plugin, alongside exercising a seam and wanting release cadence:
**whatever is compiled into the client does not exist for a web or terminal client, and cannot be
imitated by an agent-authored plugin.** Every compiled integration is a hole in "the node
provides the UIs."

## Where this already stands (good news first)

Five plugins are loaded (database, http, linear, model-providers, rollbar) with **zero production
import edges** into them. A compiled plugin costs one roster line per side
(`apps/desktop/src/app/client/plugins.ts`, `apps/node/src/server/plugins.ts`) and registers
itself through `ctx`. A loaded plugin can shadow a built-in by id (`composition.ts`) — the
migration hatch is already wired. The registration-point sprawl this review expected to find was
already fixed.

## The census (verified 2026-08-15)

Twelve compiled plugins, easiest move first. "Dies with it" lists the private registries whose
last consumer leaves.

| Plugin | What blocks a move | Dies with it | Call |
|---|---|---|---|
| onboarding | Nothing structural — it is a first-run gate that must exist before plugin distribution settles. | — | Honestly core shell, not a plugin. Leave it; costs one line. |
| notes | `protocol/notes.ts` location type is core addressing; node half writes `.md` files in the data root. | — | Movable when a seam wants it. |
| changes | Renders inside the agents transcript via `agentToolRenderers` — an in-realm component on a core surface. | `agentToolRenderers` (sole consumer) | **Stays first-party** per the tier line (inline renderers). Named, not pending. |
| context | Hosts the tray that memory renders into (receiving half of the same coupling). | — | Movable only together with memory, and coupling 1 below says why that is now a redesign, not a seam swap. |
| preview | Electron main `WebContentsView` code. | — | **Stays first-party** (desktop extra behind the platform seam). |
| editor | Monaco in-realm; the host document surface already exists and `docs/third-party/editor.md` owns the remaining move. | — | **In flight** — the last planned migration of the original program. |
| docker | Owns the `docker` WS channel + exec streams; `tabrail.task-row` slot has no manifest form. | `tabrail.task-row` | Closest to movable of the stream owners; its footer badge already has a descriptor twin. |
| memory | Renders inside context's tray — editable inputs and accept/reject gates, a component in another plugin's surface; `MEMORY_KNOWLEDGE` capability named by the composition root. | client `contextSections` | **Stays first-party while the tray is a component** — the cooperative-seam conversion was attempted and correctly refused (coupling 1 below). |
| workflows | Publishes `WORKFLOW_CONTROL`, an in-realm function capability consumed by agents' sidebar. | — | Movable once that capability becomes a descriptor/route seam (below). |
| github | Core data-model coupling: `github_*` columns on the projects row, `Project.github`/`Task.pullNumber` on the wire, core draws PR affordances (`DEFAULT_PANE = 'pr'`, TabRail), `integrationFlows` has no manifest form. | `integrationFlows` | The big one. Gated on the project-row generalization, which is real work and not icon-sized. |
| agents | Owns the `agent` WS channel; the transcript is a core surface other plugins render into; `AGENTS_RUNTIME` required by the composition root. | — | **Stays first-party** (stream + surface owner). |
| terminal | Owns PTY streams ("exactly one plugin may own these"); the drawer is a core surface; folder-picker main code. | `drawer` slot (its topbar chip has since gained a manifest form — `slot: 'topbar'`) | **Stays first-party** (stream owner). |

**The honest end state, then:** integrations and data features (github, docker, memory, notes,
context, workflows, editor) end up loaded; the stream-and-surface owners (terminal, agents,
preview, changes) are named permanent first-party — they are core features wearing the plugin
costume, and the costume is cheap enough to keep for uniformity. That end state matches
`docs/future/ecosystem/shell-vision.md` exactly; this table is its per-plugin ledger.

## The four couplings that need a designed seam (the actual work)

These, not the moves themselves, are the architecture in this file. Each is a place where two
plugins share a realm today; each has a designed answer that is data-plus-messages.

1. **memory → context's tray.** The seam this file first prescribed — convert the pair to the
   cooperative extension point — was attempted when that contract shipped (2026-08-15) and
   **correctly refused**: the tray is editable inputs and accept/reject gates, a *component*, and
   converting it would have meant a widget vocabulary on the wire, which the contract refuses on
   the record. The extension-point seam shipped with a different first consumer
   (`docs/plugins.md § Cooperative extension points`), and the CSS ownership was fixed separately
   — the cross-package baseline fell from 12 entries to 5, and context's two remaining entries are
   shared vocabulary classes, not layout. What remains true: memory moves only if the tray itself
   is redesigned descriptor-shaped, and nothing currently argues for that. Treat memory as
   first-party until something does.
2. **workflows → agents (`WORKFLOW_CONTROL`).** Three function references passed in-realm. The
   loaded-tier shape already exists: node-side capabilities plus plugin routes — and since the
   chrome vocabulary grew (context menus, extension points, exclusive slots are manifest keys
   now), the descriptor path has more room than when this was written. Decide whether the
   sidebar's controls become descriptors (verbs from the closed set: `runNodeAction`) or a small
   frame. Either removes the last in-realm function passing between plugins — but heed coupling 1:
   if the controls turn out to be component-shaped (live inputs, not rows-with-verbs), the honest
   answer is "stays first-party", not a wider wire format.
3. **changes → agents (`agentToolRenderers`).** An inline transcript renderer is on the permanent
   first-party list, and that is the right call — so say it once here and stop treating changes as
   a migration candidate. The registry stays, with its consumer count pinned at one.
4. **github → the projects row.** `github: { owner, name, repoId }` is a first-class core column
   family, and core renders PR affordances from it. The move is generalizing "a project's linked
   external repo/item" into core vocabulary that any provider plugin can fill (the task-origin
   pattern already does this for tasks). Real work, already flagged in the icons session as
   "entirely unrelated to icons"; it is the gate on the biggest move and should be designed as
   its own brief before anyone starts it.

## Delete now (no move required)

- **Dead slot ids** `topbar.left` and `task.switcher.extra` — zero consumers anywhere (the
  manifest slot enum grew to `footer | topbar` without them, which confirms nobody wants them).
- ~~The `themes` registry~~ — resolved: manifest-declared token themes shipped
  (`docs/ui-design.md § Plugin themes`), so that registry now has its plugin feeder. `styles`
  stays core-only by decision (style packs are deliberately not contributable).

## Sequencing rules

- A move must still earn itself: exercise a new seam, want its own cadence, or close a named hole
  for non-desktop clients. Tidiness still loses.
- **Prefer the move that deletes a registry.** The census column above is the scorecard; a move
  that retires a private registry shrinks the surface an agent-authored plugin can never reach.
- Budget for the ratchets: the testkit deep-import baseline sits flush at its ceiling (147
  imports, exact-set roots), so any move must prune its roots in the same change; and the
  anti-vacuity floors in `boundaries.test.ts` (package/edge minimums) will need lowering as
  plugins leave the workspace graph.

## Verify before building

Re-run the census: which plugins have `acorn-plugin.config.mjs`; current consumers of each
host-only registry (`registries/plugin.ts` vs the manifest's contribution block in
`pluginContract.ts`); whether the memory/context tray coupling and `WORKFLOW_CONTROL` still
exist; whether the projects row still carries `github_*` columns; and the current ratchet numbers
in `tools/arch/boundaries.test.ts`.
