// The shell snapshots: whole acorn windows captured from a running app on the site's fixture
// (docs/site/snapshots.md). `scripts/capture-shell.mjs` writes each one to
// src/generated/snapshots/, as `<id>.html` for the desktop and `<id>.cells.json` for the terminal.
// This list says how the site frames each one.

type Scene = { title: string; caption: string } & (
  | { host: 'desktop' | 'browser'; width: number; height: number }
  | { host: 'terminal' }
)

const window = { host: 'desktop', width: 1440, height: 900 } as const

export const SNAPSHOTS = {
  hero: {
    ...window,
    title: 'acorn · Retry failed webhooks',
    caption: 'A task with an agent session, its changes, and a terminal.',
  },
  'hero-terminal': {
    host: 'terminal',
    title: 'acorn · Retry failed webhooks',
    caption: 'The same task in the terminal client.',
  },
  palette: {
    ...window,
    title: 'acorn · Command palette',
    caption: 'The command palette, open over a task.',
  },
  permissions: {
    ...window,
    title: 'acorn · Settings',
    caption: "A plugin's permissions in Settings.",
  },
  database: {
    ...window,
    title: 'acorn · Speed up the overdue invoices query',
    caption: 'The Database pane: the schema, a query, and its result.',
  },
  review: {
    ...window,
    title: 'acorn · Add VAT to EU invoices',
    caption: 'A pull request under review, with an inline thread and its checks.',
  },
  workflow: {
    ...window,
    title: 'acorn · Add VAT to EU invoices',
    caption: 'A workflow run on its graph, waiting at a gate for a person.',
  },
  fleet: {
    ...window,
    title: 'acorn · Fleet',
    caption: 'Fleet home, with this computer and a second Node.',
  },
  browser: {
    host: 'browser',
    width: 1200,
    height: 900,
    title: 'Chrome · Add VAT to EU invoices',
    caption: "The browser extension's panel beside the pull request, showing the page's task.",
  },
  'terminal-small': {
    host: 'terminal',
    title: 'acorn',
    caption: 'The terminal client at 80 by 24.',
  },
} satisfies Record<string, Scene>

export type SnapshotId = keyof typeof SNAPSHOTS
