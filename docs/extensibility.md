# Extensibility: what we are building and why

`plugins.md` describes how the plugin system works. This file is why it is shaped that way, what
we were trying to achieve, and where it is going. It exists because the reasoning behind these
decisions is not recoverable from the code, and several of them look arbitrary — or look like
gaps — until you know what they are protecting.

## The goal

**Anyone should be able to extend acorn without forking it, and installing something from a
stranger should not be a decision you have to be an expert to make.**

Those two halves pull against each other, and nearly every decision below is where they were
balanced. A system that can be extended arbitrarily is one where installing anything is a leap of
faith; a system that is perfectly safe usually cannot be extended enough to be worth it.

## Why loadable JavaScript, and not external processes

The obvious alternative — and what comparable tools do — is language-agnostic executables driving
a CLI: a plugin is any program, invoked with arguments, calling back through a command-line
interface. It was considered and rejected.

It abandons the trust posture the rest of the product is built on: acorn hands child processes
task-scoped tokens and never gives them provider credentials, and a plugin that is an arbitrary
executable is outside all of that. It would also duplicate the contribution system as a
second-class CLI surface, and it cannot participate in the renderer at all — so every plugin with
a UI would be impossible, which is most of the interesting ones.

The deciding factor was that the architecture had already been built for loadable JS without
anyone framing it that way. Plugin wire contracts were already plugin-owned, per-plugin SQLite
files and migration chains already existed, the per-node disable set already existed, and both
plugin hosts already owned registration disposal for clean re-init. The loader was the missing
piece, not the premise.

## Two tiers, permanently

Built-ins compile into the binary and run in the shell's own realm. Loaded plugins are installed
at runtime and run sandboxed. This is not a transitional state — the second tier will not grow
until it can do everything the first can.

**The line is: can the contribution be expressed as data plus asynchronous messages?**

If yes, it can be sandboxed. Panes, reference panels, settings pages, importers, overlay pickers, rail
sources, badges, palette rows, attention items, node stats, content links, commands, keybindings,
typed record sets, webviews, managed agent harnesses — all of these turned out to be expressible that
way, several of them only after someone looked properly.

Harnesses are the sharpest case, because the same line runs *inside* one feature: an ACP-speaking agent
is a launch spec and a stream of asynchronous messages, so it is data and it sandboxes; Codex's
app-server carries fork, compaction, archive and delete, which ACP cannot express, so it stays a native
driver. Same question, two answers, in one place. See
[managed-agents.md § Harnesses](./managed-agents.md).

If no, it needs the shared realm and stays first-party. That is a short list: owning a WebSocket
stream or channel (the transport itself, not a consumer of it), components the shell renders
*inside its own tree* at a place it has not opened as an extension point, code that runs in the
desktop shell itself, and publishing something core cannot start without.

That third item used to be much longer. A card in a transcript, a section in somebody else's tray, a
panel body: each looked like "a component inside another component" and each is an extension point
with two render paths now. Before adding to the list, ask whether the owner could open a point
instead. Usually it can.

The test is easy to get wrong in one specific way, and we got it wrong: **"another plugin renders
it" is not the same as "embedded in a render tree."** A reference panel looks like the first and is
actually the second — it is a rectangle the host places, so it sandboxes fine. When something
looks first-party-only, check whether it is genuinely a component inside another component, or
just a rectangle with an owner.

The panel is the worked example rather than the thought experiment. github's `PullDetail` used to
render linear's panel beside a PR, which is what B looks like; now github calls
`openRefPanel({ providerId, displayId })` and the shell draws it in one place. A plugin holding
another plugin's component became a plugin naming an item, which is data, and Linear ships its panel
as a sandboxed frame today. The coupling could be deleted rather than defended, which is the point:
the list is for components that *must* sit in someone else's tree, and a panel never had to.

When a third-party plugin needs something on the first list, the answer is review and adoption into
first-party — not a wider sandbox. Ergonomics is never a reason to widen it.

