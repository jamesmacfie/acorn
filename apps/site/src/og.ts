// The social cards, the picture a shared link shows. scripts/og.mjs draws each one from /lab/og/<name>/
// into public/og/<name>.png, and a page's head points at its card. A marketing page has a card of its
// own, named for its path, and a docs page uses its sidebar group's card (`docsSection` in nav.ts).
// Redraw a card after its page's headline or its group's title changes (docs/site/agent-outputs.md §
// Social cards).
import { FEATURES } from './features.ts'

interface Card {
  /** The line above the title, such as "Docs" or "Build plugins". */
  section: string
  title: string
  description: string
}

/** The card a marketing page uses: `home` for `/`, and `features-agents` for `/features/agents/`. */
export const marketingCard = (path: string) =>
  path === '/' ? 'home' : path.replace(/^\/|\/$/g, '').replaceAll('/', '-')

/** The card a page with neither, such as the 404 page, falls back to. */
export const FALLBACK_CARD = 'home'

const docs = (title: string, description: string): Card => ({ section: 'Docs', title, description })
const build = (title: string, description: string): Card => ({ section: 'Build plugins', title, description })

export const CARDS: Record<string, Card> = {
  home: {
    section: 'Claude Code and Codex',
    title: 'A workspace for working with coding agents, one task at a time.',
    description: 'Each task gets a branch, a Git worktree, terminals, and agent sessions.',
  },
  features: {
    section: 'Features',
    title: 'Features',
    description: 'What acorn does, one part at a time, each with a picture and a way into the docs.',
  },
  ...Object.fromEntries(
    Object.entries(FEATURES).map(([id, { title, sentence }]) => [
      `features-${id}`,
      { section: 'Features', title, description: sentence },
    ]),
  ),
  download: {
    section: 'Download',
    title: 'Download acorn',
    description: 'The desktop app, the terminal client, the standalone Node, the browser extension, and the source.',
  },
  changelog: { section: 'Changelog', title: 'Changelog', description: 'What changed in acorn, newest first.' },
  plugins: {
    section: 'Plugins',
    title: 'Plugins',
    description: 'The plugins acorn ships, what each adds, and where it works.',
  },
  'docs-start-here': docs('Start here', 'Install acorn, open your first task, and learn the model it hangs on.'),
  'docs-using-acorn': docs('Using acorn', 'Workspaces, tasks, worktrees, panes, and the tools around them.'),
  'docs-agents': docs('Agents', 'Run Claude Code and Codex sessions in a task, and answer what they ask.'),
  'docs-security': docs('Security', 'What acorn keeps from your agents and plugins, and how.'),
  'docs-settings': docs('Settings', 'Every page under Settings, and what each setting does.'),
  'docs-built-in-plugins': docs('Built-in plugins', 'The plugins acorn ships, and how to set each one up.'),
  'docs-nodes-and-devices': docs(
    'Nodes and devices',
    'Pair a device or a remote Node, run a standalone Node, and back one up.',
  ),
  'docs-browser-extension': docs('Browser extension', "Talk to a task's agent from Chrome or Firefox."),
  'docs-automation': docs('Automation', 'Workflows, schedules, dashboards, and the command line.'),
  'docs-reference': docs(
    'Reference',
    'The command line, keyboard shortcuts, configuration files, and environment variables.',
  ),
  'docs-help': docs('Help', 'Troubleshooting, the FAQ, and known limits.'),
  'build-plugins-start': build('Start', 'Build your first plugin, and choose how it draws.'),
  'build-plugins-draw-in-acorn': build(
    'Draw in acorn',
    'A guide for every place a plugin draws, in the desktop app and the terminal client.',
  ),
  'build-plugins-node-agents-data-and-the-browser': build(
    'Node, agents, data, and the browser',
    "Storage, services, agent tools, harnesses, workflow steps, and the browser extension, from a plugin's Node half.",
  ),
  'build-plugins-reference': build('Reference', 'The manifest, every contribution, the permissions, and the limits.'),
  'build-plugins-components': build(
    'Components',
    'Every kit component, drawn by the desktop app and the terminal client.',
  ),
}
