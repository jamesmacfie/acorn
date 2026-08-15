# "acorn as shell" versus the permanent tier line

Design notes from the ecosystem-feasibility session (2026-08-14). This file records the one place
the ecosystem vision collides with a decision this repo already made and defends — and the stance
adopted, so a future session argues with the reasoning instead of rediscovering the tension.

## The collision

The vision: acorn becomes a shell. A small core owns only what security requires and what is so
universal it belongs to everyone; everything else is a plugin, and users compose their acorn from
plugins the way they like.

The recorded decision it walks into: `docs/extensibility.md § Two tiers, permanently` declares an
enumerated set of contributions first-party-only, forever — WebSocket stream/channel ownership,
components rendered inside the shell's own tree, Electron main-process code. And explicitly: "the
second tier will not grow until it can do everything the first can" is *not* the plan. When a
third-party plugin needs one of those, the recorded answer is review and adoption into
first-party, not a wider sandbox.

The proof case is Monaco (`docs/third-party/README.md`, `docs/third-party/monaco.md`): a single-file
editor frame measured 7.93 MiB against the 8 MiB cap and its language workers were undeliverable
under the frame CSP. The answer was a **host-owned document surface plugins borrow** — core grew
so the sandbox didn't have to widen. Expect that pattern to repeat for every heavyweight surface:
terminals, result grids, anything with workers or real bulk.

## The stance

**Keep the tier line. Bend the vision's letter, keep its spirit.**

The thin-shell reading requires either accepting that terminals, agent stream rendering, and the
editor can never be plugins (at which point the shell is not thin), or reversing a security
boundary this repo built deliberately and documents well. Reversing it buys ideology and costs the
one thing that differentiates acorn from bb: a real trust boundary under a self-modification loop.

The spirit survives intact, because the repo already points at it from the other direction:
`docs/third-party/README.md` records that the long-term answer to the first-party/loaded asymmetry
is to **confine compiled plugins too, not to unconfine manifests**. Followed to its end, that
produces exactly the right shape:

- **Core owns**: security (trust, tokens, cert pinning, audit), transport (broker, listener,
  frame bridge), the workspace/task/project model, and a small set of host-owned *surfaces* —
  the document surface, the terminal, the dashboard renderer — that plugins borrow through
  vendor-neutral contracts.
- **Plugins own**: everything integration-shaped (GitHub, Linear, Rollbar, model providers),
  data-shaped (collections feeding dashboards), and workflow-shaped. Five first-party plugins
  already live on the loaded tier; the direction is that the rest follow as each move exercises
  a real seam — never for tidiness (`docs/extensibility.md § Unexercised seams rot`).

Call it what it is: **a fat, opinionated core with a plugin ecosystem around it** — closer to
VS Code's actual shape than to its "everything is an extension" folklore. Users still get the
composable acorn: dashboards, third-party sources, panes, tools, themes, cross-plugin
contributions. What they don't get is a marketplace terminal replacement, and that is a feature
of the trust story, not a failure of the vision.

## The differentiator this buys

Worth stating separately, because it is the thing the trade above is *for*, and it survives every
argument about how thin the shell is.

Every project in `references/` with a plugin story picked one side of the trade: bb has the magical
loop with no trust boundary; herdr has a real marketplace over a socket API; the rest have no
third-party story at all. Nobody has **an agent-authored plugin loop behind a real sandbox**. acorn's
shape — "make my acorn look like X / build me a pane for Y" as a one-session agent task, mediated by
one human approval, iterating without prompts, distributed later through signed per-hash consent — is
the pitch no neighbour can copy without rebuilding their security model. That is also why the ordering
in `work-plan.md` puts containment before discovery: the differentiator is the boundary, so shipping
discovery over uncontained node halves would be spending it.

The loop is live and the front door is open (`npm create acorn-plugin`, `acorn-plugin-sdk`). Rung 2
(`blockers.md § 1`) is what lets strangers join.

## What this stance implies for "only where security needs it" first-party plugins

The phrase in the vision — first-party only "where security needs it and the functionality is so
common it warrants it" — is already how the tier line is drawn, with one addition this file makes
explicit: **first-party is also where the sandbox measurably cannot serve the surface.** The
Monaco finding is the template. When a surface class fails the frame contract, the move is a
host-owned surface with a borrowed contract, and that contract becomes part of the shell's public
API to plugins. Each such surface should be treated the way the document surface was: designed
once, vendor-neutral vocabulary, plugins as consumers — recorded in `docs/plugins.md` when it
ships.

## Revisit conditions

Revisit the thin-shell letter only if rung-3 containment (OS-level sandboxing of plugin node
halves) ships *and* a frame-tier successor exists that can serve worker-hungry, multi-megabyte
surfaces without widening the trust story — both at once. Short of that, the fat-core shape is
the honest end state, and roadmap language should say "shell" only in the composability sense.
