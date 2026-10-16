// The facts half of each plugin reference page, read from the code (docs/site/references.md). Each
// entry is MDX that `reference.mjs` puts where the page's written half says `{/* facts */}`. Nothing
// here is a copy of a value: a fact is read from the contract, a published declaration, or, where the
// owner can't be imported in plain Node, from its source text with a check that the read found it.
import './tsResolve.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { anchor, code, codeList, declarationOf, docOf, flat, number, table } from './factsFormat.mjs'

const { manifestJsonSchema, pluginManifestVocabulary } = await import('@acorn/protocol/plugin/vocabulary.ts')
const { NODE_EVENT_CHANNELS } = await import('@acorn/protocol/nodeEvents.ts')
const { KIT_EVENTS, KIT_NODES, TREE_PROTOCOL_VERSION } = await import('@acorn/protocol/tree/nodes.ts')
const { TREE_LIMITS } = await import('@acorn/protocol/tree/messages.ts')
const { CADENCE_MIN_SECONDS_PLUGIN } = await import('@acorn/protocol/schedules.ts')
const { MAX_DOCUMENT_BYTES, MAX_OVERLAY_INPUT_BYTES, MAX_PLUGIN_BYTES } = await import(
  '@acorn/protocol/plugin/bridge.ts'
)
const { MAX_PLUGIN_STATE_BYTES } = await import('@acorn/protocol/plugin/state.ts')
const { PLUGIN_CLI_INPUT_MAX_BYTES, PLUGIN_CLI_OUTPUT_MAX_BYTES } = await import('@acorn/protocol/plugin/cliCommands.ts')
const runtime = await import('@acorn/protocol/plugin/runtimeContributions.ts')
const { NODE_CORE_FACETS } = await import('@acorn/node-core/server/plugins/coreFacets.ts')

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const source = (path) => readFileSync(join(ROOT, path), 'utf8')

/** Where a reference page lives, by its path under the reference folder. */
const referenceUrl = (page) => `/docs/build-plugins/reference/${page}/`
/** A contribution key's page, in kebab case: `nodeStats` is `contributions/node-stats`. */
const contributionPage = (key) => `contributions/${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`

// ── Formatting ────────────────────────────────────────────────────────────────────────────────────

const bytes = (value) =>
  value % (1024 * 1024) === 0
    ? `${number(value / (1024 * 1024))} MiB`
    : value % 1024 === 0
      ? `${number(value / 1024)} KiB`
      : `${number(value)} bytes`
const seconds = (ms) => (ms === 1000 ? '1 second' : ms % 1000 === 0 ? `${number(ms / 1000)} seconds` : `${number(ms)} ms`)

// ── The manifest schema ───────────────────────────────────────────────────────────────────────────

const schema = manifestJsonSchema()
const vocabulary = pluginManifestVocabulary()
const contributions = schema.properties.contributions
const CONTRIBUTION_KEYS = Object.keys(contributions.properties)

const members = (node) => node?.oneOf ?? node?.anyOf
const isAction = (node) => members(node)?.every((member) => member.properties?.verb?.const) ?? false
// A map's values have a schema. A loose object's `additionalProperties: {}` says nothing about them.
const hasValueSchema = (node) =>
  typeof node.additionalProperties === 'object' && Object.keys(node.additionalProperties).length > 0
const verbsOf = (node) => members(node).map((member) => member.properties.verb.const)
// An object a person writes in full, such as a theme's palette: its keys are the list, not fields.
const isKeyList = (node) =>
  node?.type === 'object' && node.additionalProperties === false && Object.keys(node.properties ?? {}).length > 16

const ACTION_SETS = [
  ['every verb', vocabulary.actions.railOnSelect],
  ['the context-free verbs', vocabulary.actions.commandsAndBadges],
  ['the context-free verbs and `navigate`', [...vocabulary.actions.commandsAndBadges, 'navigate']],
]
/** The name of a field's verb set, as the Action verbs page names it. */
const actionSet = (node) => {
  const verbs = [...verbsOf(node)].sort().join()
  const found = ACTION_SETS.find(([, set]) => [...set].sort().join() === verbs)
  if (!found) throw new Error(`An action field takes ${verbs}, which isn't a set the Action verbs page names.`)
  return found[0]
}

