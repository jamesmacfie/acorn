// Teaching the agent to write a plugin — the third piece of the dev loop, and the one the mechanics are
// useless without (docs/plugins.md § The dev loop, docs/plugin-authoring.md).
//
// Two doors onto ONE text, built here:
//
//   - `plugin_authoring`, a read-tier agent tool. This is the door the agent uses, and it is the reason
//     the module exists: bb's rule is never answer an API question from a built bundle, and the only way
//     to keep that promise is for the answer to come from the process that enforces the contract.
//   - a `plugin-authoring` context section with `defaultIncluded: false`. This is the door a HUMAN uses —
//     tick it in the composer's context picker and the guide rides along with the send.
//
// Why a context section and not an `agentContexts` descriptor: `agentContexts` is a manifest key, so a
// core-owned entry would mean core pretending to be a plugin, and its contract is an `options` GET plus a
// `capture` POST on a plugin's OWN namespace — a picker over rows, which this is not. `contextSections`
// already has exactly the dial this needs, which is `defaultIncluded: false`: a task that is not writing a
// plugin assembles this section never, pays zero bytes, and does not know it exists. bb pays 1,678 lines
// on every session because it has no such dial. We do, so the guide costs nothing until it is asked for.
//
// Why the vocabulary below is DERIVED and not written: every list here — manifest keys, caps, action
// verbs, bridge kinds, permission facets — is one an author gets wrong by remembering it. A hand-copied
// list in an agent-facing guide is worse than no list, because the agent believes it. So each one is read
// off the thing that enforces it: the zod manifest schema via `z.toJSONSchema`, the bridge wire union via
// `satisfies` (a new message kind is a COMPILE error here), and the core facet map via its own export.
//
// Neither door is a new route, which is why nothing had to be added to the frame allowlist
// (client-core/plugins/frames/scopes.ts): the agent-tool surfaces are already permanently unmappable
// there, and the one place this text is reachable from a frame is `GET /v2/core/tasks/:id/context` with
// an explicit `include=plugin-authoring` — a read of acorn's own published contract, under a scope the
// owner already granted for reading tasks.
//
// What is deliberately NOT here: the `@acorn/plugin-api` export list. A hand-written plugin cannot import
// that package at all — a bare specifier has nothing to resolve against and the frame origin serves one
// file — so the names are not vocabulary this profile can use, and a packaged node has no copy of
// `packages/plugin-api/src/surface.snapshot.txt` to read anyway. The snapshot has its own drift gate
// (surface.test.ts) and is the answer for a plugin that IS built; what this projection carries about it is
// the major, which is the field a hand-written manifest actually has to get right.
import { z } from 'zod'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/pluginApiVersion.ts'
import { pluginManifestShape } from '@acorn/protocol/pluginContract.ts'
import {
  PLUGIN_BRIDGE_VERSION,
  type PluginBridgeApiRequest,
  type PluginBridgeDocumentRequest,
  type PluginBridgeRequest,
  type PluginBridgeUiRequest,
  type PluginBridgeWebviewRequest,
} from '@acorn/protocol/pluginBridge.ts'
import { MAX_PLUGIN_STATE_BYTES } from '@acorn/protocol/pluginState.ts'
import { NODE_CORE_FACETS } from '../../main/pluginPermissions.ts'
import { registerContextSection, type ContextSectionContribution } from './contextSections.ts'
import type { AgentToolContribution } from './registry.ts'

// ── Derived from the manifest schema ──────────────────────────────────────────────────────────────
//
// `z.toJSONSchema` rather than reaching into `_def`: it is the same projection the tool registry already
// uses for MCP input schemas, so it is a supported door rather than an internals read that a zod bump
// turns into a runtime throw. `unrepresentable: 'any'` because the manifest is full of refinements
// (`entry`, the chord parser, the content-link matcher) that have no JSON Schema spelling; the fields this
// module reads — keys, caps, enums, literal verbs — all do.
type JsonSchema = {
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  required?: string[]
  enum?: string[]
  const?: string
  maxItems?: number
}

let cached: JsonSchema | null = null
const manifestJsonSchema = (): JsonSchema =>
  (cached ??= z.toJSONSchema(pluginManifestShape, { target: 'draft-7', io: 'input', unrepresentable: 'any' }) as JsonSchema)

const at = (schema: JsonSchema | undefined, ...path: string[]): JsonSchema | undefined =>
  path.reduce<JsonSchema | undefined>((node, key) => node?.properties?.[key], schema)

