# Terminal client: rendering plugins in a TUI

Design notes from the third-party-plugins session (2026-08-10). Nothing here is scheduled; this
records the analysis so a future project starts from conclusions instead of re-deriving them.
Companion to [remote.md](./remote.md), which covers web and mobile — a terminal client is the
third non-desktop surface, and it shares more with those two than it first appears to.

## The question

Could a plugin's UI render in a terminal? The frame tier currently assumes a DOM: a sandboxed
iframe, CSS tokens over the bridge, and (once finding 04 in `docs/third-party/` lands) a Solid
component tree. A terminal has none of that. The tempting framings are "translate the frame to
cells automatically" and "make plugins write UI in an abstraction that renders anywhere." Both
are wrong, and the analysis below says why. The right framing: **a terminal surface is a separate,
optional render target that a plugin opts into — possibly with a completely different shape than
its desktop frame.** A plugin's terminal presence might be a TUI, might be a query/command
interface, might be nothing beyond its descriptors. The author decides what the terminal version
even is.

## What already helps, and was not built for this

Three shipped decisions carry most of the weight:

1. **The bridge is transport-agnostic by rule.** `packages/client-core/src/plugins/frames/sdk.ts`
   never names `app-plugin://` or any origin — it waits for a MessagePort and speaks JSON verbs
   (`api`, `state.get`/`state.set`, `subscribe`, `ui`, `keys`). That rule was written for a future
   web client (remote.md, preparation item 3), but the same property pays off here: the only
   DOM-coupled parts of the SDK are `applyAppearance` (writes CSS variables to the document) and
   keydown forwarding. Every other verb runs anywhere JavaScript runs.