function typeText(node) {
  if (isAction(node)) return `action, ${actionSet(node)}`
  if (node.const !== undefined) return code(JSON.stringify(node.const))
  if (node.enum) return `one of ${codeList(node.enum)}`
  if (members(node)) return [...new Set(members(node).map(typeText))].join(', or ')
  if (node.type === 'array') return `list of ${typeText(node.items ?? {})}`
  if (isKeyList(node)) return `object with exactly these keys: ${codeList(Object.keys(node.properties))}`
  if (node.type === 'object' && hasValueSchema(node)) return `map of ${typeText(node.additionalProperties)}`
  return node.type ?? 'any value'
}

const range = (min, max, unit) => {
  const suffix = unit ? ` ${unit}` : ''
  if (min !== undefined && max !== undefined)
    return min === max ? `exactly ${number(min)}${suffix}` : `${number(min)} to ${number(max)}${suffix}`
  if (max !== undefined) return `at most ${number(max)}${suffix}`
  if (min === 1 && unit) return 'not empty'
  if (min !== undefined && min > 0) return `at least ${number(min)}${suffix}`
  return null
}

function bounds(node) {
  if (!node || isAction(node)) return []
  const found = [
    range(node.minLength, node.maxLength, 'characters'),
    node.pattern && `matching ${code(node.pattern)}`,
    node.format === 'uri' && 'a URL',
    range(node.minimum, node.maximum, ''),
    range(node.minItems, node.maxItems, 'items'),
  ]
  if (node.type === 'array' && node.items && !node.items.properties) {
    const each = bounds(node.items)
    if (each.length) found.push(`each ${each.join(', ')}`)
  }
  return found.filter(Boolean)
}

/** The type cell: the type, its bounds, and whether it's required or what it defaults to. */
function typeCell(node, required) {
  const parts = [[typeText(node), ...bounds(node)].join(', ')]
  if (required) parts.push('Required')
  else if (node.default !== undefined) parts.push(`Defaults to ${code(JSON.stringify(node.default))}`)
  return `${parts.join('. ')}.`
}

/** Union members side by side, as one object: a field in several members takes every type it has. */
function mergeMembers(objects) {
  const properties = {}
  for (const object of objects) {
    for (const [name, property] of Object.entries(object.properties)) {
      const previous = properties[name]
      if (!previous || JSON.stringify(previous) === JSON.stringify(property)) {
        properties[name] = property
        continue
      }
      properties[name] = {
        anyOf: [...(previous.merged ? previous.anyOf : [previous]), property],
        description: [...new Set([previous.description, property.description].filter(Boolean))].join(' '),
        merged: true,
      }
    }
  }
  const required = objects.map((object) => object.required ?? []).reduce((a, b) => a.filter((name) => b.includes(name)))
  return { properties, required }
}

/** One row per field, nested fields as dotted paths. `stop` lists paths whose fields have pages of their own. */
function fieldRows(object, idPrefix, { stop = [], base = '' } = {}) {
  const rows = []
  const visit = (node, prefix) => {
    for (const [name, property] of Object.entries(node.properties ?? {})) {
      const path = prefix ? `${prefix}.${name}` : name
      rows.push({
        id: anchor(idPrefix, path),
        cells: [path, typeCell(property, (node.required ?? []).includes(name)), property.description ?? ''],
      })
      if (!stop.includes(path)) descend(property, path)
    }
  }
  const descend = (property, path) => {
    if (isAction(property) || isKeyList(property)) return
    const inner = property.type === 'array' ? property.items : property
    if (!inner) return
    if (inner.properties) visit(inner, path)
    if (hasValueSchema(inner)) descend(inner.additionalProperties, `${path}.<key>`)
    const objects = members(inner)?.filter((member) => member.properties)
    if (objects?.length) visit(mergeMembers(objects), path)
  }
  visit(object, base)
  return rows
}

const FIELD_HEAD = ['Field', 'Type', 'What it does']

// ── Pages ─────────────────────────────────────────────────────────────────────────────────────────