// A discriminated union of `{ verb: '<literal>' }` objects, read back as the literal set. `oneOf` is what
// zod emits for a discriminated union under draft-7; `anyOf` is the fallback if that ever changes, and the
// test asserts the result is non-empty so a silent [] cannot ship.
const verbs = (schema: JsonSchema | undefined): string[] =>
  (schema?.oneOf ?? schema?.anyOf ?? []).map((option) => option.properties?.verb?.const ?? '').filter(Boolean).sort()

// ── Derived from the bridge wire union ────────────────────────────────────────────────────────────
//
// `satisfies Record<Union, string>` is the whole guard: add a message kind to
// `@acorn/protocol/pluginBridge.ts` and this file stops compiling until it is described here. That is a
// stronger check than any test could make, because the union is a TYPE and has no runtime value to read.
const BRIDGE_KINDS = {
  api: "an HTTP call against this frame's node, checked against the manifest's `permissions.api` scopes; your own /v2/p/<id>/ namespace always passes",
  subscribe: 'subscribe to a shell channel the manifest declared in `permissions.events`',
  'state.get': `read durable host-kept state, keyed (pluginId, key)`,
  'state.set': `write it; values are capped at ${MAX_PLUGIN_STATE_BYTES} bytes`,
  ui: 'the closed host-effect set (see uiOps)',
  document: 'the host editor of a document-over-frame pane (see documentOps); denied from every other surface',
  webview: 'controller verbs for a webview surface (see webviewOps); you cannot read the page or type into it',
  cancel: 'abandon an in-flight request by id',
  keydown: 'forward a chord this frame did not claim back to the shell',
  connected: 'the ack. Post it (or anything) or the host replaces the frame after 10s',
} satisfies Record<PluginBridgeRequest['kind'], string>

const UI_OPS = {
  toast: 'title + optional detail',
  copy: 'write text to the clipboard — `navigator.clipboard` does not work in a frame',
  openPane: 'open a pane by id',
  openUrl: 'https only, focused frame only, at most once a second, and you learn nothing back',
  'importer.done': 'importer surfaces only: close and run the host refresh',
  'importer.close': 'importers and overlays: plain dismissal',
} satisfies Record<PluginBridgeUiRequest['op'], string>

const DOCUMENT_OPS = { read: 1, write: 1, flush: 1 } satisfies Record<PluginBridgeDocumentRequest['op'], 1>
const WEBVIEW_OPS = { navigate: 1, back: 1, forward: 1, reload: 1 } satisfies Record<PluginBridgeWebviewRequest['op'], 1>
const API_METHODS = { GET: 1, POST: 1, PUT: 1, PATCH: 1, DELETE: 1 } satisfies Record<PluginBridgeApiRequest['method'], 1>

// ── The projection ────────────────────────────────────────────────────────────────────────────────

export type PluginAuthoringVocabulary = {
  apiMajor: string
  manifest: {
    file: string
    required: string[]
    optional: string[]
    contributionCaps: Record<string, number>
    frameTargets: string[]
    slots: string[]
    contextMenuLocations: string[]
    extensionPointLocations: string[]
    coreSlots: string[]
    commandCategories: string[]
    themeTokens: string[]
  }
  actions: { railOnSelect: string[]; commandsAndBadges: string[] }
  permissions: { node: string[]; core: string[]; note: string }
  bridge: {
    version: number
    kinds: Record<string, string>
    apiMethods: string[]
    uiOps: Record<string, string>
    documentOps: string[]
    webviewOps: string[]
  }
}