## First-party is a reason, not a status

Being in the binary is not a privilege, and "it is ours" is not an argument. Every plugin that
stays first-party should be able to name which of the four reasons applies to it, and
`first-party-plugins.md` is that audit.

The audit is worth doing periodically because the answers change. GitHub — the most
privileged-looking plugin in the tree — turned out to need almost nothing: it stopped being
`required`, its content links became declarative, and what actually keeps it in the binary is one
capability with a consumer. Rollbar turned out to need nothing at all and has moved out entirely.
Several plugins looked privileged only because a carrier had not been built yet, which is a gap
rather than a law, and the audit is how you tell those apart.

## The Node distributes; the device decides

A plugin is installed on a **Node**, and that Node serves its client bundle to every device that
pairs with it. This falls out of the fleet model: a client may be looking at a Node it has never
seen, whose plugins it does not have, and the app artifact must never ship third-party code.

The consequence is that a Node hands a device code to run, which inverts the usual trust
direction. So:

- **Trust binds to bytes the device hashed itself**, never to what a Node claims. A compromised
  Node can lie in its listing; it cannot lie about what it actually sent.
- **Consent is per device and per bundle.** Pairing a new machine asks again. An update re-asks,
  showing what changed.
- **Nothing a Node pushes runs automatically.** Rejected or undecided bundles register nothing —
  not frames, not chrome.

## Data, code, and pixels

Plugin UI splits three ways, and the split is not about effort. Ask in this order and take the first
that fits.

A **descriptor** is data — a rail row, a badge, a palette entry, a mark under somebody else's diff
line — that the host renders with its own components, fetching content from the plugin's own routes.
Descriptors exist because an iframe for a 20-pixel badge is absurd, but the real reason is that
**chrome has to be live when no plugin UI is mounted anywhere**. A badge cannot depend on plugin UI
code running, so its data comes from the plugin's Node half, which always is.

A **tree** is the plugin's own code, running in a sandbox with no DOM, emitting names of the host's
own components. The host draws them, so the result has the shell's focus handling, keyboard model,
ARIA and the reader's chosen style pack — none of which an iframe can borrow. This is where a pane, a
reference panel, a settings page and a card in somebody else's list live. Every loaded plugin acorn
ships draws this way.

A **rectangle** is a sandboxed iframe on its own origin with no network of its own, for the surfaces
whose pixels are the product: a canvas, a charting library, a rich editor, a page of arbitrary HTML.
Inside one the plugin can use any framework it likes, and it is priced honestly as DOM-only.

For a long time there were only two answers, "descriptors for chrome, frames for rectangles", and that
pushed every pane into an iframe by default. The middle answer is what changed. It also un-stuck the
thing the two-answer split kept costing: Rollbar's rail lost its connection, level and environment
filters on migration, because a descriptor row cannot express a filter. The old response was to move
that exploration into a frame and accept it looking foreign. Now it is a tree, drawn from the host's
own controls.

What did **not** change is why descriptors stay small. **The closed verb set stays closed**; every
time it is widened for one plugin's convenience, every future plugin inherits a larger thing to get
wrong. When somebody asks for a conditional in a descriptor row, the answer is a tree, not a bigger
descriptor. [docs/plugins.md](./plugins.md) § Descriptors for facts, trees for UI, rectangles for
pixels carries the argument, including why a component tree is not the static widget schema this
project has refused twice.

The furthest that tier goes today is a **collection**: a plugin declares a typed set of records —
seven semantic field types, five roles — and the host composes user-owned panels over it
([dashboards.md](./dashboards.md)). It is worth knowing why that is not the failure mode above.
Widening the verb set trades a bounded vocabulary for one plugin's convenience; a collection widens
nothing for one plugin, because the host draws its own generic surface and the uniformity across
providers is what the feature *is* — two plugins' rows can share one board only because neither of
them draws anything. The same budget discipline applies with the same words: a field type added is a
rendering rule every provider inherits forever, and the overflow path is a frame pane. Both feeders —
`contributions.collections` in a manifest and `ctx.collections` from a compiled plugin — land in one
client registry (`client-core/src/host/registries/sources/collections.ts`), and nothing downstream can tell which
supplied a collection. That is the strongest form of the descriptor argument: a stranger's plugin gets
panels that ship no client bundle, raise no trust prompt, and are pixel-identical to a first-party
one's under every appearance pack.

