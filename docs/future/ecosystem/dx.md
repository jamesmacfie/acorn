# World-class plugin DX: the bar, the gaps, the differentiator

Design notes from the ecosystem-feasibility session (2026-08-14). Nothing here is scheduled. The
plugin-DX review that sat under this file — eight findings, each with a plan — has been implemented
and retired; the behavior it produced is now documented in `docs/plugins.md`, `docs/testing.md`,
`docs/data-layer.md` and `docs/local-development.md`. This file adds what that review scoped out —
the external author, who was not its subject — and states the bar the ecosystem goal actually
requires.

## The bar

A stranger with no checkout of this repo can go from "I want a pane that shows X" to a working,
installable plugin in an afternoon, and from there to something they'd publish in a weekend —
without reading acorn's source. Concretely: install one package, follow one guide, get errors
that name themselves, test without the host, and iterate without restarts.

## What already clears it

The authoring surface itself is genuinely simple, and this is worth saying because it is the hard
part other platforms get wrong:

- **The manifest is declarative JSON** with a Zod schema as the single vocabulary
  (`pluginManifest.ts`), and most contributions are descriptors the host renders — no code at all
  for rail rows, badges, commands, keybindings.
- **The node half is plain ESM.** Under the no-bundler profile
  (`docs/future/user-extensions/agent-authored-plugins.md § 1`), relative imports plus `node:`
  builtins load directly — no build step.
- **The frame is vanilla JS.** A frame is a host-generated document, not a component in the
  shell's tree; there is no framework requirement, and the bridge SDK (`api`, `state`, `ui`,
  `keys`, `document`) is the whole surface. Single file is already the scheme's contract.
- **The API surface is pinned** — eight entrypoints, snapshot-tested
  (`packages/plugin-api/src/surface.snapshot.txt`), gated by `PLUGIN_API_MAJOR`, and the snapshot
  now refuses to shed a name unless that major moves.
- **Storage is host-owned.** Declare a Drizzle migration chain; the host opens, migrates, and
  contains failures per plugin.

## The gaps, in the order to close them

1. **The facade doesn't install.** `@acorn/plugin-api` and `/ui` are workspace-only
   (`docs/extensibility.md § Plugins get building blocks` records this as accepted-intermediate).
   Publishing it is packaging work plus one real decision: the compat promise. The snapshot test
   and API major already exist; the promise is "your plugin keeps loading within a major." Without
   this, nothing else on the list matters to an external author.
2. **Failures misreport** — closed. A failed plugin now carries `reason` and `stage` on its roster
   row and into the attention inbox instead of a console line nobody sees, a bad manifest names the
   field path it broke, and a frame that never evaluates gets a labelled placeholder rather than a
   blank rectangle (`docs/plugins.md § Loaded plugins`, `§ Loaded plugins: the client half`).
3. **The loop is restart-shaped** — half closed. `pnpm dev:plugin <id>` watches and rebuilds, and
   boot trust prompts are gone from development builds because the grant now covers the same
   application-owned directory a packaged build trusts (`docs/plugins.md § The dev loop`). Two
   things remain: contributions still refresh only at boot and on a trust decision, which is the
   user-extensions reload path, and a client bundle rebuilt mid-session prompts once because trust
   is keyed by hash and the grant was made at Electron boot.
4. **Testing rebuilds the host** — closed. `@acorn/plugin-api/testkit` hands a test the real plugin
   and request context, a temp-directory database, the auth gate and core's tables
   (`docs/testing.md § Test layers`). Roughly 147 deep imports across 37 plugin test files have yet
   to move onto it; `tools/arch/boundaries.test.ts` holds that as a baseline that may only shrink,
   and tests migrate as someone touches them rather than in a sweep.
5. **Boilerplate** — closed. The per-plugin database lifecycle, the migrations module, the vitest
   and tsconfig and drizzle configs and the frame mount all moved behind the host or a one-line
   re-export (`docs/plugins.md § Package shape`, `docs/data-layer.md § Plugin databases`).
   `package.json` was the one thing that could not be hoisted — npm has no `extends` — so its
   `exports` and `scripts` blocks stay duplicated per package.
6. **Docs generated from the running node** (user-extensions § 5): the agent-facing projection of
   the pinned surface doubles as the human reference. bb's rule transfers: never answer an API
   question from a built bundle.
7. **A scaffold, last** (`create-acorn-plugin`): one command emitting the no-bundler profile with
   the manifest pre-filled. Deliberately last per `docs/extensibility.md` — a scaffold over a
   moving contract is churn; over a settled one it is the welcome mat.

## The differentiator

Every project in `references/` with a plugin story picked one side of the trade: bb has the
magical loop with no trust boundary; herdr has a real marketplace over a socket API; the rest have
no third-party story at all. Nobody has **an agent-authored plugin loop behind a real sandbox**.
acorn's designed shape — "make my acorn look like X / build me a pane for Y" as a one-session
agent task, mediated by one human approval, iterating without prompts, distributed later through
signed per-hash consent — is the pitch no neighbour can copy without rebuilding their security
model. The DX work above is what makes it true for humans; the user-extensions folder makes it
true for agents. They are the same investment: the profile, the generated docs, and the failure
messages serve both audiences.

## Verify before building

Whether `@acorn/plugin-api` became publishable (gap 1 may be done); whether the no-bundler profile
got written as a real contract; and whether the frame bridge SDK grew members the pinned snapshot
doesn't yet show.

Three residues of the shipped work are worth checking before anyone builds on them. Three exports on
the facade are still marked `// prune candidate` because retiring them needs a new `ctx` seam that
does not exist yet — the raw WebSocket attach, the node's capability read model, and the agent-tool
renderer registry — and each says so where it sits (`packages/plugin-api/src/client/index.ts`). The
deep-import baseline in `tools/arch/boundaries.test.ts` should be lower than 147 imports across 37
files; if it is not, the migrate-as-you-touch rule is not being followed. And none of the eight items
was ever checked in a running app: plugin suites are node-environment with no Solid transform, so a
green suite is not evidence about anything rendered.
