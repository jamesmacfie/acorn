// Every plugin acorn ships, for the `/plugins/` page and the docs' Built-in plugins pages. A test
// (scripts/pluginPages.test.mjs) fails when a plugin in the app's compiled roster or in the bundled
// packages has no entry here or no docs page, and when an installed package's manifest asks for a
// permission that has no reason below.

export type PluginId = keyof typeof PLUGINS

type Plugin = {
  /** The plugin's name, as its docs page titles it. */
  name: string
  /** What it adds, in one sentence. */
  sentence: string
  /** A Lucide icon name, drawn on its card. */
  icon: string
  /** `compiled` is part of the app. `package` is an installed package. */
  ships: 'compiled' | 'package'
  /** True for the four plugins a Node can't turn off. */
  required?: true
  /** Which clients draw it. */
  worksIn: 'Desktop and terminal' | 'Desktop' | 'Any client'
  /** What the facts box adds after **Works in**, such as a part one client doesn't draw. */
  worksInNote?: string
  /** Its docs page. */
  docs: string
  /** For an installed package: why it asks for each permission in its manifest, keyed as
   *  `permissionKeys` in src/lib/pluginPermissions.ts spells them. */
  reasons?: Record<string, string>
}

export const SHIPS_AS = { compiled: 'Part of the app', package: 'Installed package' }

const both = 'Desktop and terminal'

