// The feature pages, in the order a newcomer needs them, which the landing page's tour follows too.
// The features index draws a card from each, and each page names its related features from here.

export type FeatureId = keyof typeof FEATURES

export const FEATURES = {
  tasks: {
    title: 'Tasks',
    sentence: 'A task is one piece of work on one project, with its own branch, worktree, terminals, and agent sessions.',
  },
  agents: {
    title: 'Agents',
    sentence: 'Run Claude Code and Codex inside your tasks, and answer them from the same window as the diff.',
  },
  review: {
    title: 'Review',
    sentence: 'Review the pull request, read the diff, and commit, push, and merge from inside the task.',
  },
  'desktop-and-terminal': {
    title: 'Desktop and terminal',
    sentence: 'The desktop app and the terminal client open the same workspace and draw the same panes from the same code.',
  },
  'task-tools': {
    title: 'Task tools',
    sentence: "Panes for the tools you'd otherwise open beside a task: an editor, a database client, an HTTP client, Docker, a preview, notes, and your Linear and Rollbar items.",
  },
  plugins: {
    title: 'Plugins',
    sentence: 'Most of acorn is plugins, and a plugin you install uses the same seams and draws in both clients.',
  },
  nodes: {
    title: 'Nodes',
    sentence: 'A Node holds your workspaces and runs your agents, on your computer or on a server you pair with.',
  },
  browser: {
    title: 'Browser extension',
    sentence: "The Chrome and Firefox extension puts a task's agent beside the page you're reading.",
  },
  automation: {
    title: 'Automation',
    sentence: 'Run work as a graph of steps, on a schedule, or from a script, and read your data on dashboards.',
  },
  security: {
    title: 'Security',
    sentence: "What acorn keeps from your agents and plugins, how it does that, and what it doesn't protect against.",
  },
} satisfies Record<string, { title: string; sentence: string }>