function manifestFacts() {
  return table(FIELD_HEAD, fieldRows(schema, 'manifest', { stop: ['contributions', 'permissions'] }))
}

function contributionsIndexFacts() {
  const rows = CONTRIBUTION_KEYS.map((key) => {
    const node = contributions.properties[key]
    return {
      id: anchor('contribution', key),
      href: referenceUrl(contributionPage(key)),
      cells: [key, capText(node), node.description ?? ''],
    }
  })
  return table(['Key', 'How many', 'What it adds'], rows)
}

function capText(node) {
  if (node.maxItems !== undefined) return `Up to ${number(node.maxItems)}.`
  return node.type === 'string' ? 'One route.' : 'One per plugin.'
}

function contributionFacts(key) {
  const node = contributions.properties[key]
  const items = node.type === 'array' ? node.items : node
  const parts = [`${code(`contributions.${key}`)}: ${capText(node)} ${node.description ?? ''}`.trim()]
  const kinds = members(items)
  if (items.type === 'string') {
    parts.push(table(FIELD_HEAD, [{ id: anchor(key), cells: [key, typeCell(node, false), node.description] }]))
  } else if (kinds?.every((member) => member.properties?.kind?.const)) {
    for (const member of kinds) {
      const kind = member.properties.kind.const
      parts.push(`### ${code(kind)}`, member.properties.kind.description ?? '', table(FIELD_HEAD, fieldRows(member, `${key}-${kind}`)))
    }
  } else {
    parts.push(table(FIELD_HEAD, fieldRows(items.properties ? items : mergeMembers(kinds), key)))
  }
  const actions = actionFields(items).map(({ path, node: field }) => `${code(path)} takes ${actionSet(field)}`)
  if (actions.length)
    parts.push(
      `Action verbs: ${actions.join('; ')}. [Action verbs](${referenceUrl('action-verbs')}) says what each one does.`,
    )
  return parts.join('\n\n')
}

/** Every field that takes an action, under `node`, with its dotted path. */
function actionFields(node, prefix = '') {
  if (!node || typeof node !== 'object') return []
  if (isAction(node)) return [{ path: prefix, node }]
  const inner = node.type === 'array' ? node.items : node
  const objects = [inner, ...(members(inner) ?? [])].filter((object) => object?.properties)
  const found = objects.flatMap((object) =>
    Object.entries(object.properties).flatMap(([name, property]) =>
      actionFields(property, prefix ? `${prefix}.${name}` : name),
    ),
  )
  return found.filter((field, index) => found.findIndex((other) => other.path === field.path) === index)
}

// ── Permissions ───────────────────────────────────────────────────────────────────────────────────

