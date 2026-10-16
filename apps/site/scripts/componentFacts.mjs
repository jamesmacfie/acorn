// The facts half of each Components page (docs/site/references.md § The component pages). Each entry is
// MDX that `reference.mjs` puts where the page's written half says `{/* facts */}`. A node's props are
// read from the type of the component each host draws it with, its levels and focus from the kit's own
// tables, and its 80 by 24 sentence from docs/ui-design/every-node.md, so a page can't say anything
// the kit doesn't.
import './tsResolve.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { appearances } from './acornUi.mjs'
import { anchor, code, codeList, declarationOf, docOf, flat, table } from './factsFormat.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const source = (path) => readFileSync(join(ROOT, path), 'utf8')
// The kit's token tables have no package export, and the barrel that has some of them pulls in code
// plain Node can't strip, so each file is imported by its path.
const kitTokens = (file) => import(pathToFileURL(join(ROOT, 'packages/client-core/src/kit/tokens', file)).href)

const { NODE_SUPPORT } = await kitTokens('support.ts')
const { NODE_FOCUS, OWNS_KEYS } = await kitTokens('focusRoles.ts')
const { ROLE_MAP } = await kitTokens('roles.ts')
const { FORBIDDEN_PROPS, KIT_EVENTS, KIT_NODES, ROLE_PROPS } = await import('@acorn/protocol/tree/nodes.ts')
const { LAYOUT_REGIONS, PANE_LAYOUTS } = await import('@acorn/protocol/paneLayouts.ts')

// ── Pages ─────────────────────────────────────────────────────────────────────────────────────────

/** The sidebar's groups, in order, and the nodes in each. Every kit node is in exactly one. */
const COMPONENT_GROUPS = {
  grouping: [
    'Pane', 'Stack', 'Inline', 'Section', 'SectionHeader', 'Fold', 'Card', 'Tabs', 'TabPanel', 'DocumentTabs',
    'Toolbar', 'ToolbarSpacer', 'FilterBar', 'ListDetail', 'ListColumn', 'DetailColumn', 'Sections',
    'SplitHandle', 'SettingsSection', 'SettingRow',
  ],
  content: [
    'Text', 'Link', 'Heading', 'Badge', 'Chip', 'StatusDot', 'Facts', 'DescriptionList', 'Meter', 'CodeBlock',
    'Log', 'Markdown', 'EmptyState', 'Alert', 'Spinner', 'Kbd', 'UserAvatar', 'Icon', 'DiffPane', 'DiffLine',
    'FileHead', 'StackedDiff', 'NonCodeRow', 'SplitCell',
  ],
  collections: [
    'Rows', 'Row', 'TreeRow', 'RowActions', 'ChipRow', 'Table', 'TableHead', 'TableRow', 'TableCell', 'Grid',
    'Graph', 'Timeline', 'HistoryMark',
  ],
  inputs: [
    'Button', 'IconButton', 'ConfirmButton', 'ToggleButton', 'CopyButton', 'Input', 'Textarea', 'Select',
    'Checkbox', 'SegmentedControl', 'Picker', 'PickerRow', 'Composer', 'MentionTextarea', 'KeyValueEditor',
    'FindBar', 'Field', 'ModelBackendPicker',
  ],
  overlays: ['Modal', 'ModalBody', 'ModalActions', 'Menu', 'Popover'],
  rectangles: ['Rectangle', 'Only', 'Fallback'],
}

const kebab = (name) => name.replace(/(?<=[a-z0-9])[A-Z]/g, (letter) => `-${letter}`).toLowerCase()

/** Each kit node's page, by its path under the components folder: `inputs/icon-button`. Throws on a
 *  node in no group, in two, or a group naming a node the kit doesn't have. */
export function componentPages(nodes = KIT_NODES) {
  const pages = new Map()
  const problems = []
  for (const [group, members] of Object.entries(COMPONENT_GROUPS))
    for (const node of members) {
      if (!nodes.includes(node)) problems.push(`COMPONENT_GROUPS.${group} names ${node}, which isn't a kit node.`)
      else if (pages.has(node)) problems.push(`${node} is in two groups.`)
      else pages.set(node, `${group}/${kebab(node)}`)
    }
  for (const node of nodes)
    if (!pages.has(node)) problems.push(`${node} is a kit node with no group. Add it to COMPONENT_GROUPS in scripts/componentFacts.mjs.`)
  if (problems.length) throw new Error(problems.join('\n'))
  return pages
}

const pageUrl = (page) => `/docs/components/${page}/`

