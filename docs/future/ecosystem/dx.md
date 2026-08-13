# World-class plugin DX: the bar, the gaps, the differentiator

Design notes from the ecosystem-feasibility session (2026-08-14). Nothing here is scheduled. The
detailed findings live in `docs/future/debug-plugin/` (eight files, each with a plan); this file
adds what that review scoped out — the external author, who was not its subject — and states the
bar the ecosystem goal actually requires.

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
- **The API surface is pinned** — six entrypoints, snapshot-tested
  (`packages/plugin-api/src/surface.snapshot.txt`), gated by `PLUGIN_API_MAJOR`.
- **Storage is host-owned.** Declare a Drizzle migration chain; the host opens, migrates, and
  contains failures per plugin.

## The gaps, in the order to close them

1. **The facade doesn't install.** `@acorn/plugin-api` and `/ui` are workspace-only
   (`docs/extensibility.md § Plugins get building blocks` records this as accepted-intermediate).
   Publishing it is packaging work plus one real decision: the compat promise. The snapshot test
   and API major already exist; the promise is "your plugin keeps loading within a major." Without
   this, nothing else on the list matters to an external author.
2. **Failures misreport** (`debug-plugin/01`) — the widest-reach fix and the review's own first
   pick. An author whose plugin silently doesn't appear will not file a bug; they will leave.
3. **The loop is restart-shaped** (`debug-plugin/02` + user-extensions reload path + dev trust
   grant). Watch mode, no prompt per save, contributions refresh live.
4. **Testing rebuilds the host** (`debug-plugin/03`). A testkit that boots a minimal node host,
   loads one plugin, and hands back typed handles. The review reopened this deliberately; the
   evidence held.
5. **Boilerplate** (`debug-plugin/04`) — ~90 identical lines per loaded plugin belong behind the
   facade.
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

Whether `@acorn/plugin-api` became publishable (gap 1 may be done); how much of the debug-plugin
list has landed; whether the no-bundler profile got written as a real contract; and whether the
frame bridge SDK grew members the pinned snapshot doesn't yet show.
