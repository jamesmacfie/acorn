# Agent-authored plugins: the dev loop

Design notes from the bb-comparison session (2026-08-12). Nothing here is scheduled. This is the
core design of the folder: how the agent inside acorn gets to write, install, and iterate on a
plugin against the connected node — thereby modifying acorn — without acorn adopting bb's trust
model. Read `bb-reference.md` for what is being matched and `current-state.md` for the shipped
baseline and the four deliberate blockers this design answers.

## The framing

bb and acorn sit at opposite ends of one trade: **loop speed versus trust.** bb bought a magical
loop (save a file, see the new UI in about a second) by having no security model — full-trust
in-process plugins, a `--yes` flag past the only warning, an install route with no human
confirmation. acorn bought a real boundary — sandboxed frames, per-bundle device trust, an install
route that is *permanently unmappable* from plugin frames because prompt injection is a named
threat — at the cost of a loop that today requires a node restart, a renderer reload, and a trust
prompt per bundle hash.

The design position: **do not move along that line. Change its shape.** The human decision that
matters is "I am letting the agent develop this plugin on this device" — a decision that needs to
be made *once per plugin*, not once per save. Everything after that decision can be as fast as bb.
Concretely: a **dev loop a human enters once per plugin, after which iteration is frictionless.**

Four pieces, in build order. Each is independently useful; none requires the others to land first,
but the order below front-loads the pieces with no security surface.

## 1. The agent-authored plugin profile (no bundler)

The node ships no bundler, and shipping one is a real cost (size, supply chain, and a compile step
inside the trusted process). The profile sidesteps it: **a documented authoring contract under
which a plugin needs no build step at all.**

- **Node half:** plain multi-file ESM using only relative imports and `node:` builtins. The
  loader *already* imports this — multi-file packages work today (the builder emits chunk files),
  and what forces bundling is bare npm specifiers, since a plugin directory has no
  `node_modules`. The profile simply forbids bare specifiers.
- **Client half:** a single-file, plain-JavaScript `client.js` against the frame bridge SDK. This
  is less constraining than it sounds: a frame is a **host-generated iframe document**, not a
  component in the shell's tree, so there is no React/Solid/JSX requirement — vanilla DOM code is
  the natural fit, and the bridge SDK (`api`, `state`, `ui`, `keys`, `document`) is the whole
  surface a frame has anyway. The single-file rule is already the scheme's contract.
- **Manifest:** written by hand (it is JSON); the builder normally generates it, so the profile
  documents the handful of fields the generator fills in.

Contrast with bb, which solves the same problem twice: TS source loaded via jiti on the backend
(a TS loader inside the trusted process — refused here) and an esbuild toolchain *downloaded at
first use* for the frontend (a runtime supply-chain door — also refused).

If the profile proves too tight in practice — a plugin genuinely needs a dependency or JSX — the
escape hatches, in order of preference: the agent shells out to a dev checkout's
`build:plugin` when one exists (dev machines have Vite); only then consider shipping esbuild in
the node. Ship the loop first and let real friction justify the dependency.

**Maintainability note:** the profile must live as a documented contract (an authoring guide
that the skill in §5 embeds), not as an implicit property of what the loader happens to accept.
When the loader's tolerance changes, the contract is the thing to update deliberately.

## 2. The reload path

The biggest lift, and smaller than it looks. Target semantics — stolen from bb, which got them
right:

- **Candidate-then-commit.** A reload runs the new plugin's `init` against a candidate
  registration set; if it throws, the previous registrations stay fully live and the failure
  lands as status detail on the roster row. Only on success are the old registrations disposed
  and the map entry swapped.
- **Failure is contained, never fatal.** Same principle the host already applies at boot.
- **A stale handle throws.** The old plugin instance's `ctx` is invalidated so leaked references
  fail loudly instead of writing through dead registrations.

What exists to build on, node side: the host already has `clearRegistrations()` (idempotent
re-init) and `contain()` (per-plugin rollback at boot). The genuinely new mechanics are (a)
defeating Node's permanent ESM module cache — bb's technique is directly portable: a module
resolve hook stamps a generation query parameter (`?load=<epoch>`) onto file URLs inside mutable
plugin roots, and reload bumps the epoch — and (b) teardown of what `init` created: routes
unmounted, tools deregistered, the plugin DB handle closed before the new chain might run
(interaction recorded in `plugin-updates-and-data.md`).

Client side, acorn is **better positioned than bb**. bb hot-swaps ESM inside a live page and
accepts leaked module objects. acorn's plugin UI is an iframe keyed by bundle hash on a
content-addressed scheme — replacing it is loading a different URL, a genuinely clean swap with
nothing leaked. The only blockers are two deliberate boot-time choices: `activeBundles` is
resolved once per session, and contribution sync runs only at boot and on trust decisions. The
fix is one new signal: a **"plugins changed" event from the node** (the roster already carries
manifest + bundle hash) on which the client re-resolves bundles and re-runs both syncs. The
registries already support replacement — the client plugin host disposes-then-registers today.

