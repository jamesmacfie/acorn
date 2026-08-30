# The plugin docs: design

The design for the Plugins section of the public site — the reason the site exists. The goal is
a reference that answers three questions for an author and for the maintainer: what goes in the
manifest, what the node half can do, and how a node-side contribution ends up as client UI.
Almost none of it needs writing from scratch: `docs/plugin-authoring.md` is already a public
authoring guide that needs splitting, `packages/protocol/src/pluginContract.ts` is a heavily
commented single source of truth the manifest reference can be generated from, and
`packages/plugin-sdk/src/public.ts` is a hand-written published declaration file that already
is the SDK reference for both render paths.

## The narrative page: why plugins work this way

Distilled from `docs/extensibility.md`, which is marketing copy that happens to live in an
internal doc. The page carries four ideas and no more:

- **Two tiers, permanently.** Compiled first-party plugins and loaded plugins, and why the line
  is where it is — first-party is a reason, not a status.
- **The sandboxing line**, quoted as-is: "can the contribution be expressed as data plus
  asynchronous messages?" If yes, it can be a loaded plugin.
- **Descriptors for facts, trees for UI, rectangles for pixels.** Three answers, asked in that
  order. A chip or a badge is a descriptor the host draws. A pane or a panel body is a tree: the
  plugin's bundle names acorn's own components from a Web Worker with no DOM, and the host draws
  them, so it gets the shell's keyboard handling, focus, ARIA and style pack. Only pixels the host
  cannot draw get an iframe. Plugin JavaScript never touches a shell registry in any of the three.
- **The Node distributes; the device decides.** Install is per-node, trust is per-device.

## The authoring guide split

`docs/plugin-authoring.md` maps nearly 1:1 onto the guide pages:

| Internal section | Public page |
| --- | --- |
| Start from the scaffold; The package; A complete example | Build your first plugin |
| The manifest; What the builder supplies vs hand-written | The package and manifest |
| The node half | The node half |
| The client half; Reaching the bridge; What the bridge carries | The client half and the frame SDK |
| Permissions | Permissions and security |
| Storage and migrations | Storage and migrations |
| Installing a hand-written package; Updating a plugin | folded into Build your first plugin and Compatibility |
| Contributions; The action verbs | the Contribution points catalogue |
| What this profile refuses | Compatibility and versioning (the "not promised" half) |

The quickstart leans on the published front door: `npm create acorn-plugin` scaffolds the
manifest, a two-file node half, and a `client.js` with the handshake inlined.

## The generated manifest reference

The one piece of real build machinery, and the reason the site lives in-repo.

A build script in `apps/site` imports the zod schema from
`packages/protocol/src/pluginContract.ts` and emits two artifacts:

1. **A structured JSON document** — sections, keys, types, caps, defaults, and the schema's own
   comments as descriptions — rendered by a client-filterable component. Herdr's
   `ConfigReference` pattern: the MDX page is a few lines of frontmatter plus the component;
   all content comes from the JSON.