export const PLUGINS = {
  agents: {
    name: 'Agents',
    sentence:
      'Runs Claude Code and Codex as managed agent sessions in your tasks, with Agent Center to watch them all.',
    icon: 'bot',
    ships: 'compiled',
    required: true,
    worksIn: both,
    docs: '/docs/built-in-plugins/agents/',
  },
  bitbucket: {
    name: 'Bitbucket',
    sentence:
      'Review bitbucket.org pull requests with their comments and build statuses, merge them, and start a task from one.',
    icon: 'git-pull-request',
    ships: 'compiled',
    worksIn: both,
    docs: '/docs/built-in-plugins/bitbucket/',
  },
  browser: {
    name: 'Agent browser',
    sentence: 'Gives agents a browser of their own, on the Node, to open, read, and test web pages.',
    icon: 'app-window',
    ships: 'compiled',
    worksIn: 'Any client',
    worksInNote: 'It has no pane. Agents use it on the Node.',
    docs: '/docs/built-in-plugins/agent-browser/',
  },
  'agent-cost': {
    name: 'Agent cost',
    sentence: 'Shows what an agent session would cost at API prices, beside its title.',
    icon: 'coins',
    ships: 'package',
    worksIn: both,
    docs: '/docs/built-in-plugins/agent-cost/',
    reasons: {},
  },
  context: {
    name: 'Context',
    sentence: 'The Context pane, where you choose what a task tells its agents and see how big it is.',
    icon: 'layout-grid',
    ships: 'compiled',
    worksIn: both,
    docs: '/docs/built-in-plugins/context/',
  },
  database: {
    name: 'Database',
    sentence: "Browse, edit, and query a task's PostgreSQL database, and generate SQL from a description.",
    icon: 'database',
    ships: 'package',
    worksIn: both,
    docs: '/docs/built-in-plugins/database/',
    reasons: {
      'api:core.tasks:read': "Shows the task's name in the pane's header.",
      'node.core:tasks': 'Checks the task a request names, and finds its project.',
      'node.core:projects:read': 'Keeps saved queries with the project they belong to.',
      'node.core:models': 'Generates SQL with your model provider or agent command line, when you ask it to.',
      'node.core:identity':
        'Lets the SQL generation workflow step spend a model connection as you, because a step has no person behind it.',
      'node.core:data:query':
        'Reads the schema and rows. acorn opens the connection, and the plugin never sees the URL.',
      'node.core:data:write': 'Saves a row you edit and runs the SQL you type.',
    },
  },
  docker: {
    name: 'Docker',
    sentence: "Lists a task's containers with their logs and stats, and starts, stops, and opens a shell in them.",
    icon: 'container',
    ships: 'compiled',
    worksIn: both,
    docs: '/docs/built-in-plugins/docker/',
  },
  editor: {
    name: 'Editor',
    sentence: "Read, edit, and search the files in a task's worktree.",
    icon: 'pencil',
    ships: 'compiled',
    worksIn: both,
    docs: '/docs/built-in-plugins/editor/',
  },
  git: {
    name: 'Git',
    sentence: 'Stage, commit, and push from the Changes tab, and read history, stashes, and worktrees.',
    icon: 'git-branch',
    ships: 'compiled',
    worksIn: both,
    docs: '/docs/built-in-plugins/git/',
  },
  github: {
    name: 'GitHub',
    sentence: 'Review pull requests with their threads and checks, merge them, and start a task from one.',
    icon: 'git-pull-request',
    ships: 'compiled',
    worksIn: both,
    docs: '/docs/built-in-plugins/github/',
  },
  gitlab: {
    name: 'GitLab',
    sentence:
      'Review gitlab.com merge requests with their discussions and pipelines, merge them, and start a task from one.',
    icon: 'git-pull-request',
    ships: 'compiled',
    worksIn: both,
    docs: '/docs/built-in-plugins/gitlab/',
  },
  http: {
    name: 'HTTP',
    sentence: 'Send HTTP requests from a pane, and keep them with the project.',
    icon: 'send',
    ships: 'package',
    worksIn: both,
    docs: '/docs/built-in-plugins/http/',
    reasons: {
      'api:core.projects:read': "Shows the project's name, and the project list on its settings page.",
      'node.core:tasks': 'Checks a task belongs to its project, and finds its worktree for the worktree variable.',
      'node.core:projects:read': 'Finds the project a request belongs to, and its checkout.',
      'node.core:identity':
        'Lets the HTTP workflow step use your saved variables, because a step has no person behind it.',
      'node.secrets': "Encrypts saved requests and variables with the Node's key.",
      'node.exec': 'Runs the shell command behind a command variable when you send.',
      'node.net:*': 'Sends each request to the URL you give it.',
    },
  },
  linear: {
    name: 'Linear',
    sentence: 'Lists your Linear issues in the rail, shows each with its comments, and starts a task from one.',
    icon: 'square-kanban',
    ships: 'package',
    worksIn: both,
    docs: '/docs/built-in-plugins/linear/',
    reasons: {
      'api:core.tasks:read': 'Finds the issues the open task links to.',
      'node.core:projects:read': "Finds the Linear projects linked to the project you're in.",
      'node.net:api.linear.app': "Reads issues and posts comments through Linear's API.",
      'node.net:uploads.linear.app': 'Fetches the images and files an issue links to.',
    },
  },
  memory: {
    name: 'Memory',
    sentence: 'Keeps what agents learn about a project, for you to review, edit, and undo.',
    icon: 'brain',
    ships: 'compiled',
    required: true,
    worksIn: both,
    docs: '/docs/built-in-plugins/memory/',
  },
  'model-providers': {
    name: 'Model providers',
    sentence: 'Connects OpenAI and Anthropic API keys, for the features that generate text.',
    icon: 'sparkles',
    ships: 'package',
    worksIn: both,
    docs: '/docs/built-in-plugins/model-providers/',
    reasons: {
      'node.net:api.openai.com': "Sends generate requests to OpenAI's API.",
      'node.net:api.anthropic.com': "Sends generate requests to Anthropic's API.",
      'node.env:OPENAI_BASE_URL':
        "Reads where to send OpenAI requests, if the Node's environment sets another address.",
      'node.env:ANTHROPIC_BASE_URL':
        "Reads where to send Anthropic requests, if the Node's environment sets another address.",
    },
  },
  notes: {
    name: 'Notes',
    sentence: 'Markdown notes on a task, a workspace, or everywhere, which you can hand to an agent.',
    icon: 'notepad-text',
    ships: 'compiled',
    required: true,
    worksIn: both,
    docs: '/docs/built-in-plugins/notes/',
  },
  onboarding: {
    name: 'Onboarding',
    sentence: 'The first-run wizard: your project, your layout, and the agent command lines acorn found.',
    icon: 'hand',
    ships: 'compiled',
    worksIn: both,
    docs: '/docs/start/install/#the-first-run-setup',
  },
  preview: {
    name: 'Preview',
    sentence: "Shows a task's running web app in a pane beside its code.",
    icon: 'globe',
    ships: 'compiled',
    worksIn: 'Desktop',
    worksInNote: "The terminal client can't show a web page.",
    docs: '/docs/built-in-plugins/preview/',
  },
  rollbar: {
    name: 'Rollbar',
    sentence: 'Lists your Rollbar errors in the rail, shows each with its stack trace, and starts a task from one.',
    icon: 'bug',
    ships: 'package',
    worksIn: both,
    docs: '/docs/built-in-plugins/rollbar/',
    reasons: {
      'api:core.tasks:read': 'Finds the errors the open task links to.',
      'node.core:projects:read': "Finds the Rollbar connections the project you're in follows.",
      'node.net:api.rollbar.com': "Reads errors and their occurrences through Rollbar's API.",
    },
  },
  'sentry-telemetry': {
    name: 'Sentry telemetry',
    sentence: "Sends the Node's own errors, logs, and timings to your Sentry project, when you turn it on.",
    icon: 'activity',
    ships: 'package',
    worksIn: 'Desktop',
    worksInNote: 'It sends from the Node whichever client you use. Its settings page opens only in the desktop app.',
    docs: '/docs/built-in-plugins/sentry-telemetry/',
    reasons: {
      'node.core:telemetry': "Reads the Node's telemetry records, which are what it sends.",
      'node.core:prefs': 'Reads the choices you make on its settings page.',
      'node.core:identity':
        'Finds your Sentry connection and settings when it sends, with no request to read you from.',
      'node.net:*.ingest.sentry.io': "Sends records to Sentry's ingest address that your DSN names.",
      'node.net:*.ingest.us.sentry.io': "Sends records to Sentry's US ingest address.",
      'node.net:*.ingest.de.sentry.io': "Sends records to Sentry's EU ingest address.",
      'node.net:sentry.io': 'Sends records to Sentry.',
    },
  },
  terminal: {
    name: 'Terminal',
    sentence: 'Terminals for every task, in a drawer or a pane, that keep running when you close the window.',
    icon: 'square-terminal',
    ships: 'compiled',
    required: true,
    worksIn: both,
    worksInNote: 'The terminal client has no drawer.',
    docs: '/docs/built-in-plugins/terminal/',
  },
  workflows: {
    name: 'Workflows',
    sentence: 'Runs a graph of steps, such as an agent, a command, and a gate for you, and shows each run.',
    icon: 'workflow',
    ships: 'compiled',
    worksIn: both,
    docs: '/docs/built-in-plugins/workflows/',
  },
} satisfies Record<string, Plugin>