2. **The descriptor/frame split is a form-factor split in disguise.** Descriptors — rail sources,
   badges, attention items, palette rows, commands — are data the host renders with its own
   components. remote.md already drew the conclusion for mobile ("descriptors render on mobile for
   free") and it holds verbatim for a terminal: a TUI shell draws a rail row with box characters
   instead of Solid components, and the plugin ships zero terminal code. A descriptor-only plugin
   needs no trust prompt on a terminal client for the same reason it needs none anywhere else.

3. **The Rollbar frame already splits model from view.** `plugins/rollbar/src/frame/model.ts` is
   pure state with its own tests; `app.ts` is the DOM. The finding-04 Solid rewrite keeps
   `model.ts` unchanged. That split is exactly what a second render target needs — the model is
   reused, the view is swapped — and it should graduate from an accident of one plugin to written
   authoring guidance.

## What comparable systems do

- **Zellij** — plugins are sandboxed WASM; the host gives a pane rectangle (rows × columns), the
  plugin receives events and render calls, and host access is permission-gated. The closest
  existing analogue to acorn's frame model, in a terminal.
  (<https://deepwiki.com/zellij-org/zellij/4-plugin-system>)
- **OpenTUI** — a TypeScript TUI framework with a Zig render core and Yoga flexbox layout, and it
  ships a **SolidJS reconciler** (`@opentui/solid`: JSX intrinsics mapped to terminal
  renderables). Proof that "raw transpiled Solid code" and "renders in a terminal" are compatible.
  (<https://github.com/anomalyco/opentui>, <https://opentui.com/docs/bindings/solid/>)
- **Solid universal renderer** — `solid-js/universal` `createRenderer` plus the
  `generate: "universal"` compile mode: same component code, custom node operations, terminal an
  explicitly named target. (<https://github.com/solidjs/solid/tree/main/packages/solid/universal>)
- **Textual / textual-serve** — the opposite direction: the TUI is canonical and the browser gets
  xterm.js streaming that terminal over a WebSocket. Write once, both surfaces, because the widget
  tree abstracts above cells. (<https://github.com/Textualize/textual-serve>)
- **VS Code** — acorn's architecture independently derived: tree views and status bar items are
  descriptors, webviews are frames. Notably, VS Code never solved "webview in a terminal";
  descriptors are what carry its remote and web surfaces.

## Terminal support is tiered, not uniform

**Tier 0 — descriptors, free.** A terminal shell renders rail sources, badges, attention items,
palette rows and commands natively. Rollbar already works at this tier with zero new plugin
surface. Biggest value per unit of work; build this first and learn from it.

**Tier 1 — commands and queries, nearly free.** A plugin's node half already serves routes and
its manifest already declares commands. A terminal host needs a generic invoker — a palette-style
command runner, perhaps one host-owned list/detail template fed by plugin routes. This is where
the pressure to grow the descriptor verb vocabulary will appear, and the rule from
`extensibility.md` applies with full force: **the closed verb set stays closed.** If a generic
detail view emerges it is one host-owned template, never a per-plugin layout language.

**Tier 2 — an optional terminal frame.** A plugin opts in with a separate entry point; nothing is
translated automatically. The manifest surface gains a variant — the natural fit is the
already-planned `formFactor` field (default `["desktop"]`; add `"terminal"`), or a sibling bundle
target the way `client` is one today. Separate bundle, separate hash, same per-device per-bundle
trust prompt.

Per remote.md's demand analysis, most remote value was monitoring, approvals and quick actions —
tiers 0 and 1 may cover most of what people actually want in a terminal. Tier 2 should not be
built before a terminal shell exists and tier 0 has proven itself; unexercised seams rot.

## The tier-2 rendering contract

Three candidates were considered:

- **(a) ANSI rectangle — the Zellij model.** The host gives rows × columns plus input and resize
  events; the plugin returns cells/ANSI for its rectangle. Maximum freedom, minimal host surface,
  framework-agnostic — a plugin can bundle OpenTUI, Ink, or hand-rolled escape codes. The cost:
  plugin output is opaque bytes, and appearance tokens must be projected to a terminal palette by
  the host and handed over as data rather than applied as CSS.
- **(b) Host-owned widget vocabulary — the Textual model.** The plugin emits a widget tree over
  the bridge; the host renders it. Consistent look and host-controlled focus — but this is
  "grow descriptors into a UI framework," the thing the descriptor design deliberately rejected.
  Rejected here for the same reason.
- **(c) Solid universal renderer.** Once frames are Solid (finding 04), plugin components compiled
  with `generate: "universal"` could target a host-supplied terminal renderer. Elegant on paper —
  one component tree, two targets — but acorn's UI kit is CSS-class DOM components, not portable
  nodes, so "same UI on both surfaces" is mostly illusion. The genuinely reusable layer is the
  model, not the view.

**Decision, if this is built: (a), with (c) as the ergonomic default toolkit on top.** That is the
frame decision from finding 04 restated for cells: support Solid (via an OpenTUI-style reconciler)
well, keep the contract framework-agnostic, and say in the authoring guidance that other
frameworks work. "Inside its own frame a plugin bundles whatever framework it likes" — the frame
is just a rectangle of cells now.

And explicitly **no automatic translation** of DOM frames to cells. Rendering the existing iframe
through a Carbonyl/browsh-style pipeline exists as a technique and is a curiosity, not a contract:
different surface, different affordances, and the plugin author is the one who knows whether
their terminal presence is a TUI, a query prompt, or nothing at all.

## The hard problem is isolation, not rendering

This is the real design work. The two-tier trust story is honest today because the client sandbox
is *enforced*: opaque origin, `connect-src 'none'`, one MessagePort, every call checked in
`scopes.ts`. A terminal has no iframe. If plugin terminal-UI code ran in the TUI host's own
process, we would have created a third tier with the node half's weakness ("disclosed, not
contained") wearing the frame tier's enforced-permission claims — the trust prompt would lie.

The constraints that keep this buildable are already in place, deliberately. The bridge is one
port carrying request/response messages, and the fetch-shaped route handler was chosen *because*
"a live server object cannot cross a process boundary and a request/response function can"
(`extensibility.md`). So a terminal frame is a **separate contained runtime** — a child process
under real permission flags (`node --permission`, or a deny-all runtime, or WASM as Zellij does) —
with a socket or stdio pipe carrying the same bridge protocol, and the broker plus `scopes.ts`
staying host-side. Same allowlist, different transport. The realm moves; the choke point does not.

That work is also a down payment on the number-one item in `extensibility.md`'s "where this is
going": node-half containment wants the same primitive — plugin code out of process, the context
becoming authorized calls rather than an object. Design the two together rather than inventing a
terminal-only sandbox.

One more inversion to record, parallel to remote.md's: on web, the whole app comes from the node
and per-bundle prompts mostly protect plugin-vs-plugin blast radius. A terminal client pairing
with a node and receiving a terminal bundle needs the same bytes-hash trust store, but there is no
Electron main to do the hashing and hold custody — the TUI process is both shell and broker. A
terminal client therefore sits between desktop and web on the trust ladder, and the trust-model
section of `security.md` needs a third column when this becomes real.

## Decisions to carry forward

1. **Tiered, not uniform.** Descriptors render everywhere, always; terminal frames are optional
   and opt-in per surface. A plugin with no terminal entry point still shows its rail, badges and
   commands in a TUI.
2. **No automatic translation** of DOM frames to cells. A terminal surface may be a completely
   different shape, and the author chooses it.
3. **Same bridge, new carrier.** The SDK verbs are already surface-neutral and stay the single
   contract. Terminal adds a transport (process channel) and exactly one new render primitive
   (cell rectangle + input + resize), nothing else.
4. **Model/view split is authoring guidance**, not a Rollbar accident: frame state lives in a pure
   model module; views are thin and per-surface.
5. **Sequence: shell first, tier 0 next, tier 2 last** — and only once something real wants it.

## Sources

- Zellij plugin system: <https://deepwiki.com/zellij-org/zellij/4-plugin-system>
- OpenTUI: <https://github.com/anomalyco/opentui> and <https://opentui.com/docs/bindings/solid/>
- Solid universal renderer: <https://github.com/solidjs/solid/tree/main/packages/solid/universal>
- Textual web/serve: <https://github.com/textualize/textual-web>,
  <https://github.com/Textualize/textual-serve>