Scope honestly: reload applies to **loaded plugins in dev mode**. Built-ins and
non-dev installs keep restart-required semantics — their pending-restart flow already works, and
widening live-swap beyond the dev loop buys little for the risk.

## 3. Approval-mediated install

The install route stays exactly as it is: device-gated, unmappable from frames, audited. What is
added is a path for the agent's *request* to reach the human's *decision*:

- The agent calls an **install/update-plugin agent tool** (the registry already carries risk
  tiers projected into the renderer's permission UI — this is the highest tier).
- The renderer surfaces it like any high-risk tool call, showing what the manifest declares:
  surfaces, permissions, whether it owns tables. The decision is made in the shell's UI — chrome
  a plugin frame cannot draw over.
- On approval, **the device performs the install** through the existing route with its own
  principal. The agent never holds a credential that can install code; a prompt-injected agent
  can only generate a request a human sees.

This preserves the recorded prompt-injection defence while opening the loop. It also gives
updates and uninstalls the same shape for free (same tool, same tier).

## 4. The dev trust grant

Per-hash trust is right for third-party distribution and wrong for iteration — an agent saving a
file every minute would mean a prompt per save. The grant: when the human approves entering dev
mode for a plugin (plausibly the first approval in §3, marked as dev), the device stores a
**per-(pluginId, device) grant covering future hashes of that plugin while dev mode lasts.**
Clearly badged in settings ("in development — bundle changes are auto-trusted"), revocable, and
ended by promoting the plugin to a normal install (which re-enters per-hash trust at the current
bundle). It hangs off the existing path-install seam — the symlinked local-path install that dev
builds already support — which also gives the agent an in-place directory to iterate in, bb-style.

The honest cost, stated so it is weighed rather than discovered: while a plugin is in dev mode,
the *node half* the agent writes runs with the node's own access on next load, without a per-save
human read. That is exactly the risk the human accepted by entering dev mode, and it is bounded to
plugins they chose. If `docs/security.md`'s rung-2 (out-of-process node halves) ships first, dev
mode inherits its containment — a good reason to keep an eye on that ordering.

## 5. Agent enablement (cheap, do alongside)

bb's loop works as a product because the agent is *taught*, not because the mechanics exist.
Three pieces, all with existing seams:

- **An authoring skill** — the profile from §1, the manifest vocabulary, the bridge SDK, the dev
  loop commands — injected via the existing agent-context seams (`agentContexts` /
  `contextSections`). bb's equivalent is 1,678 lines and is the single most load-bearing piece of
  its loop.
- **Generated API types/docs from the running node.** acorn already pins the plugin API surface
  as a snapshot (`packages/plugin-api/src/surface.snapshot.txt`); this is the agent-facing
  projection of it — a command or route that emits current declarations so the agent never
  answers an API question from stale memory. bb's rule is worth copying verbatim: never answer an
  API question from a built bundle.
- **A seeded prompt in Settings → Plugins** ("Create a plugin") that opens a task with the skill
  referenced. The entry point is a product decision, and bb proves a one-line seeded prompt is
  enough.

Also worth copying: bb regenerates a skill listing every installed plugin's commands, so a plugin
the agent just wrote becomes discoverable to later agent sessions. acorn's tool registry already
projects to MCP and the HTTP tool surface — after reload lands (§2), a new plugin's tools appear
without restart, which covers most of this for free.

## What keeps this maintainable

- **The profile is a contract, not a code path.** Documented, versioned with the plugin API
  major, embedded in the skill. Loader tolerance can change; the contract changes deliberately.
- **Reload semantics are written down before code** — candidate-then-commit, contained failure,
  stale-handle-throws — so the implementation has an acceptance list rather than emergent
  behavior. bb's semantics are the reference implementation to read.
- **Every new capability is a manifest declaration or an existing seam, never a new imperative
  registration.** The install tool rides the tool registry; the dev grant rides the trust store;
  the reload signal rides the roster. No new kinds of thing.
- **One new event, not a new transport.** "Plugins changed" is a roster-shaped notification; the
  client work is re-running syncs that already exist.
- **Dev mode is visibly different.** Badged in settings, distinct in the roster, auditable. The
  moment dev-mode behavior is indistinguishable from normal installs, the trust story has rotted.

## Verify before building

Whether `activeBundles` is still session-pinned and contribution sync still boot-only (the §2
client fix assumes both); whether the tool registry's risk-tier permission flow still surfaces in
the renderer the way §3 assumes; whether local-path installs are still dev-gated
(`allowLocalPath`); whether rung-2 process isolation shipped (changes §4's risk paragraph);
and whether the loader still accepts multi-file relative-import ESM without a build (the §1
profile's load-bearing fact).