## Plugins may extend each other, and only by invitation

The same split applied one level up, and it kept all three answers. A plugin declares, in its
manifest, a place inside one of its own surfaces that other plugins may fill; another plugin declares
— also in its manifest, also by id — what it puts there. What it puts there is one of five kinds, and
the kind is a field on the point: **rows** and **annotations** are descriptors, **remote** is a tree,
**rectangle** is an iframe the host places as a sibling, and **hook** is not a drawing at all but a
turn in a decision before it happens ([plugins.md](./plugins.md) § Cooperative extension points). The
host carries whatever it is from one plugin to the other, stamps whose it is, and draws or runs it
itself.

Three things about that are the design rather than the implementation:

- **Both sides are declared.** Nothing is inferred and nothing is discovered at runtime. An owner
  installing either package sees "this plugin opens a list to others" or "this plugin adds rows to
  that plugin's list" in the trust prompt, before any of it runs.
- **A opted in.** There is no uncooperative extension, and there will not be one. bb's answer here is
  content scripts — any plugin may rewrite any other plugin's DOM — which it documents honestly as
  "trusted same-origin page code, not a security sandbox". That is not an extension point; it is the
  absence of a boundary, and it makes every plugin part of every other plugin's attack surface. DOM
  access into another realm, patching another plugin's registrations and reading another plugin's
  routes are all refused, permanently. **If a real need cannot be expressed as a cooperative point,
  the answer is a wider vocabulary, not an open realm** — and which vocabulary depends on which of the
  three tiers the need is. Memory's editable section inside context's tray was the case that used to be
  cited as a permanent cost; it is a `context:section` contribution now, drawn from kit nodes, because
  the tier between a descriptor and an iframe arrived.
- **Registering never seizes anything.** The related pattern for *core's* surfaces — a plugin offering
  to draw acorn's own rail task list — is an offer, not a claim. The user arbitrates in settings, and
  core is what draws whenever the chosen provider is missing, disabled or broken. bb's exclusive slot
  is the source of that shape and the one mechanic worth taking from it wholesale.

The node has the same seam, and gained it later than the client did
([plugins.md](./plugins.md) § Node-side extension points). Its absence had a shape worth naming: for a
while the node's only plugin-to-plugin door was a capability, which is single-provider by construction,
so every "many plugins each add one of these" case became a private registry inside whichever plugin
needed it first. Workflows had one for step kinds, policies and triggers, with its own duplicate check
and its own disposer convention, and the next such case would have got a fifth one slightly different
again. The rule that fell out is short enough to keep: **a capability when there is one right answer,
an extension point when there are many.**

Two differences from the client's, both deliberate. Node contributions carry **functions, not
descriptors**, because nothing crosses a realm boundary — both tiers of plugin run in the node's own
process, and rung 1 is least privilege for cooperative code rather than a sandbox. And there is **no
manifest half yet**: a point is opened and filled through `ctx`, which is enough while the contributions
are functions. A manifest form would need a route-shaped contribution, which is a different design and
waits for a case that wants it.

## Plugins get building blocks, not just a boundary

A sandbox that isolates a plugin and then leaves it to rebuild a button is a sandbox nobody enjoys
writing against. A plugin author gets acorn's own components — buttons, fields, badges, pickers, the
diff viewer — so a plugin looks and behaves like the rest of the app without effort, and so the work
of making a plugin is the plugin's own logic rather than its chrome.

