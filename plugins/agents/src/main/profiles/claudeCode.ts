import { type AgentProfileContribution, lineDelimitedJsonAdapter, registerAcornMcp } from '@acorn/plugin-api/node'

export const claudeCodeProfile: AgentProfileContribution = {
  id: 'claude-code',
  label: 'Claude Code',
  kind: 'agent',
  command: 'claude',
  backendPreference: 'tmux',
  transport: 'pty',
  mcpRegistration: (name, launcher) => registerAcornMcp('claude', name, launcher),
  // Pull, not push (docs/notes-and-memory.md): a system-prompt instruction to fetch the task's own
  // context via the projected MCP tools. The pushed block it replaces was queued 'after-ready', so
  // it landed after the user's first ask whenever the CLI was still busy; a system prompt can't race.
  // Tools are named bare. The acorn server's name is build-flavoured (acorn / acorn-dev).
  launchArgs: [
    '--append-system-prompt',
    'This session runs inside acorn, which projects the current task as MCP tools. Before starting work, call task_context to read the task: its pull request, linked issues, workspace notes and the repo memory index. Follow up with notes_read for any note it lists, and memory_search / memory_get for relevant repo memory — conventions and past feedback live there. Re-read them when the task shifts; the user edits notes while you work. Never ask the user for context you can pull yourself.',
  ],
  headlessArgv: (command, opts) => ({
    file: command,
    args: [
      ...(opts.resumeSessionId ? ['--resume', opts.resumeSessionId] : []),
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'dontAsk',
      ...(opts.model ? ['--model', opts.model] : []),
      ...(opts.schema ? ['--json-schema', JSON.stringify(opts.schema)] : []),
      opts.prompt,
    ],
  }),
  resumeArgv: (command, sessionRef) => ({ file: command, args: ['--resume', sessionRef] }),
  // A decision is one structured turn with both built-in and projected tools disabled.
  aiArgv: (command, opts) => ({
    file: command,
    args: [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'dontAsk',
      '--tools',
      '',
      ...(opts.model ? ['--model', opts.model] : []),
      ...(opts.schema ? ['--json-schema', JSON.stringify(opts.schema)] : []),
      opts.prompt,
    ],
  }),
  streamJson: lineDelimitedJsonAdapter,
}

