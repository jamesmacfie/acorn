// Every default keyboard shortcut, read from the code that registers it, for the Keyboard shortcuts
// reference (docs/site.md). There's no one table to import: core, each client, and each plugin register
// their own, mostly when a component mounts, so this reads each registration as text. A loaded plugin
// declares its shortcuts in its manifest config, which this imports.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { shippedPlugins } from './pluginPages.mjs'
import { ROOT } from './stale.mjs'

const CORE_ROOTS = ['packages/client-core/src', 'apps/desktop/src/client', 'apps/tui/src']
const SOURCE = /\.tsx?$/
const SKIP = /\.test\.|\.spec\.|(?:^|\/)test\/|fixture/i

// Registered inside `<Only hosts={['tui']}>`, so only the terminal client has them.
const TERMINAL_ONLY = [
  'plugins/agents/src/client/composer/TerminalComposerShortcut.tsx',
  'plugins/agents/src/client/sessions/TerminalConversationShortcuts.tsx',
]

// Registrations whose text can't say what they do or where, keyed `<file> <chord>`. Each fills in what
// the source computes at run time. The test fails on a key that matches nothing.
const OVERRIDES = {
  'packages/client-core/src/host/frames/register.ts escape': {
    description: "Close a plugin's overlay",
    category: 'Plugins',
    where: 'While a plugin overlay is open',
  },
  'packages/client-core/src/host/palette/WorkspacePalette.tsx meta+l': { description: 'Switch project or workspace' },
  'packages/client-core/src/features/tabs/TabRail.tsx meta+${index + 1}': { description: 'Open that task in the rail' },
  'packages/client-core/src/features/diff/DiffPane.tsx meta+f': { description: 'Find in the diff', category: 'Changes', where: 'In a diff' },
  'apps/desktop/src/client/App.tsx meta+;': { description: 'Switch to the last project or workspace' },
  'apps/desktop/src/client/TaskView.tsx escape': { description: 'Bring back the pane row', where: 'In a maximized pane' },
  'apps/tui/src/chrome/Shell.tsx w': { description: 'Switch workspace' },
  'apps/tui/src/chrome/Shell.tsx ;': { description: 'Switch to the last workspace' },
  'plugins/terminal/src/client/TerminalPanel.tsx meta+shift+${index + 1}': { description: 'Focus that terminal in the drawer' },
  'plugins/git/src/client/changes/commands.ts meta+enter': { where: "In the Git pane's message box" },
  'plugins/git/src/client/changes/commands.ts meta+alt+enter': { where: "In the Git pane's message box" },
  // Registered in a loop that adds the category and scope.
  'plugins/editor/src/client/index.ts meta+alt+w': { category: 'Editor', where: 'In the Editor pane' },
  'plugins/editor/src/client/index.ts meta+shift+t': { category: 'Editor', where: 'In the Editor pane' },
  'plugins/editor/src/client/index.ts alt+left': { category: 'Editor', where: 'In the Editor pane' },
  'plugins/editor/src/client/index.ts alt+right': { category: 'Editor', where: 'In the Editor pane' },
}

const CHORD = /\b(defaultChord|toggleChord): (?:'([^']*)'|`([^`]*)`)/g
const NUMBERED = '${index + 1}'

/** The object literal around `index`, by counting braces out from it. */
function enclosingObject(text, index) {
  let start = index
  for (let depth = 0; start > 0; start--) {
    if (text[start] === '}') depth++
    else if (text[start] === '{' && depth-- === 0) break
  }
  let end = index
  for (let depth = 0; end < text.length; end++) {
    if (text[end] === '{') depth++
    else if (text[end] === '}' && depth-- === 0) break
  }
  return text.slice(start, end + 1)
}

const literal = (object, key) => object.match(new RegExp(`\\b${key}: '([^']*)'`))?.[1]

const files = (dir) =>
  readdirSync(join(ROOT, dir), { recursive: true })
    .map((file) => `${dir}/${file}`)
    .filter((file) => SOURCE.test(file) && !SKIP.test(file))

/** Every chord written in client source, as `{ file, chord, description?, category?, when?, pane?,
 *  label? }`, before overrides. A pane's own chord carries the pane's `label`. */