The kit is **closed**, and that is the part that turned out to matter most. Every component a plugin
may draw with is in one list; a node's props are role tokens, content, counts, booleans and handlers,
and never `class`, `style` or a DOM attribute passed through
([docs/ui-design.md § The closed kit](./ui-design.md#the-closed-kit)). Closing it is what lets the
same source render two ways — compiled in this process, or in a worker with no DOM at all — and it is
what keeps a second host, a phone or a terminal, from being a rewrite.

Two earlier decisions are what make this possible, and neither was made for this reason:

- **A sandbox is a separate realm.** A second Solid instance inside one is not the failure the shell
  guards against — a frame has a different document and a different bundle, a worker is a different
  thread, and neither shares a reactive graph with the shell. The hazard only exists when two Solids
  share one realm.
- **The design system is enforced-pure.** `client-core/src/kit/` is props-in, DOM-out with no
  data-layer imports, checked by the boundaries test. That rule was written for contract hygiene;
  its payoff is that those components drop into a sandbox with no query client, no shell context and
  no host services.

Today the components are reachable as `@acorn/plugin-api/ui`, which is a workspace dependency —
fine for plugins in this repo, not yet resolvable for a genuinely external one. **That is an
accepted intermediate state, not an argument against using them.** A plugin written against these
imports today is written against the right surface, and only the package name would change. The
alternative — hand-rolling UI until the packaging is finished — produces exactly the reference
implementations we do not want people copying.

What shipped in front of it is the **bridge**, as `acorn-plugin-sdk`
(`docs/plugins.md § What is published`): framework-free, dependency-free, and publishable because its
whole declaration is six functions somebody can hand-write and review. The component kit is not that.
Publishing it means a Solid peer dependency, a bundled slice of client-core, and prop types for forty
components — which is a declaration rollup, and therefore the API Extractor this monorepo deliberately
does not have. So it stays a workspace dependency until an out-of-tree plugin actually wants it, and the
gap is smaller than it sounds in the meantime: the host already serves `/ui.css` at every plugin origin,
so an external frame gets acorn's own chrome from `class="ui-btn"` with no JavaScript, no types and no
package at all.

The host-generated frame document links `/ui.css`, assembled from the same presentation-only
stylesheets as the shell, and the appearance bridge projects the complete theme and style token axes.
That is the answer for a rectangle, which is the only thing that still draws its own pixels.

For a tree the question does not arise: a plugin writes JSX against
`@acorn/plugin-api/ui/tree`, the builder compiles it to node names rather than DOM, and the styling is
the host's because the host is what draws. Every plugin acorn ships draws that way now, and none of
them ships a stylesheet — an arch rule refuses one. The `framework` key each plugin used to name is
gone with them.

## The host binds every namespace

The rule that came up more than any other, in more disguises than expected:
**anything a plugin supplies that names something is a claim, not an authority.**

Route prefixes, contribution ids, provider ids, command ids, keybinding ids, task origins, task
link connections — all of these are bound or verified by the host, from the manifest as the host
read it, never from a value inside plugin code or a route response.

We got this wrong three separate times, in three different places, and each time it looked
reasonable in isolation: a permission list rendered from manifest text under a heading that said
"enforced"; a task origin taken from a route body so a migrating plugin could keep its old value;
a facet handing over every provider's mappings and trusting the caller to filter. None was
exploitable in a dramatic way. All three were the same mistake.

If you are adding a plugin surface, assume this is the failure you are about to make.

## The node half is isolated

A loaded plugin's server code runs in a dedicated permission-scoped worker realm. Its
`permissions.node` block shapes the owner-bound context sent over RPC and the worker's network and
child-process grants. The worker can read its package and, when it owns migrations, its exact SQLite
files; it cannot directly load `node:sqlite`, open core or peer databases, create raw sockets, load
native addons, or start nested workers.

Every surface renders those host and runtime grants as *enforced*. Plugin-authored schedule and task
check behavior stays *declared*: acorn controls when and where it executes, but cannot verify intent.
The route to an OS adversarial and crash boundary remains rung 3 in `security.md`; the current worker
boundary deliberately preserves the public plugin API, including its synchronous registration seams.

A synchronous seam costs the calling thread. The caller sits in `Atomics.wait` until the other realm
answers, and on the host that thread is the node's event loop, so nothing else on the node runs in
the meantime. Two rules keep that bounded. Each realm answers a synchronous call the moment it
arrives, ahead of any promise-shaped work already in flight, because a route handler waiting on the
blocked realm would otherwise leave both sides waiting on each other for good. And a call that goes
unanswered for five seconds throws instead of waiting, so a plugin worker that crashed or wedged
costs one call rather than the whole node. Anything a plugin exposes across a synchronous seam has to
return straight away.

Promise-shaped calls run concurrently. One route waiting on a slow third party does not stop the
plugin answering anything else, which matches how a compiled plugin already behaves.

## Bundled plugins: shipped, but loaded

Moving Rollbar out of the binary created a category the product did not have: **plugins we ship,
loaded rather than compiled.** The app stages them as ordinary packages and seeds them into the
data root, so an existing user notices nothing on upgrade.

It is worth understanding why this is not a workaround. A bundled plugin runs on exactly the same
path a stranger's plugin does — same manifest, same loader, same sandbox, same permission shaping.
Its only difference is provenance: the bytes came from the app the user already installed, so they
do not need a separate trust prompt. That makes every bundled plugin a continuous, real test of the
loaded tier, which is the point.

The lifecycle policy is generic on purpose, because the remaining migrations need it: seed when
missing, update when the app's copy changes, never overwrite one the owner installed themselves,
and remember an uninstall so an upgrade cannot resurrect it.

## Unexercised seams rot

The most repeated lesson, and the one most likely to be forgotten.

Every significant gap found in this system was found because **no production plugin walked that
path**. A post-implementation review found three real defects in exactly the places nothing
exercised. The route seam built for loaded plugins shipped with no caller and stayed that way
until a plugin finally used it — at which point it was found to be bypassable through a door
nobody had gated.

So: prove seams with plugins that have to keep working, not with fixtures. A fixture passes
because it was written against the seam; a real plugin fails when the seam is wrong, and someone
notices because they use it. This is why migrating a working integration was worth the risk, and
why the next one should be too.

The corollary is a real constraint: **do not migrate for tidiness.** A working plugin moved for
neatness buys nothing and risks a regression. Move one when it will exercise something nothing
else does, or when the plugin genuinely wants its own release cadence.

## Some decisions that look like gaps

Recorded because each has been questioned, and each answer is deliberate:

- **The shell stays SolidJS.** Framework choice used to matter for the ecosystem; once plugin UI
  moved into frames, it stopped. A plugin author can already use React inside their own frame. The
  host's framework is now a private implementation detail, and the workload — a dense, always-on
  shell with live panes and streams — is what fine-grained reactivity is for. What would reopen
  this is a decision to let third-party components render inside host surfaces, which is the tier
  line we do not intend to cross.
- **A frame cannot claim the escape hatches.** `Escape`, the palette, settings and task switching
  can never be captured by a plugin surface. Whatever a frame is doing, the user can always get
  out and open the palette.
- **Plugins cannot bind unmodified keys.** Bare keys belong to text entry, and a plugin claiming
  one is a footgun for every other surface.
- **Existing keybindings always win.** A plugin never displaces a binding that already worked, and
  a plugin installed later never displaces an earlier one. The loser is unbound and labelled, not
  silently remapped — but the user outranks all of it, and an explicit rebind is honoured even
  when it takes a core chord.
- **No `when` expression language, no key sequences, no auto-assigned fallback chords.** Each is a
  small feature that becomes a permanent surface.
- **Discovery, if it ever exists, will be unreviewed.** Trust is enforced on the user's devices at
  install and load time, not by vetting a listing. Anything that implies review by listing would
  be a promise we cannot keep.

## Where this is going

Roughly in order of how much they matter:

1. **Node-half containment.** The one honest weakness. Everything else is defence in depth around
   a server half that is disclosed rather than contained. One step of it is paid: every table-owning
   built-in now gets its database from the host's `ctx.storage` seam instead of opening one itself, so
   six plugins stopped naming a data root and a chain directory, and the host owns the whole
   open/migrate/close lifecycle for both tiers (`docs/plugins.md § Data ownership`). That is confinement
   of an existing seam, not a tier migration — the plugins stayed compiled.
2. **The editor plugin's move, the last one.** The migration candidates are done being candidates.
   http moved first with tables; database followed over the **document surface** — the host owns one
   editor and lends it through a vendor-neutral contract (`docs/plugins.md § Document surfaces`,
   design record `editor.md`). That surface exists because a Monaco frame measurably cannot be
   served: 7.93 MiB against an 8.00 MiB cap with a stub UI, and its language-service workers denied
   outright by the one-file origin and a CSP with no `worker-src`
   (docs/first-party-plugins.md § First-party only by history) — the first surface class the sandbox
   demonstrably does not serve, answered by widening nothing. Editor itself stays compiled for that
   reason and no other: both its surfaces are host layouts filled with kit nodes now.
   linear, earlier, was the one that found a capability the tier cannot carry rather than merely
   reshape (docs/loaded-plugin-migration.md § What is still owed).
3. **The carriers that were missing have answers.** `agentContexts` has a form and real callers;
   `overlay` is a frame target opened by the `openOverlay` verb (unexercised end to end until a plugin
   declares one); `persistedState` deliberately gets no manifest form — the frame's
   `state.get`/`state.set` is the tier's store, with the cost named in `docs/plugins.md`.
4. **Ecosystem, if and when it is wanted** — discovery, a scaffold, an authoring guide, a written
   compatibility policy. Deliberately last: none of it is worth building before a plugin someone
   outside this repo actually wants to ship. The authoring guide shipped as
   `docs/plugin-authoring.md`, and the scaffold as `packages/create-acorn-plugin` — both once the
   contract stopped moving, which was the whole reason for the ordering. Discovery and the written
   compatibility policy are still ahead (`docs/future/ecosystem/`).
5. **The control plane, which is a plugin like any other.** A node can enroll with one at first boot
   (`docs/node-enrollment.md`), and a plugin can contribute a node provider that puts nodes in the
   fleet (`docs/plugins.md § Node providers`). Both seams exist and both are inert unless configured.
   The rule they were built under is the one this document's "unexercised seams rot" section predicts:
   a first-party control-plane plugin gets no host privilege a third party lacks, and the reference
   provider (`plugins/nodes-file`) is deliberately a loaded plugin whose manifest grants only its
   environment-configured inventory file, so
   the seam has a consumer before it has a business behind it.
6. **Web and mobile**, analysed in `future/remote.md`. The plugin work quietly prepared for it —
   the sandbox is standard web platform, and the client's platform-specific access sits behind one
   adapter — but the hard parts are auth and reachability, not plugins.

## Related

- [contribution-kinds.md](./contribution-kinds.md) — every contribution kind, its tier, where it is
  declared, and for each single-tier kind, whether it stays that way.
- `plugins.md` — how both tiers work today.
- `first-party-plugins.md` — which shipped plugins are first-party because they must be.
- `security.md` — trust boundaries, the node-half threat model, and the containment ladder.
- `command-palette-and-shortcuts.md` — commands, shortcuts, and plugin bindings.
- `loaded-plugin-migration.md` — the review record from the first migration out of the binary.
- `future/remote.md` — web, mobile, and remote access.
- `tui.md` — the terminal client: `acorn` in a terminal as a second host for the same component tree.
- `docs/plugins/forward-compatibility.md` — the event catalogue, admission rule, shipped lifecycle
  contracts, and deliberate refusals.
- `editor.md` — a host-owned document surface: the concrete instance of the terminal client's
  "one host-owned template" conclusion. Built through step 6 (database ships on it); editor's move is the step
  that remains.
