// The landing page's draft copy, shared by its wireframe and its restyled version in the design lab.
// The headline and paragraph are final. Everything else is draft for the landing page to rewrite.

export const headline = 'A workspace for working with coding agents, one task at a time.'
export const paragraph =
  "Open a task and acorn gives it a branch, a Git worktree, terminals, and agent sessions, with the diff and the pull request in the panes beside them. Use it from the desktop app or from your terminal. It's the same workspace either way."

export const tour = [
  'Tasks',
  'Agents',
  'Review',
  'Desktop and terminal',
  'Task tools',
  'Plugins',
  'Nodes',
  'Browser, automation, and security',
]
// The manifest entry for a pane, as `npm create acorn-plugin` writes it.
export const paneEntry = `"frames": [{
  "target": "pane",
  "id": "hello",
  "label": "Hello",
  "layout": "single",
  "regions": {
    "body": { "kind": "remote", "entry": "pane" }
  }
}]`
export const guides = [
  ['build-plugins/ui', 'Add a pane'],
  ['build-plugins/ui', 'Add a source to the left rail'],
  ['build-plugins/ui', 'Add commands and keybindings'],
  ['build-plugins/node', 'Give agents tools'],
  ['build-plugins/node', 'Add a harness'],
  ['build-plugins/ui', 'Add a theme or a style pack'],
]
export const faq = [
  ['What does it cost?', 'Nothing. acorn is open source under the MIT license.'],
  [
    'Do I need an API key?',
    'Not for agents. acorn runs Claude Code and Codex with their own logins, and a harness never spends a key acorn holds. API keys are optional, for features like SQL generation.',
  ],
  [
    'Does my code leave my machine?',
    'acorn sends nothing anywhere. Your agents talk to their own providers. Telemetry is off by default, and nothing leaves the machine unless you turn it on and add a destination.',
  ],
  [
    'Which platforms?',
    'The desktop app runs on macOS and Windows. The terminal client and the standalone Node run wherever Node.js runs, Linux included.',
  ],
  [
    'How is it different from a terminal multiplexer or an IDE?',
    'A task owns its branch, worktree, agents, terminals, and review, and archiving it cleans all of that up.',
  ],
  [
    'Can a plugin break the app or read my keys?',
    'Installed plugins run in a sandbox, draw only with acorn’s components, and get only the permissions their manifest declares and you accept on each device.',
  ],
  [
    'Can I run it on another machine?',
    'Yes. Pair a remote Node and use it from the desktop app, the terminal client, or the command line.',
  ],
]

export { installMethods } from '../../install'