// The frame scope table, read as text: client-core's broker owns it, and client-core doesn't load in
// plain Node. Each rule is one `path: shape(...)` with its `scopes`, and a rule the read skips fails here.
function apiScopes() {
  const text = source('packages/client-core/src/host/frames/scopes.ts')
  const rules = text.slice(text.indexOf('const RULES'))
  const found = [...rules.matchAll(/path: shape\((['`])(.+?)\1\),\s*scopes: \{([^}]*)\}/gs)]
  const declared = rules.match(/path: shape\(/g)?.length ?? 0
  if (!found.length || found.length !== declared)
    throw new Error(`Read ${found.length} of ${declared} frame scope rules in scopes.ts. Update apiScopes().`)
  const scopes = new Map()
  for (const [, , path, granted] of found) {
    for (const [, method, scope] of granted.matchAll(/(GET|POST|PUT|PATCH|DELETE): '([^']+)'/g)) {
      const routes = scopes.get(scope) ?? []
      routes.push(`${method} ${path.replace(/\$\{SEG\}/g, ':id')}`)
      scopes.set(scope, routes)
    }
  }
  return [...scopes].sort(([a], [b]) => a.localeCompare(b))
}

// The trust prompt's own sentence for each core facet, read as text for the reason above.
function facetCopy() {
  const text = source('packages/client-core/src/host/trust/permissions.ts')
  const block = text.slice(text.indexOf('const NODE_CORE_DESCRIPTIONS'), text.indexOf('\n}\n', text.indexOf('const NODE_CORE_DESCRIPTIONS')))
  return new Map(
    [...block.matchAll(/(?:'([\w:-]+)'|([\w-]+)):\s*\{([^}]*)\}/g)].map(([, quoted, bare, body]) => [
      quoted ?? bare,
      { text: body.match(/text:\s*'((?:[^'\\]|\\.)*)'/)?.[1], high: /high:\s*true/.test(body) },
    ]),
  )
}

// What each kind of trust prompt line comes from in the manifest. The group each sits in is read from
// the trust model below, so a line that moves group moves here too. A new line kind fails the build
// until it's described.
const GRANT_SOURCES = {
  input: "A derived data source's `inputs`: the sources your plugin reads",
  codeHost: 'Your `codeHost`: the hosts whose projects acorn hands your plugin, and whether it can add more',
  providedSource: 'Your `dataSources`: what your plugin provides to others',
  ui: '`permissions.api` scopes and `permissions.events` channels',
  node: '`permissions.node`: core facets, capabilities, and the worker grants',
  keyClaim: "A frame's `claimsKeys`: shortcuts your frame keeps",
  navigationDestination: "A frame's `destinations`: views in other plugins your tree may open",
  extension: '`extensionPoints`, `extensions`, and `coreSlot` frames: what you open to others, reach into, or offer to replace',
  harness: '`harnesses`: the program acorn runs, its arguments, and its environment',
  agentTool: '`agentTools`: each tool, its risk, and its output limit',
  schedule: '`schedules`: what runs, and how often, with no client open',
  taskCheck: '`taskChecks`: what archiving a task asks, and whether it offers a cleanup',
  contextSection: "`contextSections`: what your plugin adds to a task's context",
  customAgent: '`customAgents`: each agent and the instructions it gets',
  skill: '`skills`: each procedure agents can load',
  webview: "A `webview` frame's `hosts`: pages from the internet",
}
const GROUP_NAMES = {
  reads: 'Reads',
  provides: 'Provides',
  enforced: 'Enforced',
  declared: 'Declared',
  web: 'Web pages',
}

function trustGroups() {
  const text = source('packages/client-core/src/host/trust/trustModel.ts')
  const body = text.slice(text.indexOf('const groups'), text.indexOf('return groups'))
  const lines = []
  for (const [, group, block] of body.matchAll(/key: '(\w+)',([\s\S]*?)(?=key: '|$)/g)) {
    const kinds = new Set([...block.matchAll(/(\w+?)(?:PermissionLines|Lines)\(/g)].map(([, kind]) => kind))
    for (const kind of kinds) {
      if (!GRANT_SOURCES[kind]) throw new Error(`The trust prompt has a ${kind} line that GRANT_SOURCES doesn't describe.`)
      if (!GROUP_NAMES[group]) throw new Error(`The trust prompt has a group ${group} that GROUP_NAMES doesn't name.`)
      lines.push({ kind, group: GROUP_NAMES[group] })
    }
  }
  const gone = Object.keys(GRANT_SOURCES).filter((kind) => !lines.some((line) => line.kind === kind))
  if (gone.length) throw new Error(`GRANT_SOURCES describes ${gone.join(', ')}, which the trust prompt no longer lists.`)
  return lines
}

function permissionsFacts() {
  const node = schema.properties.permissions.properties.node
  const facets = facetCopy()
  return [
    '## Frame scopes',
    `Your frames and trees may call these acorn routes through the bridge, each under the scope in ${code('permissions.api')} that grants it. Your own ${code('/v1/p/<id>/')} routes need no scope. Every scope is **Enforced**.`,
    table(
      ['Scope', 'What it allows'],
      apiScopes().map(([scope, routes]) => ({ id: anchor('scope', scope), cells: [scope, routes.map(code).join(', ')] })),
    ),
    '## Event channels',
    `Your Node half may subscribe to these core channels with ${code('ctx.events.on')}, after naming them in ${code('permissions.events')}. Every channel is **Enforced**.`,
    table(
      ['Channel', 'Who sends it'],
      [
        ...NODE_EVENT_CHANNELS.map((channel) => ({ id: anchor('event', channel), cells: [channel, 'The Node.'] })),
        {
          id: 'event-plugin',
          cells: ['plugin:<id>:<verb>', `Another plugin, for a verb it lists in ${code('emits')}.`],
        },
      ],
    ),
    '## Node permissions',
    `What ${code('permissions.node')} gives your Node half. Every field is **Enforced**: what you leave out isn't on ${code('ctx')}.`,
    table(FIELD_HEAD, fieldRows(node, 'node', { base: 'node' })),
    '### Core facets',
    `The tokens ${code('permissions.node.core')} takes, and the line each puts in the trust prompt. A line marked high is drawn as a high-risk request.`,
    table(
      ['Facet', 'Trust prompt line'],
      NODE_CORE_FACETS.map((facet) => {
        const copy = facets.get(facet)
        return {
          id: anchor('facet', facet),
          cells: [facet, copy?.text ? `${copy.text}.${copy.high ? ' High.' : ''}` : 'No line of its own.'],
        }
      }),
    ),
    '## What the trust prompt lists',
    'Each kind of line in the trust prompt, the group it sits in, and the part of your manifest it comes from.',
    table(
      ['Line', 'Group', 'From your manifest'],
      trustGroups().map(({ kind, group }) => ({ id: anchor('grant', kind), cells: [kind, group, GRANT_SOURCES[kind]] })),
    ),
  ].join('\n\n')
}

// ── Published declarations ────────────────────────────────────────────────────────────────────────

const compiler = (files) => {
  const program = ts.createProgram(files, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    jsx: ts.JsxEmit.Preserve,
  })
  return { program, checker: program.getTypeChecker() }
}


/** A member's signature as its declaration writes it. */
function signatureOf(symbol) {
  const declaration = declarationOf(symbol)
  if (!declaration) return symbol.name
  const text = flat(declaration.getText())
  // An inline object type is listed member by member below its row, so the row names it only.
  return text.length > 160 && ts.isPropertySignature(declaration) && declaration.type && ts.isTypeLiteralNode(declaration.type)
    ? `${symbol.name}: { … }`
    : text
}

// Members acorn declares. A `string`'s methods or a `Promise`'s aren't part of the plugin API.
const ownMembers = (type, checker) =>
  checker.getPropertiesOfType(type).filter((member) => {
    const declaration = declarationOf(member)
    return declaration && !declaration.getSourceFile().fileName.includes('/node_modules/')
  })

function memberRows(type, checker, idPrefix, prefix) {
  return ownMembers(type, checker).map((member) => ({
    id: anchor(idPrefix, prefix, member.name),
    cells: [`${prefix}.${member.name}`, code(signatureOf(member)), docOf(member, checker)],
  }))
}

const MEMBER_HEAD = ['Member', 'Signature', 'What it does']

function nodeContextFacts() {
  const file = join(ROOT, 'packages/plugin-types/src/public.ts')
  const { program, checker } = compiler([file])
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file)))
  const named = (name) => {
    const symbol = exports.find((entry) => entry.name === name)
    if (!symbol) throw new Error(`acorn-plugin-types no longer exports ${name}.`)
    return checker.getAliasedSymbol(symbol)
  }
  const plugin = named('NodePlugin')
  const context = named('NodePluginContext')
  const contextType = checker.getDeclaredTypeOfSymbol(context)
  const parts = [
    '## The entry module',
    docOf(plugin, checker),
    table(MEMBER_HEAD, memberRows(checker.getDeclaredTypeOfSymbol(plugin), checker, 'plugin', 'plugin')),
    '## The context',
    docOf(context, checker),
    table(MEMBER_HEAD, memberRows(contextType, checker, 'ctx', 'ctx')),
  ]
  for (const member of checker.getPropertiesOfType(contextType)) {
    const type = checker.getTypeOfSymbolAtLocation(member, declarationOf(member))
    const rows = memberRows(type, checker, 'ctx', `ctx.${member.name}`)
    if (!rows.length) continue
    parts.push(`### ${code(`ctx.${member.name}`)}`, table(MEMBER_HEAD, rows))
    // `core` is the facets: list each one's own members too.
    if (member.name !== 'core') continue
    for (const facet of ownMembers(type, checker)) {
      const facetRows = memberRows(checker.getTypeOfSymbolAtLocation(facet, declarationOf(facet)), checker, 'ctx', `ctx.core.${facet.name}`)
      if (facetRows.length) parts.push(`#### ${code(`ctx.core.${facet.name}`)}`, table(MEMBER_HEAD, facetRows))
    }
  }
  return parts.join('\n\n')
}

// The SDK's four published entries, each a hand-written declaration file its build copies to dist.
const SDK_ENTRIES = [
  ['acorn-plugin-sdk', 'packages/plugin-sdk/src/public.ts'],
  ['acorn-plugin-sdk/remote', 'packages/plugin-sdk/src/remote/public.ts'],
  ['acorn-plugin-sdk/data', 'packages/plugin-sdk/src/data/public.ts'],
  ['acorn-plugin-sdk/testing', 'packages/plugin-sdk/src/testing/public.ts'],
]

function exportRow(entry, symbol, checker) {
  const declaration = declarationOf(symbol)
  const kind =
    symbol.flags & ts.SymbolFlags.Function
      ? 'function'
      : symbol.flags & ts.SymbolFlags.Class
        ? 'class'
        : symbol.flags & (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface)
          ? 'type'
          : 'value'
  const signature =
    kind === 'function'
      ? checker
          .getSignaturesOfType(checker.getTypeOfSymbolAtLocation(symbol, declaration), ts.SignatureKind.Call)
          .map((signature) => `${symbol.name}${checker.signatureToString(signature)}`)
          .join('; ')
      : kind === 'value'
        ? `${symbol.name}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, declaration))}`
        : `${kind === 'class' ? 'class' : 'type'} ${symbol.name}`
  return { id: anchor(entry, symbol.name), cells: [symbol.name, code(flat(signature)), docOf(symbol, checker)] }
}

function clientBridgeFacts() {
  const files = SDK_ENTRIES.map(([, path]) => join(ROOT, path))
  const { program, checker } = compiler(files)
  return SDK_ENTRIES.flatMap(([entry, path]) => {
    const file = program.getSourceFile(join(ROOT, path))
    const symbols = checker
      .getExportsOfModule(checker.getSymbolAtLocation(file))
      .map((symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol))
    if (!symbols.length) throw new Error(`${path} exports nothing the reference can read.`)
    const rows = symbols.flatMap((symbol) => {
      const row = exportRow(entry, symbol, checker)
      // A type's members are what an author calls, such as the bridge's `api.get`, so list them too.
      const members =
        row.cells[1].startsWith('`type ') || row.cells[1].startsWith('`class ')
          ? memberRows(checker.getDeclaredTypeOfSymbol(symbol), checker, entry, symbol.name)
          : []
      return [row, ...members]
    })
    return [`## ${code(entry)}`, table(['Export', 'Signature', 'What it does'], rows)]
  }).join('\n\n')
}

// ── Trees, points, verbs, limits, and the major ───────────────────────────────────────────────────

function treeFacts() {
  return [
    `Tree protocol version: **${TREE_PROTOCOL_VERSION}**.`,
    '## Kit nodes',
    `The ${number(KIT_NODES.length)} component names a tree may use. Any other name is refused: ${codeList(KIT_NODES)}.`,
    '## Events',
    `The ${number(KIT_EVENTS.length)} events a host sends back to a tree. A prop with one of these names carries a handler, and any other prop starting with ${code('on')} is dropped: ${codeList(KIT_EVENTS)}.`,
  ].join('\n\n')
}

function extensionPointFacts() {
  const rows = vocabulary.points.map((point) => {
    const how =
      point.kind === 'remote'
        ? `Tree, ${code(point.mode)}${point.mode === 'stack' ? `, up to ${point.max}` : ''}.${point.matches ? ` Keyed by ${point.matches}.` : ''}`
        : `Annotation, up to ${point.max} contributors, keyed by ${codeList(point.key)}.${point.acceptedMarks ? ` Keeps ${number(point.acceptedMarks)} marks from each.` : ''}${point.acceptsDetail ? ' Keeps each mark\'s `detail`.' : ''}`
    const props = point.kind === 'remote' ? code(point.props) : 'None: the host POSTs the keys it draws to your `items` route.'
    const notes = [
      point.actions && `Actions: ${codeList(point.actions)}.`,
      point.note && `${point.note[0].toUpperCase()}${point.note.slice(1)}.`,
    ].filter(Boolean)
    return {
      id: anchor('point', point.id),
      cells: [
        point.id,
        how,
        props,
        point.terminal ? `${point.terminal[0].toUpperCase()}${point.terminal.slice(1)}.` : "Draws wherever the terminal draws the owner's view.",
        notes.join(' '),
      ],
    }
  })
  return table(['Point', 'What it takes', 'Props', 'In the terminal', 'Notes'], rows)
}

function actionVerbFacts() {
  const full = members(contributions.properties.sources.items.properties.onSelect)
  const verbs = full.map((member) => {
    const { verb, ...fields } = member.properties
    return {
      id: anchor('verb', verb.const),
      cells: [
        verb.const,
        verb.description ?? '',
        Object.entries(fields)
          .map(([name, field]) => `${code(name)}: ${field.description}`)
          .join(' ') || 'Nothing.',
        ACTION_SETS.filter(([, set]) => set.includes(verb.const))
          .map(([name]) => name)
          .join('; '),
      ],
    }
  })
  const uses = CONTRIBUTION_KEYS.flatMap((key) =>
    actionFields(contributions.properties[key]).map(({ path, node }) => ({
      id: anchor('use', key, path),
      href: referenceUrl(contributionPage(key)),
      cells: [`${key}.${path}`, actionSet(node)],
    })),
  )
  return [
    '## The verbs',
    table(['Verb', 'What it does', 'Its fields', 'In'], verbs),
    '## Where each set is taken',
    table(['Field', 'Takes'], uses),
  ].join('\n\n')
}

// Constants owned where plain Node can't import them, read from their source as `const NAME = <number>`
// with `_` separators and `*` products allowed. A name the read can't find fails the build.
function constant(path, name) {
  const match = source(path).match(new RegExp(`const ${name} = ([\\d_ *]+)\\n`))
  if (!match) throw new Error(`Can't read ${name} from ${path}.`)
  return match[1]
    .split('*')
    .map((factor) => Number(factor.replace(/_/g, '').trim()))
    .reduce((a, b) => a * b, 1)
}

// The tree limits, each with the first sentence of its own doc comment in `TREE_LIMITS`.
function treeLimits() {
  const path = 'packages/protocol/src/tree/messages.ts'
  const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true)
  const comments = new Map()
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === 'TREE_LIMITS') {
      let literal = node.initializer
      while (literal && !ts.isObjectLiteralExpression(literal)) literal = literal.expression
      for (const property of literal?.properties ?? []) {
        const doc = ts.getJSDocCommentsAndTags(property).map((tag) => ts.getTextOfJSDocComment(tag.comment) ?? '')
        comments.set(property.name.getText(), flat(doc.join(' ')).split(/(?<=\.)\s/)[0])
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return Object.entries(TREE_LIMITS).map(([key, value]) => {
    if (!comments.get(key)) throw new Error(`TREE_LIMITS.${key} has no doc comment to describe it.`)
    const shown = key.endsWith('Bytes') ? bytes(value) : key.endsWith('Ms') ? seconds(value) : number(value)
    return [`Tree: ${key}`, shown, comments.get(key)]
  })
}

function limitFacts() {
  const broker = 'packages/client-core/src/host/frames/broker.ts'
  const packageFiles = 'packages/node-core/src/server/plugins/packageFiles.ts'
  const refresh = contributions.properties.slots.items.properties.refresh
  const limits = [
    ['Manifest size', bytes(constant(packageFiles, 'MAX_PLUGIN_MANIFEST_BYTES')), 'The largest `acorn-plugin.json` the Node reads.'],
    ['Client bundle size', bytes(constant(packageFiles, 'MAX_CLIENT_BUNDLE_BYTES')), 'The largest client bundle the Node loads.'],
    ['Bridge requests in flight', number(constant(broker, 'MAX_IN_FLIGHT')), 'Requests one frame may have waiting at once.'],
    [
      'Bridge messages per window',
      `${number(constant(broker, 'MAX_PER_WINDOW'))} per ${seconds(constant(broker, 'WINDOW_MS'))}`,
      'Messages one frame may send, of every kind together, telemetry included.',
    ],
    ['Bridge handshake', seconds(constant('packages/client-core/src/host/frames/PluginFrame.tsx', 'HANDSHAKE_DEADLINE_MS')), 'How long a frame has to post its first message before the host replaces it.'],
    ['Navigation rate', `${seconds(constant(broker, 'NAVIGATION_MIN_GAP_MS'))} apart`, "How often a focused frame may call `ui.openUrl` or `ui.openTask`."],
    ['Bytes over the bridge', bytes(MAX_PLUGIN_BYTES), 'The largest body `bridge.api.getBytes` or `postBytes` moves, each way.'],
    ['Frame state value', bytes(MAX_PLUGIN_STATE_BYTES), 'The largest value `state.set` stores.'],
    ['Document size', bytes(MAX_DOCUMENT_BYTES), "The largest text a document region's routes read or write."],
    ['Overlay input', bytes(MAX_OVERLAY_INPUT_BYTES), 'The largest value a tree hands an overlay it opens, or an overlay hands back.'],
    ['Tool schema size', bytes(runtime.PLUGIN_TOOL_SCHEMA_MAX_BYTES), "The largest JSON Schema an agent tool's or command line command's `inputSchema` may be."],
    ['Tool schema depth', `${number(runtime.PLUGIN_TOOL_SCHEMA_MAX_DEPTH)} levels`, 'How deeply that schema may nest.'],
    ['Tool timeout', seconds(runtime.PLUGIN_TOOL_TIMEOUT_MAX_MS), "The most an agent tool's `timeoutMs` may be."],
    ['Tool output', bytes(runtime.PLUGIN_TOOL_OUTPUT_MAX_BYTES), "The most an agent tool's `maxOutputBytes` may be."],
    ['Context section size', bytes(runtime.PLUGIN_CONTEXT_SECTION_MAX_BYTES), "The most a context section's `maxBytes` may be."],
    ['Context section tokens', number(runtime.PLUGIN_CONTEXT_SECTION_MAX_TOKENS), "The most a context section's `maxTokens` may be."],
    ['Context section timeout', seconds(runtime.PLUGIN_CONTEXT_TIMEOUT_MAX_MS), "The most a context section's `timeoutMs` may be."],
    ['Command line input', bytes(PLUGIN_CLI_INPUT_MAX_BYTES), 'The largest input `acorn plugin` sends a command.'],
    ['Command line output', bytes(PLUGIN_CLI_OUTPUT_MAX_BYTES), "The largest answer a command's route may give."],
    ['Schedule cadence', `every ${number(CADENCE_MIN_SECONDS_PLUGIN)} seconds`, "The most often a plugin's schedule runs, whatever its cadence asks."],
    ['Descriptor refresh', `${number(refresh.minimum)} to ${number(refresh.maximum)} seconds`, 'The range a `refresh` may take.'],
    ...treeLimits(),
  ]
  return table(
    ['Limit', 'Value', 'What it bounds'],
    limits.map(([name, value, what]) => ({ id: anchor('limit', name), cells: [name, value, what] })),
  )
}

function compatibilityFacts() {
  return `This acorn speaks plugin API major **<ApiMajor />**. A manifest's ${code('apiVersion')} must include it.`
}

/** Every generated page's facts, by its path under the reference folder. */
export function referenceFacts() {
  return {
    'manifest-reference': manifestFacts(),
    contributions: contributionsIndexFacts(),
    ...Object.fromEntries(CONTRIBUTION_KEYS.map((key) => [contributionPage(key), contributionFacts(key)])),
    permissions: permissionsFacts(),
    'the-node-context': nodeContextFacts(),
    'the-client-bridge': clientBridgeFacts(),
    'trees-and-events': treeFacts(),
    'extension-points': extensionPointFacts(),
    'action-verbs': actionVerbFacts(),
    limits: limitFacts(),
    'compatibility-and-versions': compatibilityFacts(),
  }
}
