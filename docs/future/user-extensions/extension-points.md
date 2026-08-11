# New extension points

Design notes from the bb-comparison session (2026-08-12). Nothing here is scheduled. Three new
extension surfaces in priority order, each chosen because agent-authored plugins
(`agent-authored-plugins.md`) make them valuable and because acorn's existing seams make them
cheap — plus the one bb mechanism this folder explicitly refuses. The shipped baseline these
extend is inventoried in `current-state.md § Contribution inventory`.

## 1. Themes as validated tokens

**The gap.** acorn's appearance system has two orthogonal axes — `data-theme` owns colour,
`data-style` owns shape/type/space/density — and the token contract exists *as data*
(`packages/client-core/src/ui/tokenAxes.ts`), test-enforced against the stylesheets. The
registries (`themes.ts`, `styles.ts`) already exist, and a code comment anticipates plugin-
contributed style packs. But neither registry is reachable from any plugin context, there is no
manifest key, and there is deliberately no CSS-injection path: the shell stylesheet is
host-assembled, and a loaded plugin's CSS is confined to its own frame.

**The design — and why it beats bb's.** bb accepts a raw CSS file per theme (size-capped,
namespaced, user-selected, falls back when the owner is disabled — all good product decisions to
copy). But raw CSS is an injection surface and can break anything. acorn can do better *because
the token contract is data*: a plugin theme is a **manifest-declared map of theme-token values**,
validated by the host against `THEME_TOKENS` — every required token present, no unknown keys,
values parseable as colours — and the host generates the `:root[data-theme="plugin:<id>:<theme>"]`
block itself. No plugin-authored CSS ever reaches the shell. It cannot break non-colour styling
because it cannot express anything but colour tokens.

Product behavior to copy from bb: namespaced ids (`plugin:<pluginId>:<themeId>`), selection in the
existing appearance settings alongside the built-in twelve, automatic fallback to a default when
the owning plugin is disabled or removed.

Scope: **colour themes first.** Style packs are the same shape mechanically, but style tokens
touch layout and density, where "cannot break the app" is a weaker promise — do them second, as a
separate manifest key, so the theme seam is not blocked on the harder judgment. Respect the axes:
one contribution never spans both.

Why first: it is the ideal opening self-modification demo — "make my acorn look like X" is a
one-session agent task with a visible result and *zero* new attack surface, precisely because the
seam is validate-and-generate rather than inject.

## 2. Declarative chrome, not more iframes — and context menus

**The gap.** The manifest slot vocabulary is `footer` only, while the host has topbar slots, a
drawer, task-row slots, and more — all compiled-plugin-only. And **no context-menu registry exists
anywhere in the client**, for any tier.

**The design.** Resist the obvious move (open the existing slot ids to iframes). An iframe is the
wrong shape for small chrome: a status chip or menu item costs a process-isolated document and can
never look native. acorn already proved the right model three times — attention badges, node
stats, and commands are all **descriptors the plugin declares and the host renders**, bound to
the closed action-verb set (`openPane`, `navigate`, `runNodeAction`, `openUrl`, …). Grow that
vocabulary:

- **Status-bar / topbar items**: icon + label + optional badge count from a plugin-declared data
  route (the `nodeStats` / `attention` pattern), action from the verb set.
- **Context-menu contributions**: the registry has to be built for anyone before plugins can have
  it; design it declarative from day one. A contribution is a menu location, a label/icon, a
  `when` over the host-defined context shape (which resource kind is under the cursor), and a verb
  — the verb set means a menu item can do exactly what a command can do, nothing more. This is a
  place to apply the build-the-seam-anyway principle: core's own menu items become the registry's
  first consumers so the contract is real before the first plugin touches it.

Keep iframes for what they are for: rectangles with real UI inside. The rule of thumb worth
writing into the plugin docs: **descriptors for chrome, frames for rectangles.**

## 3. Cooperative cross-plugin extension

**What bb teaches, positively and negatively.** bb has no formal inter-plugin API and mostly gets
by — sanctioned RPC between plugins, arbitration where surfaces collide. Its de facto universal
mechanism, though, is content scripts: any plugin can rewrite any other plugin's rendered DOM.
That is not an extension point; it is the absence of a boundary, and it is exactly what acorn's
realm separation exists to prevent. **Refuse it** (see below). But bb also demonstrates the
positive pattern worth stealing: the *exclusive slot*. A plugin can register a replacement for
bb's sidebar thread list, and registering does not seize anything — **the user picks the provider
in settings**, and bb falls back to its own list if that plugin is disabled or crashes.

**What acorn already has.** All cross-plugin interaction today is host-mediated with provenance
the host stamps: capabilities (`provide` is deliberately open — "exporting a capability is a
contribution, not an access grant" — `get` requires declaring the id), content links plus ref
resolvers (host scans, host stamps `providerId`, never read from the body), and cross-plugin ref
panels. The hard nos are load-bearing: a frame cannot call another plugin's routes or fetch
another plugin's bundle.

**The gap.** Plugin B cannot add anything *inside plugin A's surfaces*, even when A would welcome
it. The github plugin cannot accept a "linked Linear issues" section from the linear plugin
without importing it — which is the coupling the registries were built to remove.

**The design: two-sided, declarative, host-mediated.**

- Plugin A's manifest declares **extension points it hosts**: an id, the surface it appears in,
  and the shape of contributions it accepts (a descriptor schema — items with icon/label/detail
  and actions from the closed verb set).
- Plugin B's manifest declares **contributions to A's point** by id — both sides declared, both
  visible at install/trust time, the same shape as every other manifest key.
- The host mediates delivery: B's descriptors (from a data route of B's, the `refResolvers`
  pattern) are handed to A's surface with provenance stamped, rendered either by the host in a
  slot A's layout reserves, or passed over A's frame bridge as data for A to place. **Never
  components in A's realm** — the same reason the first-party-plugins doc gives for why in-realm
  composition is banned; descriptors and verbs cross the boundary, code does not.
- A ships no code to *be* extendable beyond declaring the point — but A **opted in**. There is no
  uncooperative extension.
- Alongside it, adopt bb's exclusive-slot pattern for **core** surfaces: a plugin may declare a
  replacement for a designated core surface (the rail's task list is the natural first), the user
  arbitrates in settings, and the host falls back to core's implementation on failure. This is
  "agent, replace my task list with one I like better" — without any plugin fighting another for
  the spot.

This is the build-the-seam-anyway principle applied one level up: contracts between plugins are
designed like contracts between plugin and host, even while the first consumer pair is
first-party.

## What is refused, on the record

**bb-style content scripts / uncooperative extension.** Any mechanism that lets plugin B alter
plugin A's UI or behavior without A's declared consent — DOM access to another realm, patching
another plugin's registrations, reading another plugin's routes. bb documents its version as
"trusted same-origin page code, not a security sandbox," which is honest, and is the whole
problem: it makes every plugin part of every other plugin's attack surface and makes A's behavior
undebuggable from A's own source. If a real need surfaces that cooperative points cannot express,
the answer is to widen the descriptor vocabulary, not to open the realm.

## Verify before building

Whether the token contract is still data with a test enforcing stylesheet parity
(`tokenAxes.ts` — the themes design depends on validate-and-generate being possible); whether the
two-axis theme/style model still holds; whether the manifest slot enum grew in the meantime;
whether a context-menu registry appeared; and whether the closed action-verb set gained verbs
(each new verb automatically widens what menu items and cross-plugin descriptors can do — check
that is still intended).