// ── The 80 by 24 sentences ────────────────────────────────────────────────────────────────────────

// The rows of § Every node at 80 by 24, read the way tools/arch/kitTable.test.ts reads them: every row
// of every table under the heading is `| `Node` | focus | sentence |`. That test holds the page to the
// kit, so a row exists for every node.
function terminalSentences() {
  const page = source('docs/ui-design/every-node.md')
  const start = page.indexOf('## Every node at 80 by 24')
  if (start === -1) throw new Error('docs/ui-design/every-node.md has no § Every node at 80 by 24.')
  const rows = page.slice(start).matchAll(/^\| `([A-Za-z][A-Za-z0-9]*)` \| ([a-z-]+) \| (.+?) \|$/gm)
  return new Map([...rows].map(([, node, , sentence]) => [node, sentence.trim().replace(/\s+/g, ' ')]))
}

// ── Props, from the components ────────────────────────────────────────────────────────────────────

// One program over the DOM host's component table, compiled the way client-core compiles itself.
function kitProgram() {
  const config = ts.getParsedCommandLineOfConfigFile(join(ROOT, 'packages/client-core/tsconfig.json'), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    },
  })
  const file = join(ROOT, 'packages/client-core/src/host/tree/components.ts')
  const program = ts.createProgram([file], { ...config.options, noEmit: true })
  return { program, checker: program.getTypeChecker(), file: program.getSourceFile(file) }
}

/** Each node's props type, from `KIT_COMPONENTS`: the component an entry names, or the export its
 *  loader imports. */
function propsTypes({ checker, file }) {
  let literal
  const find = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === 'KIT_COMPONENTS') literal = node.initializer
    else ts.forEachChild(node, find)
  }
  find(file)
  if (!literal) throw new Error('packages/client-core/src/host/tree/components.ts has no KIT_COMPONENTS.')
  const types = new Map()
  for (const entry of literal.properties) {
    const at = ts.isShorthandPropertyAssignment(entry) ? entry.name : entry.initializer
    let component = checker.getTypeAtLocation(at)
    let call
    const findImport = (node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) call = node
      else ts.forEachChild(node, findImport)
    }
    findImport(at)
    if (call) {
      const name = at.getText().match(/m\.(\w+)/)?.[1] ?? 'default'
      const exported = checker.getExportsOfModule(checker.getSymbolAtLocation(call.arguments[0])).find((symbol) => symbol.name === name)
      component = checker.getTypeOfSymbolAtLocation(exported, call)
    }
    const parameter = component.getCallSignatures()[0]?.getParameters()[0]
    types.set(entry.name.getText(), { type: parameter ? checker.getTypeOfSymbolAtLocation(parameter, at) : undefined, at })
  }
  return types
}

const forbidden = new Set(FORBIDDEN_PROPS)
const events = new Set(KIT_EVENTS)
const FORMAT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType
const members = (type) => (type.isUnion() ? type.types : [type])
const isFunction = (type) => type.getCallSignatures().length > 0
// A slot for an element. A tree can't send one, but a string or a number is an element too.
const isElement = (type) => ['Node', 'ArrayElement', 'Element'].includes(type.getSymbol()?.getName() ?? type.aliasSymbol?.getName())

/** An object type declared in acorn, or one written inline, whose fields deserve a table of their own.
 *  An inline one is headed by the prop that takes it. */
function declaredObject(prop, type, checker) {
  const list = checker.isArrayType(type)
  const element = list ? checker.getTypeArguments(type)[0] : type
  const symbol = element?.aliasSymbol ?? element?.getSymbol()
  const declaration = symbol && declarationOf(symbol)
  if (!declaration || declaration.getSourceFile().fileName.includes('/node_modules/')) return undefined
  if (!(element.flags & ts.TypeFlags.Object) || isFunction(element) || isElement(element)) return undefined
  if (!checker.getPropertiesOfType(element).length) return undefined
  const inline = symbol.getName().startsWith('__')
  return { heading: inline ? `Each ${list ? 'entry in' : 'field of'} ${code(prop)}` : code(symbol.getName()), inline, list, type: element }
}

// A union named by an alias, such as `Placement`, is spelled out, since the alias is nothing a reader
// can look up. An object alias keeps its name, and gets a table of its own.
const spelled = (type, checker) =>
  type.aliasSymbol && type.isUnion()
    ? type.types.map((member) => checker.typeToString(member, undefined, FORMAT)).join(' | ')
    : checker.typeToString(type, undefined, FORMAT)

