// Navigation for the wireframes: the two docs sidebars, the header, and the footer. The groups follow the
// site map. A group lists its pages only where a wireframe opens it, and otherwise shows how many it has.

export const wireframe = (page: string) => `/lab/wireframes/${page}/`

/** A docs page title, as its slug under the site map's rule: lowercase, with hyphens. */
export const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// Pages that have a wireframe link to it. Every other link goes to the page's stub on the dev server.
const wireframed: Record<string, string> = {
  'What is acorn': wireframe('docs-home'),
  Database: wireframe('built-in-plugin'),
  'Build your first plugin': wireframe('tutorial'),
  'Add a pane': wireframe('docs-guide'),
  'Manifest reference': wireframe('docs-reference'),
  Button: wireframe('component'),
}

export type Group = { label: string; base: string; items?: (string | Group)[]; count?: number }

export const href = (base: string, title: string) => wireframed[title] ?? `/docs/${base}/${slug(title)}/`

export const useSidebar: Group[] = [
  {
    label: 'Start here',
    base: 'start',
    items: [
      'What is acorn',
      'Install',
      'Quick start: first project, first task, first agent',
      'Concepts',
      'Desktop and terminal',
    ],
  },
  { label: 'Using acorn', base: 'using', count: 15 },
  {
    label: 'Agents',
    base: 'agents',
    items: [
      'Agent sessions',
      'Harnesses and defaults',
      'Permissions and approvals',
      'Custom agents',
      'Skills',
      'Delegation and subagents',
      'Steering, queues, and follow-ups',
      'Files, attachments, and context',
      'Search agent history',
      'Usage and cost',
      'Agents in the terminal drawer',
      'Agent tools and the MCP server',
      'Model providers and generating text',
    ],
  },
  { label: 'Security', base: 'security', count: 9 },
  { label: 'Settings', base: 'settings', count: 10 },
  {
    label: 'Built-in plugins',
    base: 'built-in-plugins',
    items: [
      'Agents',
      'Agent browser',
      'Agent cost',
      'Context',
      'Database',
      'Docker',
      'Editor',
      'Git',
      'GitHub',
      'HTTP',
      'Linear',
      'Memory',
      'Model providers',
      'Notes',
      'Preview',
      'Rollbar',
      'Sentry telemetry',
      'Terminal',
      'Workflows',
    ],
  },
  { label: 'Nodes and devices', base: 'nodes', count: 6 },
  { label: 'Browser extension', base: 'browser-extension', count: 8 },
  { label: 'Automation', base: 'automation', count: 8 },
  { label: 'Reference', base: 'reference', count: 6 },
  { label: 'Help', base: 'help', count: 3 },
]

// The Build plugins sidebar holds the plugin docs and the kit, because both are read by the person
// writing a plugin.
export const buildSidebar: Group[] = [
  {
    label: 'Start',
    base: 'build-plugins/start',
    items: ['How plugins work', 'Build your first plugin', 'Have your agent build it', 'Choose how your plugin draws'],
  },
  {
    label: 'Draw in acorn',
    base: 'build-plugins/ui',
    items: [
      'Add a pane',
      'Add a source to the left rail',
      'Put your pane in the right rail',
      'Add a reference panel',
      'Add a settings page',
      'Add commands and keybindings',
      'Add rows to context menus',
      'Put a badge in the top bar or task footer',
      'Mark tasks, sources, and panes',
      "Add to another plugin's view",
      'Open your view to other plugins',
      'Add a toolbar control',
      'Preview links and draw code fences',
      'View files and agent attachments',
      'Replace the top bar, rail, or pane switcher',
      'Draw your own pixels in a frame',
      'Show a web page',
      'Add a theme or a style pack',
      'Add icons and brand marks',
      'Notify the person',
    ],
  },
  { label: 'Node, agents, data, and the browser', base: 'build-plugins/node', count: 22 },
  {
    label: 'Reference',
    base: 'build-plugins/reference',
    items: [
      'Manifest reference',
      'Contributions',
      'Permissions',
      'The Node context',
      'The client bridge',
      'Trees and events',
      'Extension points',
      'Action verbs',
      'Limits',
      'Compatibility and versions',
      "What plugins can't do",
      'Examples',
    ],
  },
  {
    label: 'Components',
    base: 'components',
    items: [
      'One kit, two hosts',
      'Roles and tokens',
      'Layouts',
      { label: 'Grouping', base: 'components' },
      { label: 'Content', base: 'components' },
      {
        label: 'Inputs',
        base: 'components',
        items: ['Button', 'ConfirmButton', 'IconButton', 'ToggleButton', 'CopyButton', 'Input', 'Select', 'Field'],
      },
      { label: 'Collections', base: 'components' },
      { label: 'Overlays', base: 'components' },
      { label: 'Rectangles', base: 'components' },
      'Icons',
      'Themes and style packs',
      'Keyboard and accessibility',
      'What the kit refuses',
    ],
  },
]

/** The header's links. `id` marks the current one. */
export const headerLinks = [
  { id: 'docs', label: 'Docs', href: wireframe('docs-home') },
  { id: 'build', label: 'Build plugins', href: wireframe('tutorial') },
  { id: 'download', label: 'Download', href: wireframe('download/no-release') },
  { id: 'changelog', label: 'Changelog', href: wireframe('changelog') },
]

export const footerColumns = [
  {
    label: 'acorn',
    links: [
      ['Features', wireframe('features')],
      ['Download', wireframe('download/no-release')],
      ['Changelog', wireframe('changelog')],
      ['Plugins', wireframe('plugins')],
    ],
  },
  {
    label: 'Use acorn',
    links: [
      ['What is acorn', wireframe('docs-home')],
      ['Install', href('start', 'Install')],
      ['Agent sessions', href('agents', 'Agent sessions')],
      ['Security', '/docs/security/the-trust-model/'],
    ],
  },
  {
    label: 'Build plugins',
    links: [
      ['Build your first plugin', wireframe('tutorial')],
      ['Add a pane', wireframe('docs-guide')],
      ['Manifest reference', wireframe('docs-reference')],
      ['Components', '/docs/components/one-kit-two-hosts/'],
    ],
  },
  {
    label: 'Project',
    links: [
      ['GitHub', 'https://github.com/jamesmacfie/acorn'],
      ['FAQ', '/docs/help/faq/'],
      ['Troubleshooting', '/docs/help/troubleshooting/'],
      ['MIT license', 'https://github.com/jamesmacfie/acorn/blob/main/LICENSE'],
    ],
  },
]
