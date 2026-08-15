# World-class plugin DX: the bar, the gap, the differentiator

From the ecosystem-feasibility session (2026-08-14), pruned 2026-08-16. Nothing here is scheduled.
The plugin-DX review's eight findings and the agent-authored dev loop have both shipped and been
retired from this file; the behavior they produced is documented in `docs/plugin-authoring.md`,
`docs/plugins.md`, `docs/testing.md`, `docs/data-layer.md` and `docs/local-development.md`. What
remains here is the one open gap, the residue worth checking before building on it, and the bar.

## The bar

A stranger with no checkout of this repo can go from "I want a pane that shows X" to a working,
installable plugin in an afternoon, and from there to something they'd publish in a weekend —
without reading acorn's source. Concretely: install one package, follow one guide, get errors
that name themselves, test without the host, and iterate without restarts.

## What already clears it

- **The authoring contract is one document** — `docs/plugin-authoring.md`: hand-written manifest,
  multi-file relative-import ESM node half, single-file vanilla-JS client, the updates/data
  stance. No build step required.
- **The loop is reload-shaped.** `POST /v2/core/plugins/:id/reload` swaps a node half in place;
  the client re-syncs on `plugins:changed`; a dev grant keeps trust prompts out of iteration. One
  documented limit: the ESM cache-bust is one module deep — changes outside the entry file still
  need a restart (`docs/plugins.md § Reloading one plugin`).
- **The agent is taught, not just permitted.** The `plugin_authoring` tool serves the guide plus
  the manifest vocabulary derived from the Zod schema at call time, so an agent never answers an
  API question from stale memory; `plugin_request` turns its installs into human approvals.
- **Failures name themselves** (roster `reason`/`stage`, attention inbox, labelled frame
  placeholders); **testing takes a real context** from `@acorn/plugin-api/testkit`; **the API
  surface is pinned** (snapshot + `PLUGIN_API_MAJOR`); **storage is host-owned**.

## The one gap: the facade doesn't install

`@acorn/plugin-api` and `/ui` are workspace-only (`docs/extensibility.md § Plugins get building
blocks` records this as accepted-intermediate). Publishing it is packaging work plus one real
decision: the compat promise — "your plugin keeps loading within a major." The snapshot test and
API major already enforce it internally. Without this, nothing else matters to an external author:
the front door is closed.

**After it, deliberately last: a scaffold** (`create-acorn-plugin`) — one command emitting the
no-bundler profile with the manifest pre-filled. Last per `docs/extensibility.md`: a scaffold over
a moving contract is churn; over a settled one it is the welcome mat.

## The differentiator

Every project in `references/` with a plugin story picked one side of the trade: bb has the
magical loop with no trust boundary; herdr has a real marketplace over a socket API; the rest have
no third-party story at all. Nobody has **an agent-authored plugin loop behind a real sandbox**.
acorn's shape — "make my acorn look like X / build me a pane for Y" as a one-session agent task,
mediated by one human approval, iterating without prompts, distributed later through signed
per-hash consent — is the pitch no neighbour can copy without rebuilding their security model. The
loop is live; publishing the facade is what makes it true for humans outside this repo, and
rung 2 (`blockers.md § 1`) is what lets strangers join.

## Residue worth checking before building on the shipped work

- Three exports on the facade are still marked `// prune candidate` — the raw WebSocket attach,
  the node's capability read model, and the agent-tool renderer registry — each waiting on a `ctx`
  seam that does not exist yet (`packages/plugin-api/src/client/index.ts`).
- The testkit deep-import baseline in `tools/arch/boundaries.test.ts` should be shrinking from 147
  imports across 37 files; if it is not, the migrate-as-you-touch rule is not being followed.
- Plugin suites are node-environment with no Solid transform: a green suite is not evidence about
  anything rendered. The shipped chrome (context menus, topbar chips, extension-point strips,
  exclusive-slot fallback) has never been verified in a running app — see
  `docs/future/live-qa.md`.