export function sourceRegistrations() {
  const { compiled, bundled } = shippedPlugins()
  const roots = [...CORE_ROOTS, ...[...compiled, ...bundled].map((id) => `plugins/${id}/src`)]
  return roots.flatMap(files).flatMap((file) => {
    const text = readFileSync(join(ROOT, file), 'utf8')
    // An empty default is a shortcut that starts unbound, so it has no row in a list of defaults.
    return [...text.matchAll(CHORD)].filter((match) => match[2] ?? match[3]).map((match) => {
      const object = enclosingObject(text, match.index)
      return {
        file,
        chord: match[2] ?? match[3],
        // A pane contribution has an `order` in the row, and its chord shows the pane.
        ...(/\border: \d/.test(object)
          ? { label: literal(object, 'label'), category: 'Panes', when: 'task' }
          : {
              description: literal(object, 'description') ?? literal(object, 'title'),
              category: literal(object, 'category') ?? (match[1] === 'toggleChord' ? 'Global' : undefined),
              when: literal(object, 'when') ?? (match[1] === 'toggleChord' ? 'global' : undefined),
              pane: literal(object, 'pane'),
            }),
      }
    })
  })
}

const WHERE = { global: 'Anywhere', 'typing-exempt': 'Anywhere', task: 'In a task' }

/** One row per default shortcut, with what it does and where it works. `to` is the last chord of a
 *  numbered run, such as ⌘1 to ⌘9. `terminal` marks the terminal client's own. */
export function shortcutRows(registrations, overrides = OVERRIDES) {
  const paneLabels = Object.fromEntries(registrations.filter((row) => row.label).map((row) => [row.file, row.label]))
  return registrations.map((row) => {
    const fill = overrides[`${row.file} ${row.chord}`] ?? {}
    const numbered = row.chord.includes(NUMBERED)
    const label = row.label ?? paneLabels[row.pane]
    return {
      chord: row.chord.replace(NUMBERED, '1'),
      ...(numbered ? { to: row.chord.replace(NUMBERED, '9') } : {}),
      description: fill.description ?? row.description ?? (row.label ? `Show the ${row.label} pane` : undefined),
      category: fill.category ?? row.category,
      where: fill.where ?? (row.when === 'pane' ? (label && `In the ${label} pane`) : WHERE[row.when]),
      terminal: row.file.startsWith('apps/tui/') || TERMINAL_ONLY.includes(row.file),
      desktop: !row.file.startsWith('apps/tui/') && !TERMINAL_ONLY.includes(row.file),
      file: row.file,
    }
  })
}

/** Each bundled package's shortcuts, from its manifest config. */
async function manifestRows() {
  const { bundled } = shippedPlugins()
  const configs = await Promise.all(
    bundled.map(async (id) => (await import(pathToFileURL(join(ROOT, 'plugins', id, 'acorn-plugin.config.mjs')).href)).default),
  )
  return configs.flatMap((config, index) => {
    const { commands = [], keybindings = [], frames = [] } = config.contributions ?? {}
    return keybindings.map((binding) => {
      const surface = frames.find((frame) => frame.id === binding.surface)
      return {
        chord: binding.defaultChord,
        description: commands.find((command) => command.id === binding.command)?.title,
        category: config.name,
        where: binding.when === 'surface' ? `In the ${surface?.label ?? binding.surface} pane` : WHERE[binding.when],
        terminal: false,
        desktop: true,
        file: `plugins/${bundled[index]}/acorn-plugin.config.mjs`,
      }
    })
  })
}

/** Every default shortcut, from source and from the bundled packages' manifests. */
export async function defaultShortcuts() {
  return [...shortcutRows(sourceRegistrations()), ...(await manifestRows())]
}

/** What the reference can't say: a row with no description, category, or place, and an override that
 *  matches no registration. */
export function shortcutProblems(rows, registrations, overrides = OVERRIDES) {
  const keys = new Set(registrations.map((row) => `${row.file} ${row.chord}`))
  return [
    ...rows
      .filter((row) => !row.description || !row.category || !row.where)
      .map((row) => `${row.file} registers ${row.chord} without a description, category, or scope this script can read`),
    ...Object.keys(overrides)
      .filter((key) => !keys.has(key))
      .map((key) => `The override for ${key} matches no registration`),
  ]
}

/** Serves `virtual:acorn-keybindings`, read again on every build and dev start. The rows come from
 *  running this script as its own process, as the command line's help does, because the runner that
 *  loads the site's config can't import the packages' manifest configs, and a bundled page can't find
 *  the repository's files. */
export function keybindingsModule() {
  const id = 'virtual:acorn-keybindings'
  return {
    name: 'acorn-keybindings',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load: (source) =>
      source === `\0${id}`
        ? `export default ${execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })}`
        : undefined,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(JSON.stringify(await defaultShortcuts()))