2. **A JSON Schema** published at `/schemas/acorn-plugin.schema.json`, self-identifying via a
   `$schema` const (bb's pattern), so an author's editor validates and autocompletes
   `acorn-plugin.json` directly.

A CI check regenerates both and diffs against the committed output, so the schema cannot drift
from the docs without a red build — herdr's `config_reference_check` discipline.

Two things generation cannot carry, and prose must: the cross-field refinements that live in
`packages/node-core/src/main/pluginManifest.ts` (route confinement, surface reachability, id
uniqueness — stated as rules on the reference page), and the load-time path checks
(`resolveInRoot` re-verifies lexical and symlink confinement, which the schema alone cannot
express).

## The contribution points catalogue

One page per contribution key. Nineteen keys, grouped in the sidebar by what they extend:

- **Surfaces**: `frames` (32; the surfaces a plugin draws — `pane`, `refPanel`, `settings`,
  `importer`, `webview`, `overlay`, `coreSlot`. A `pane`, `refPanel` or `settings` names a host-owned
  layout and fills its regions; a region is a remote tree, a host-drawn document, or a sandboxed
  iframe for a surface that owns its pixels), `sources` (8; rail sources), `routes` (8; client router
  paths inside a host-minted prefix).
- **Chrome and commands**: `slots` (8; footer/topbar badges), `commands` (32), `keybindings`
  (32), `palette` (32; the legacy verb-union rows), `contextMenus` (8; host-drawn rows gated by
  a closed `when` vocabulary), `contentLinks` (16; host-linkified URL patterns), `themes` (8;
  validated token maps — no plugin CSS reaches the shell).
- **Data and dashboards**: `collections` (8; typed record sets the host draws), `attention`
  (4; inbox rows), `nodeStats` (4; one number on a node card), `agentContexts` (4; composer
  context entries), `refResolvers` (4; batch identifier enrichment).
- **Node-side work**: `schedules` (4; periodic node work, 300-second floor), `taskChecks` (4;
  pre-archive checks with optional apply).
- **Cross-plugin**: `extensionPoints` (4; this plugin opening a region of its own surface) and
  `extensions` (8; contributing into another plugin's point) — extension only by invitation.

Every catalogue page has the same shape: what it extends in the UI (with a screenshot), its
cap, its fields (pulled from the same generated JSON as the manifest reference), which
action-verb set it accepts (the full seven-verb union versus the five-verb subset — the closed
set matters: descriptors never run plugin code), and a minimal working example. Each page
cross-links the owning feature doc's public page (dashboards, schedules, command palette,
panes) rather than re-explaining the feature.

## The node half

From `docs/plugin-authoring.md` § the node half, backed by
`packages/node-core/src/server/plugin/types.ts`. The page documents the `NodePlugin` lifecycle
(`init`, `ready`, `dispose`) and each `NodePluginContext` facet in reference style: `routes`,
`tools`, `schedules`, `collections`, `taskChecks`, `contextSections`, `providers`, `capabilities`,
`storage`, `core` (the confined filesystem, git, process broker, and secrets services), `events`.
Node actions and harnesses are manifest-only and have no facet.

It also carries the route-namespace story, because it is the addressing scheme everything else
refers to: a plugin's HTTP surface lives at `/v2/p/<id>/*`, the id binds the namespace
permanently, and a loaded plugin's fetch handler is resolved per request — which is what makes
hot reload work.

## The client half and the SDK

Two halves on one page, because the projection path is the part people misunderstand:

1. **The projection path.** The node sends the manifest and client-bundle hash in the roster;
   the client fetches and caches the bundle, runs the one shared eligibility-and-trust check,
   then registers descriptor-derived entries into the same registries a compiled plugin uses.
   The plugin's JavaScript never touches a shell registry: a worker and an iframe are the only
   places it runs, and the tree a worker emits is drawn by the host's own components.
2. **The bridge reference.** Derived from `packages/plugin-sdk/src/public.ts`, which is
   hand-written as a published declaration and held to the implementation by a contract test —
   so the docs page can track that file section by section: the `context` snapshot,
   `api.{get,post,put,patch,del}`, `events.on`, `state.{get,set}` (durable, 1 MiB per value,
   shared namespace with the node half's prefs), `ui`, `document`, `webview`, `keys.claim`,
   the appearance and surface-action callbacks, and the handshake with its budgets (10-second
   ready ack, 100 in-flight requests, 1,000 messages per 10 seconds).

The isolation facts live here too, stated concretely: each frame is an iframe on a
content-addressed `app-plugin://` origin with `connect-src 'none'` — no network, no
`window.acorn`, no host DOM; one `MessagePort` is the whole I/O surface, and the host pins
which node it talks to.

## Permissions and security

The page every trust prompt links to. Three lists, and where each is enforced versus declared:

- `permissions.api` — **enforced**, by the frame broker's scope allowlist. Exactly six
  grantable scopes (`core.projects:config|read|write`, `core.tasks:read|write`,
  `core.workspaces:read`); a plugin's own namespace is always allowed, another plugin's never.
- `permissions.events` — names the shell channels a frame may subscribe to.
- `permissions.node` (and `net`, `secrets`, `exec`) — **declared, not enforced**. The node half
  runs in-process; these shape the context handed to cooperative code and inform the trust
  prompt, and the page says so in those words. This is the "disclosed, not contained" honesty
  constraint from [README.md](./README.md), stated where authors and users will actually read
  it.

Plus the trust model: install is per-node and owner-authenticated, trust is per-device with a
prompt that renders the permission lists, and bundled plugins ride the identical
manifest/loader/sandbox path — provenance is the only difference.

## Examples

bb's teaching-plugin pattern: small example plugins, roughly one per catalogue group, each with
a README, linked from the matching catalogue page — a rail source, a frame pane, a slot badge
plus command, a collection, a schedule plus task check, an extension-point pair. These live in
the repo (an `examples/plugins/` home, exact location decided at build time) and double as
fixtures the docs snippets are excerpted from, so examples cannot rot silently.

The real-world examples are the first-party packages already running as loaded plugins —
rollbar, linear, http, database, model-providers, nodes-file — each of which ships a permission
rationale in its `acorn-plugin.config.mjs`. The catalogue links them as "how a real one does it".

## Compatibility and versioning

Short and blunt, from `docs/plugins.md` § what is published: a plugin that loads under a
`PLUGIN_API_MAJOR` keeps loading under it. Deliberately not promised: that the major never
moves, that a prior major keeps working after it does, or any deprecation window. The page also
carries the refusals list (no `when` expression language, no plugin-supplied regexes for
content links, no auto-assigned fallback chords, and the rest) so authors stop asking for them
one at a time.

## What closes this file

The Plugins docs section ships with the generated manifest reference, the published JSON
Schema, and the CI sync check in place.