/** A prop's type as a tree can send it, or undefined when nothing of it can cross. */
function wireType(type, checker) {
  const kept = members(type).filter((member) => !isFunction(member))
  if (!kept.length) return undefined
  if (kept.some(isElement)) return 'text'
  const text = kept.length === members(type).length ? spelled(type, checker) : kept.map((member) => spelled(member, checker)).join(' | ')
  return text.replace(/\bfalse \| true\b/g, 'boolean')
}

const fieldRow = (idPrefix, symbol, typeText, checker) => ({
  id: anchor(idPrefix, symbol.name),
  cells: [symbol.name, code(typeText), symbol.flags & ts.SymbolFlags.Optional ? 'No' : 'Yes', docOf(symbol, checker)],
})

/** What a node's props page says: the props a tree can pass, the events, the children, the shapes of
 *  any object a prop takes, and the props only shell code can pass. */
function nodeProps(node, { type, at }, checker) {
  const props = type ? checker.getPropertiesOfType(type) : []
  const typeOf = (symbol) => checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(symbol, at))
  const rows = []
  const eventRows = []
  const shellOnly = []
  const shapes = new Map()
  let children = 'none'
  for (const prop of props) {
    const propType = typeOf(prop)
    if (prop.name === 'children') {
      children = members(propType).some(isFunction) && !members(propType).some(isElement) ? 'function' : 'nodes'
      continue
    }
    if (forbidden.has(prop.name)) continue
    if (events.has(prop.name)) {
      const signature = members(propType).find(isFunction)?.getCallSignatures()[0]
      const sends = signature?.getParameters().map((parameter) => `${parameter.name}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(parameter, at), undefined, FORMAT)}`)
      eventRows.push({ id: anchor('event', prop.name), cells: [prop.name, sends?.length ? code(sends.join(', ')) : 'Nothing', docOf(prop, checker)] })
      continue
    }
    const wire = wireType(propType, checker)
    if (wire === undefined || prop.name.startsWith('on')) {
      shellOnly.push(prop.name)
      continue
    }
    const shape = declaredObject(prop.name, propType, checker)
    if (shape) shapes.set(shape.heading, shape.type)
    rows.push(fieldRow('prop', prop, shape?.inline ? (shape.list ? '{ … }[]' : '{ … }') : wire, checker))
  }
  const parts = ['## Props']
  parts.push(rows.length ? table(['Prop', 'Type', 'Required', 'What it does'], rows) : `${code(node)} takes no props.`)
  parts.push(
    {
      nodes: `${code(node)} takes other nodes as its children.`,
      function: `Its children are a function, which can't cross from a tree.`,
      none: `${code(node)} takes no children.`,
    }[children],
  )
  for (const [heading, shape] of shapes) {
    const fields = checker.getPropertiesOfType(shape).map((field) => {
      const fieldType = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(field, at))
      return [field, wireType(fieldType, checker)]
    })
    parts.push(`### ${heading}`, table(['Field', 'Type', 'Required', 'What it does'], fields.filter(([, wire]) => wire).map(([field, wire]) => fieldRow(heading, field, wire, checker))))
  }
  if (shellOnly.length)
    parts.push(`Shell code can also pass ${codeList(shellOnly)}. ${shellOnly.length === 1 ? 'It is a function' : 'They are functions'} outside the ${KIT_EVENTS.length} events, so a tree's ${shellOnly.length === 1 ? 'is' : 'are'} dropped.`)
  parts.push('## Events')
  parts.push(
    eventRows.length
      ? table(['Event', 'Sends', 'What it does'], eventRows)
      : `${code(node)} sends no events. [Trees and events](/docs/build-plugins/reference/trees-and-events/) lists the ${KIT_EVENTS.length} a node can send.`,
  )
  return parts
}

// ── Hosts and focus ───────────────────────────────────────────────────────────────────────────────

const LEVELS = {
  full: 'Drawn with the same meaning.',
  reduced: 'Drawn, with named things missing.',
  fallback: 'Not drawn. The host draws a stated substitute.',
  absent: 'Not drawn, unless the node has a `Fallback` child.',
}

const FOCUS = {
  stop: 'One tab stop.',
  collection: 'One tab stop. The arrow keys move between its items, and the host keeps which one is active and selected.',
  item: "An item in a collection. The collection's arrow keys reach it, and it's never a tab stop of its own.",
  trap: "Holds focus while it's open, and gives focus back to whatever opened it when it closes.",
  none: 'Not focusable.',
  conditional: 'A tab stop only when it has something to do, such as a handler.',
}