/** What this node's own schemas say a plugin may declare, right now. Nothing here is written down twice. */
export function pluginAuthoringVocabulary(): PluginAuthoringVocabulary {
  const schema = manifestJsonSchema()
  const contributions = at(schema, 'contributions')
  const required = schema.required ?? []
  const caps = Object.entries(contributions?.properties ?? {}).map(([key, value]) => [key, value.maxItems ?? 0] as const)
  return {
    apiMajor: PLUGIN_API_MAJOR,
    manifest: {
      file: 'acorn-plugin.json',
      required: [...required].sort(),
      optional: Object.keys(schema.properties ?? {}).filter((key) => !required.includes(key)).sort(),
      contributionCaps: Object.fromEntries(caps),
      frameTargets: at(contributions, 'frames')?.items?.properties?.target?.enum ?? [],
      slots: at(contributions, 'slots')?.items?.properties?.slot?.enum ?? [],
      // Read off the schema like the slot enum, for the same reason: both are short lists that grow
      // only when a host surface appears to draw them, and a guessed member is a contribution that
      // parses on a newer node and never appears on this one.
      contextMenuLocations: at(contributions, 'contextMenus')?.items?.properties?.location?.enum ?? [],
      // The two cooperative/exclusive vocabularies, read off the schema for the same reason as the two
      // above: both are short lists that grow only when a host surface appears to draw them, and a
      // guessed member is a declaration that parses on a newer node and never appears on this one.
      extensionPointLocations: at(contributions, 'extensionPoints')?.items?.properties?.location?.enum ?? [],
      coreSlots: at(contributions, 'frames')?.items?.properties?.coreSlot?.enum ?? [],
      commandCategories: at(contributions, 'commands')?.items?.properties?.category?.enum ?? [],
      // A `themes` entry is a map of EXACTLY these token names, so the list is the contract rather than
      // a hint — a theme missing one is refused at parse. Read off the strict object the schema builds
      // from the palette (@acorn/protocol/themeTokens.ts), so a token added to the appearance contract
      // reaches the agent without anyone remembering to retype it here.
      themeTokens: at(contributions, 'themes')?.items?.properties?.tokens?.required ?? [],
    },
    actions: {
      // The two unions, read off the two descriptors that carry them rather than named directly: a rail
      // source's `onSelect` is the only site with the full set in scope, and a command's `action` is the
      // narrow one every context-free surface (commands, slot badges, a source's empty state) takes.
      railOnSelect: verbs(at(contributions, 'sources')?.items?.properties?.onSelect),
      commandsAndBadges: verbs(at(contributions, 'commands')?.items?.properties?.action),
    },
    permissions: {
      node: Object.keys(at(schema, 'permissions', 'node')?.properties ?? {}),
      core: [...NODE_CORE_FACETS],
      // No list of grantable `permissions.api` scopes, deliberately: the allowlist that decides them lives
      // in the client (client-core/plugins/frames/scopes.ts) and the node cannot import it, so any list
      // here would be a copy — and a wrong scope name in an agent-facing guide is worse than none,
      // because the agent believes it. What is stated instead is the part that makes an unknown scope
      // survivable, which is the part an author needs.
      note: 'permissions.node is least privilege for cooperative code, not a sandbox: gating is by omission, so an undeclared facet is absent from ctx and the first call is a TypeError. permissions.api is different — it IS enforced, by an allowlist of (path, method) pairs at the frame bridge. Your own /v2/p/<id>/ namespace needs no scope and is always allowed; another plugin\'s namespace is always denied; a scope this acorn does not know is denied at the bridge rather than rejected at parse, so declare only scopes you have confirmed against this node.',
    },
    bridge: {
      version: PLUGIN_BRIDGE_VERSION,
      kinds: BRIDGE_KINDS,
      apiMethods: Object.keys(API_METHODS),
      uiOps: UI_OPS,
      documentOps: Object.keys(DOCUMENT_OPS),
      webviewOps: Object.keys(WEBVIEW_OPS),
    },
  }
}

