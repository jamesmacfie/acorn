// The shell snapshots: whole acorn windows captured from a running app on the site's fixture
// (docs/site/snapshots.md). `scripts/capture-shell.mjs` writes each one to
// src/generated/snapshots/, as `<id>.html` for the desktop and `<id>.cells.json` for the terminal.
// This list says how the site frames each one.

type Scene = { caption: string } & (
  | { host: 'desktop' | 'browser'; width: number; height: number }
  | { host: 'terminal' }
)

const window = { host: 'desktop', width: 1440, height: 900 } as const

export const SNAPSHOTS = {
  hero: {
    ...window,
    caption: 'A task with an agent session, its changes, and a terminal.',
  },
  'hero-terminal': {
    host: 'terminal',
    caption: 'The same task in the terminal client.',
  },
  palette: {
    ...window,
    caption: 'The command palette, open over a task.',
  },
  permissions: {
    ...window,
    caption: "A plugin's permissions in Settings.",
  },
  database: {
    ...window,
    caption: 'The Database pane: the schema, a query, and its result.',
  },
  review: {
    ...window,
    caption: 'A pull request under review, with an inline thread and its checks.',
  },
  workflow: {
    ...window,
    caption: 'A workflow run on its graph, waiting at a gate for a person.',
  },
  notes: {
    ...window,
    caption: "The Notes pane: the task's plan, beside the notes for the whole workspace.",
  },
  editor: {
    ...window,
    caption: "The Editor pane: the task's files with their Git status, and a changed file open.",
  },
  context: {
    ...window,
    caption: 'The Context pane: the sections an agent gets about its task, and their sizes.',
  },
  fleet: {
    ...window,
    caption: 'Fleet home, with this computer and a second Node.',
  },
  browser: {
    host: 'browser',
    width: 1200,
    height: 900,
    caption: "The browser extension's panel beside the pull request, showing the page's task.",
  },
  'terminal-small': {
    host: 'terminal',
    caption: 'The terminal client at 80 by 24.',
  },
} satisfies Record<string, Scene>

export type SnapshotId = keyof typeof SNAPSHOTS