const capital = (text) => text[0].toUpperCase() + text.slice(1)
const sentence = (text) => (/[.!?]$/.test(text) ? capital(text) : `${capital(text)}.`)

// What a level costs, where a `reduced` row's own `loss` doesn't say.
const LOST = { full: 'Nothing.', fallback: 'The node itself. The substitute is described beside it.', absent: 'The whole node.' }

function hostFacts(node, sentences) {
  const { dom, tui, loss } = NODE_SUPPORT[node]
  const lost = (level) => (level === 'reduced' ? sentence(loss) : LOST[level])
  return [
    '## On each host',
    table(['Host', 'Level', 'What it loses', 'What it draws'], [
      { id: 'host-desktop', cells: ['Desktop', `\`${dom}\`: ${LEVELS[dom]}`, lost(dom), 'The desktop picture above.'] },
      { id: 'host-terminal', cells: ['Terminal', `\`${tui}\`: ${LEVELS[tui]}`, lost(tui), `At 80 by 24 in monochrome: ${sentence(sentences.get(node))}`] },
    ]),
    '## Focus',
    `${code(NODE_FOCUS[node])}: ${FOCUS[NODE_FOCUS[node]]}${OWNS_KEYS.includes(node) ? ' While it has focus it takes every key typed, except the shortcuts that work while typing.' : ''}`,
  ]
}

function nodeFacts(node, props, sentences, checker) {
  if (!sentences.has(node)) throw new Error(`docs/ui-design/every-node.md has no row for ${node}.`)
  if (!props) throw new Error(`KIT_COMPONENTS has no component for ${node}.`)
  return [...nodeProps(node, props, checker), ...hostFacts(node, sentences)].join('\n\n')
}

// ── The section's concept pages ───────────────────────────────────────────────────────────────────

function overviewFacts(pages) {
  const rows = [...pages].map(([node, page]) => ({
    id: anchor('node', node),
    href: pageUrl(page),
    cells: [node, capital(page.split('/')[0]), code(NODE_SUPPORT[node].dom), code(NODE_SUPPORT[node].tui), code(NODE_FOCUS[node])],
  }))
  const count = (level) => KIT_NODES.filter((node) => NODE_SUPPORT[node].tui === level).length
  return [
    table(['Level', 'What the host does'], Object.entries(LEVELS).map(([level, what]) => ({ id: anchor('level', level), cells: [level, what] }))),
    `## Every component`,
    `In the terminal, ${count('full')} of the ${KIT_NODES.length} components draw in full, ${count('reduced')} reduced, ${count('fallback')} as a fallback, and ${count('absent')} not at all.`,
    table(['Component', 'Group', 'Desktop', 'Terminal', 'Focus'], rows),
  ].join('\n\n')
}

// Each role enum's doc comment in the kit's token file, which says what the enum is for.
function roleDocs() {
  const path = 'packages/client-core/src/kit/tokens/tokens.ts'
  const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true)
  const docs = new Map()
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const doc = ts.getJSDocCommentsAndTags(statement).map((tag) => ts.getTextOfJSDocComment(tag.comment) ?? '')
    for (const declaration of statement.declarationList.declarations) docs.set(declaration.name.getText(), flat(doc.join(' ')))
  }
  return docs
}

function roleFacts() {
  const docs = roleDocs()
  return Object.entries(ROLE_MAP)
    .flatMap(([role, { dom, tui }]) => {
      if (!docs.get(role)) throw new Error(`The ${role} role has no doc comment in kit/tokens/tokens.ts.`)
      const props = Object.entries(ROLE_PROPS).filter(([, enumName]) => enumName === role).map(([prop]) => prop)
      return [
        `## ${capital(role)}`,
        `${docs.get(role)}${props.length ? ` Props that take it: ${codeList(props)}.` : ''}`,
        table(['Value', 'Desktop token', 'Terminal'], Object.keys(dom).map((value) => ({
          id: anchor(role, value),
          cells: [value, code(dom[value]), capital(tui[value].said)],
        }))),
      ]
    })
    .join('\n\n')
}

function layoutFacts() {
  const regions = (names) => (names.length ? codeList(names) : 'None')
  return table(['Layout', 'Required regions', 'Optional regions'], PANE_LAYOUTS.map((layout) => {
    const { required, optional, prefix } = LAYOUT_REGIONS[layout]
    return {
      id: anchor('layout', layout),
      href: `#${layout}`,
      cells: [layout, prefix ? `One ${code(`${prefix}<tab id>`)} per tab` : regions(required), regions(optional)],
    }
  }))
}