// ── The brief ─────────────────────────────────────────────────────────────────────────────────────
//
// Process, not vocabulary. Everything an author gets WRONG by remembering is above, derived; what is left
// here is the sequence of acts, which no schema states and which nothing else in the tree can be read off.
// It is deliberately short: docs/plugin-authoring.md is the long form for a human with the repository
// checked out, this is what a node can tell an agent that has neither.
const BRIEF = `# Writing an acorn plugin, by hand

A plugin is a DIRECTORY the node loads. There is no build step in this profile and no bundler on the
node, so two constraints carry everything:

1. **The node half may import only relative paths and \`node:\` builtins.** Multi-file is fine. A bare
   specifier (\`zod\`, \`hono\`) has nothing to resolve against — an installed package is a bare directory
   with no \`node_modules\`. It may resolve on the machine that wrote it, because a dev data root sits
   inside a repository; it will not on the machine that installs it. "It worked in dev" is not evidence.
2. **The client half is exactly ONE file of plain JavaScript.** The frame origin answers four paths and
   404s everything else, so a second module, a stylesheet, an image or a font cannot be fetched — inline
   them (\`img-src 'self' data:\`). \`connect-src\` is \`'none'\`: a frame has no network at all, only the
   MessagePort. You cannot import \`@acorn/plugin-api/ui/sdk\` — inline the ~30-line handshake instead.

## The layout

    <dir>/acorn-plugin.json    the manifest; the only fixed filename
    <dir>/node/index.js        default-exports { name, init(ctx), ready?(ctx), dispose?() }
    <dir>/client.js            one file, plain JS, no imports
    <dir>/migrations/          a Drizzle chain WITH meta/_journal.json, only if you own tables

\`plugin.name\` must equal \`manifest.id\`, or the load fails. \`manifest.apiVersion\` must equal this
node's plugin API major by exact string match. Ids are permanent: the id is the route namespace, the
renderer route prefix and the SQLite filename, so renaming a plugin is a new plugin plus a data
migration plus a tombstone.

A loaded plugin's \`ctx\` has no \`ctx.routes.register\` (Hono cannot cross a process boundary) and no
\`ctx.events.channel\`/\`streams\`. The door is \`ctx.routes.fetch((request, context) => Response)\`; the host
strips the mount, so \`/v2/p/<id>/greeting\` reaches you as \`/greeting\`. \`ctx.storage\`, \`ctx.core\`,
\`ctx.tools\`, \`ctx.contextSections\`, \`ctx.providers\`, \`ctx.capabilities\`,
\`ctx.events.send\`/\`status\`/\`notice\` and \`ctx.log\` are there, shaped by the manifest.

## The loop — you cannot install anything, so ask

1. Write the directory somewhere absolute on the node's machine.
2. Call \`plugin_request\` with \`{ action: 'install', source: { path: '<absolute path>' }, dev: true,
   reason: '<one line the owner reads>' }\`. It installs NOTHING. It raises a question and rings the
   owner's bell, then fails with \`needs-trust\`. That is the expected outcome, not an error to route
   around.
3. **Call \`plugin_request\` again with identical arguments to collect the answer.** Identical arguments
   are one question, so this does not re-ask. Do not poll in a loop.
4. \`dev: true\` is what makes iteration cheap: the approving device auto-trusts this plugin's future
   bundles instead of prompting per save, and a dev-mode approval ends in a RELOAD rather than a restart.
   The owner can see it badged in Settings → Plugins and end it whenever they like.
5. After editing, ask again with \`{ action: 'update', pluginId: '<id>', dev: true }\`. A local-path
   install is a symlink, so the files you edit are the files that load.

Local-path installs are development-only (\`allowLocalPath\`); a packaged app refuses one outright.

## What a reload does and does not do

A reload swaps the node half in the running process, candidate-then-commit: if the new \`init\` throws,
the previous instance stays registered and serving and the failure lands as \`state: 'failed'\` with a
reason on the roster row. Four limits worth knowing before they confuse you:

- **Only the ENTRY module is re-evaluated.** Node caches an ES module permanently by resolved URL, so
  the loader stamps a generation onto the entry's URL. A relative import INSIDE it does not inherit that
  query and comes back from the cache with the code it had at boot. So a single-file node half is fully
  covered by reload, and **a multi-file one needs a node restart for any change outside the entry file.**
  If you are iterating hard, keep the node half in one file, or expect to ask for a restart.
- Registration rollback is not schema rollback: a migration that already ran cannot be un-migrated.
- Duplicate tool/provider/capability ids are only caught when the buffer is replayed, at commit.
- Built-ins cannot be reloaded at all — there is no second copy on disk to swap in.

The client half needs no reload machinery: a frame is an iframe whose ORIGIN is its bundle hash, so new
bytes are a new origin and a new document.

## Rules that are not negotiable

- Schema changes are append-only. Never edit or reorder a shipped migration; Drizzle validates the chain
  against \`meta/_journal.json\` and a reordered chain already fails. There is no downgrade support.
- Every descriptor path is confined at parse time to \`/v2/p/<id>/\`. Another plugin's namespace is always
  denied, whatever the manifest declares.
- \`window.confirm\` and \`alert\` are suppressed in a frame, and \`navigator.clipboard\` refuses to write.
  Draw your own confirmation; use the bridge's \`ui.copy\`.
- Apply the host's \`appearance\` push (set \`data-theme\`/\`data-style\` and write every token as a CSS
  custom property on \`documentElement\`) or your frame renders unthemed.

\`docs/plugin-authoring.md\` in the acorn repository is the long form, with a complete worked example
including the inlined handshake. If you have that checkout, read it; if you do not, the above plus the
vocabulary below is the contract.`