// The terminal's one-cell marks, read as text because apps don't import each other.
function terminalGlyphs() {
  const path = 'apps/tui/src/kit/glyphs.ts'
  const body = source(path).match(/const GLYPHS: Record<string, string> = \{([\s\S]*?)\n\}/)?.[1]
  const glyphs = Object.fromEntries([...(body ?? '').matchAll(/^\s+'?([a-z0-9-]+)'?: '(.)',$/gmu)].map(([, name, glyph]) => [name, glyph]))
  if (!Object.keys(glyphs).length) throw new Error(`Can't read GLYPHS from ${path}.`)
  return glyphs
}

// Core's own brand marks, read as text because their module registers them as it loads.
function coreBrandMarks() {
  const path = 'packages/client-core/src/kit/tokens/brandMarks.ts'
  const marks = [...source(path).matchAll(/\{\s*\n\s+id: '([^']+)',\s*\n\s+(?:color: '(#[0-9a-f]{6})',\s*\n\s+)?d: '([^']+)'/g)].map(([, id, color, d]) => ({ id, color, d }))
  if (!marks.length) throw new Error(`Can't read the core marks from ${path}.`)
  return marks
}

function iconFacts() {
  return `<IconSet glyphs={${JSON.stringify(terminalGlyphs())}} brands={${JSON.stringify(coreBrandMarks())}} />`
}

// The colors a swatch shows, by the token the theme sets.
const SWATCH = { '--bg': 'Background', '--text': 'Text', '--text-muted': 'Muted', '--accent': 'Accent', '--add-marker': 'OK', '--warn': 'Warn', '--del-marker': 'Danger' }

/** Each theme's own primitives from `tokens-theme.css`: the plain `:root` block is the light theme, and
 *  every `:root[data-theme="…"]` block overrides it. */
function themeColors() {
  const css = source('packages/client-core/src/infra/styles/tokens-theme.css')
  const declarations = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]))
  const light = declarations(css.match(/^:root \{([\s\S]*?)^\}/m)?.[1] ?? '')
  const themes = new Map([['light', light]])
  for (const [, id, body] of css.matchAll(/^:root\[data-theme="([\w-]+)"\] \{([\s\S]*?)^\}/gm)) themes.set(id, { ...light, ...declarations(body) })
  return themes
}

function themeFacts() {
  const colors = themeColors()
  const { themes, styles, dark } = appearances()
  const swatches = themes.map(({ id, label }) => {
    const set = colors.get(id)
    if (!set) throw new Error(`tokens-theme.css has no block for the ${id} theme.`)
    return { id, label, dark: dark.includes(id), colors: Object.entries(SWATCH).map(([token, name]) => ({ token, name, value: set[token] })) }
  })
  const missing = swatches.flatMap(({ id, colors: set }) => set.filter(({ value }) => !value).map(({ token }) => `${id} ${token}`))
  if (missing.length) throw new Error(`tokens-theme.css doesn't set ${missing.join(', ')}.`)
  return [
    `<ThemeSwatches themes={${JSON.stringify(swatches)}} />`,
    '## Style packs',
    table(['Pack', 'Name in Settings'], styles.map(({ id, label }) => ({ id: anchor('style', id), cells: [id, label] }))),
  ].join('\n\n')
}

function focusFacts(pages) {
  return table(['Focus', 'What it means', 'Components'], Object.entries(FOCUS).map(([role, what]) => ({
    id: anchor('focus', role),
    cells: [role, what, KIT_NODES.filter((node) => NODE_FOCUS[node] === role).map((node) => `[${node}](${pageUrl(pages.get(node))})`).join(', ')],
  })))
}

const refusedFacts = () => `No node accepts these props, whatever its type says. The host drops them before they reach a component: ${codeList(FORBIDDEN_PROPS)}.`

/** Every generated page's facts, by its path under the components folder. */
export function componentFacts() {
  const pages = componentPages()
  const sentences = terminalSentences()
  const kit = kitProgram()
  const props = propsTypes(kit)
  return {
    'one-kit-two-hosts': overviewFacts(pages),
    'roles-and-tokens': roleFacts(),
    layouts: layoutFacts(),
    icons: iconFacts(),
    'themes-and-style-packs': themeFacts(),
    'keyboard-and-accessibility': focusFacts(pages),
    'what-the-kit-refuses': refusedFacts(),
    ...Object.fromEntries([...pages].map(([node, page]) => [page, nodeFacts(node, props.get(node), sentences, kit.checker)])),
  }
}