const table = (rows: [string, string][]): string => rows.map(([key, value]) => `- \`${key}\` — ${value}`).join('\n')

/** The guide as one markdown document: the brief, then this node's own vocabulary underneath it. */
export function renderPluginAuthoring(vocabulary = pluginAuthoringVocabulary()): string {
  const { manifest, actions, permissions, bridge } = vocabulary
  return [
    BRIEF,
    '',
    `## This node's vocabulary (plugin API major ${vocabulary.apiMajor})`,
    '',
    `Read from this node's own schemas, not from memory. \`apiVersion\` must be the string "${vocabulary.apiMajor}".`,
    '',
    `**Manifest (\`${manifest.file}\`).** Required: ${manifest.required.map((key) => `\`${key}\``).join(', ')}.`,
    `Optional: ${manifest.optional.map((key) => `\`${key}\``).join(', ')}.`,
    '',
    '**Contributions, and the cap on each.** The cap is the point past which a contribution stops being an',
    "integration and starts being an app inside someone else's chrome.",
    '',
    Object.entries(manifest.contributionCaps).map(([key, cap]) => `- \`${key}\` — max ${cap}`).join('\n'),
    '',
    `Frame targets: ${manifest.frameTargets.map((value) => `\`${value}\``).join(', ')}. `
      + `Host slots: ${manifest.slots.map((value) => `\`${value}\``).join(', ')}. `
      + `Context-menu locations: ${manifest.contextMenuLocations.map((value) => `\`${value}\``).join(', ')}. `
      + `Command categories: ${manifest.commandCategories.map((value) => `\`${value}\``).join(', ')}.`,
    '',
    '**Descriptors for chrome, frames for rectangles.** A status chip, a badge, a menu row or a palette',
    'entry is DATA you declare and the host draws — it costs no document, looks native, and stays live',
    'when no frame of yours is mounted anywhere. A frame is for a rectangle with real UI inside it. Do',
    'not reach for a frame to draw a 20px badge, and do not try to draw a pane out of descriptors.',
    '',
    '**Context menus.** A `contextMenus` entry is `{ id, location, label, icon?, order?, when?, action }`.',
    '`when` is a map of literals that must ALL equal the target\'s own facts — not an expression — and a',
    'fact the location does not have is a parse error. The action takes the same context-free verb set a',
    'command does, and receives the id of the thing that was right-clicked. Core\'s own rows share the',
    'registry, so yours appear in the same menu, after them by default.',
    '',
    '**Cooperative extension points.** You may open one of YOUR panes to other plugins, and you may add',
    'rows to a point another plugin opened. Both sides are manifest keys, and there is no third way:',
    'nothing lets you touch a plugin that did not declare a point, and nothing lets you run code inside',
    'another plugin\'s realm. If a point cannot express what you need, the answer is to ask for a wider',
    'descriptor vocabulary, not for access.',
    `- \`extensionPoints\`: \`{ id, label, location, surface }\` — \`location\` from ${manifest.extensionPointLocations.map((value) => `\`${value}\``).join(', ')},`,
    '  `surface` a `pane` YOUR manifest declares. The host draws the strip; you write no code for it.',
    '- `extensions`: `{ id, point, label, order?, items, onSelect?, refresh? }` — `point` is',
    '  `<ownerPluginId>:<pointId>`, and `items` is a GET on YOUR OWN namespace answering',
    '  `{ items: [{ id, title, subtitle?, icon?, badge? }] }`. `onSelect` takes the context-free verb set',
    '  and receives the clicked row\'s id. The host stamps your plugin id beside the rows, always.',
    'A contribution to a point that is not there — owner not installed, disabled, or it dropped the point —',
    'delivers nothing, silently. That is the designed outcome, not a failure to report.',
    '',
    `**Replacing a core surface.** A \`coreSlot\` frame offers to draw one of acorn's own: `
      + `${manifest.coreSlots.map((value) => `\`${value}\``).join(', ')}. Declare `
      + '`{ target: "coreSlot", id, label, coreSlot }` plus a client bundle. Registering SEIZES NOTHING —'
      + ' the user picks the provider in Settings, and acorn draws its own again the moment your plugin is'
      + ' disabled or your surface throws.',
    '',
    '**Themes.** A `themes` entry is `{ id, label, dark?, tokens }`, and `tokens` must carry exactly these',
    `${manifest.themeTokens.length} names — all of them, none else: `
      + `${manifest.themeTokens.map((token) => `\`${token}\``).join(', ')}.`,
    'Each value is a hex colour or a flat colour function (`#1e1e2e`, `rgba(0, 0, 0, 0.42)`,',
    '`oklch(0.7 0.15 250)`); named colours, `var()` and nested functions are refused. You write no CSS —',
    'the host generates the `:root[data-theme="plugin:<your-id>:<theme-id>"]` block itself, and writes',
    '`--is-dark`, `--color-scheme` and `--syntax-fg` from `dark`, so never try to set those three.',
    'The theme then appears in Settings → Appearance beside the built-in twelve.',
    '',
    '**Action verbs.** Descriptors do not run plugin code; they hand the host a verb from a closed set.',
    `A rail source's \`onSelect\` takes the full set: ${actions.railOnSelect.map((verb) => `\`${verb}\``).join(', ')}.`,
    `Commands, slot badges and a source's \`emptyState\` take the context-free subset: `
      + `${actions.commandsAndBadges.map((verb) => `\`${verb}\``).join(', ')} — the rest need a selected row or a routed project.`,
    '',
    `**Permissions.** \`permissions.node\` keys: ${permissions.node.map((key) => `\`${key}\``).join(', ')}. `
      + `\`permissions.node.core\` tokens: ${permissions.core.map((token) => `\`${token}\``).join(', ')} `
      + '(the project grants nest: `config` and `write` each imply `read`). '
      + permissions.note,
    '',
    `**The frame bridge** (\`acornBridge: ${bridge.version}\`). Requests are \`{ id, kind, ... }\`; replies are`,
    '`{ id, ok: true, status, body }` or `{ id, ok: false, error: { code, message, requestId, retryable } }`.',
    '',
    table(Object.entries(bridge.kinds)),
    '',
    `\`api\` methods: ${bridge.apiMethods.map((method) => `\`${method}\``).join(', ')}.`,
    '',
    table(Object.entries(bridge.uiOps).map(([op, note]) => [`ui.${op}`, note])),
    '',
    `\`document\` ops: ${bridge.documentOps.map((op) => `\`${op}\``).join(', ')}. `
      + `\`webview\` ops: ${bridge.webviewOps.map((op) => `\`${op}\``).join(', ')}.`,
  ].join('\n')
}

// ── The two doors ─────────────────────────────────────────────────────────────────────────────────

export const PLUGIN_AUTHORING_TOOL = 'plugin_authoring'
export const PLUGIN_AUTHORING_SECTION = 'plugin-authoring'

/** Read tier: it reads schemas this process already holds and touches nothing. */
export const pluginAuthoringTool = (): AgentToolContribution => ({
  name: PLUGIN_AUTHORING_TOOL,
  description:
    'How to write an acorn plugin against THIS node, with the current manifest vocabulary, action verbs, permission facets and frame-bridge messages read from the node itself. Call this before writing or changing a plugin, and before answering any question about the plugin contract — never answer one from memory. Installing is a separate tool (plugin_request); this one only tells you how.',
  input: z.object({}),
  scope: 'task',
  risk: 'read',
  handler: async () => {
    const vocabulary = pluginAuthoringVocabulary()
    // Both shapes in one result: the markdown is what an agent reads, the structured half is what it can
    // check a manifest against without parsing prose.
    return { guide: renderPluginAuthoring(vocabulary), vocabulary }
  },
})

// `defaultIncluded: false` is the whole reason this is affordable. Order 50 puts it after memory (40), so
// the four sections every existing prompt assumes — pr, issues, notes, memory — keep their wire order.
export const pluginAuthoringSection: ContextSectionContribution = {
  id: PLUGIN_AUTHORING_SECTION,
  order: 50,
  label: 'Plugin authoring',
  defaultIncluded: false,
  // One item, and a per-item ceiling well above the rendered guide so the budget is a backstop rather
  // than a silent truncation of the contract. `truncate-tail` because the brief leads and the derived
  // vocabulary follows: if this ever did trip, losing the tail is the less wrong half to lose.
  budget: { maxItems: 1, maxBytesPerItem: 32_000, overflow: 'truncate-tail' },
  assemble: async () => ({
    items: [{ id: PLUGIN_AUTHORING_SECTION, kind: 'guide', label: 'Writing an acorn plugin', body: renderPluginAuthoring() }],
  }),
  format: (items) => items[0]?.body ?? '',
}

registerContextSection('core', pluginAuthoringSection)
