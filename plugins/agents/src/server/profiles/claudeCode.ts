import { type AgentProfileContribution, lineDelimitedJsonAdapter, registerAcornMcp } from '@acorn/plugin-api/node'
import { claudeMcpCommands } from './mcpCommands'

export const claudeCodeProfile: AgentProfileContribution = {
  id: 'claude-code',
  label: 'Claude Code',
  kind: 'agent',
  command: 'claude',
  backendPreference: 'tmux',
  transport: 'pty',
  mcpRegistration: (name, launcher) => registerAcornMcp(claudeMcpCommands, name, launcher),
  // Pull, not push (docs/notes-and-memory.md): a system-prompt instruction to fetch the task's own
  // context through the projected MCP tools. A pushed block queues 'after-ready', so it lands after the
  // user's first ask whenever the CLI is busy. A system prompt cannot race.
  // Tools are named bare, because the acorn server's name is build-flavoured (acorn or acorn-dev).
  launchArgs: [
    '--append-system-prompt',
    'This session runs inside acorn, which projects the current task as MCP tools. Before starting work, call task_context to read the task: its pull request, linked issues, workspace notes and the repo memory index. Follow up with notes_read for any note it lists, and memory_search / memory_get for relevant repo memory — conventions and past feedback live there. Re-read them when the task shifts; the user edits notes while you work. Never ask the user for context you can pull yourself.',
  ],
  // `auto` rather than `dontAsk`, which is what this was until an agent tool got called and denied.
  // `dontAsk` does not mean "do not prompt", it means "deny anything not already in a `permissions.allow`
  // rule", and acorn writes no such rules. So every tool acorn projects — task_context, notes_read,
  // memory_search, issue_detail — was denied in a workflow step, on a server the step could see and
  // list. `auto` approves with a classifier instead of a prompt, which is the only shape that works
  // when nobody is at the keyboard. The tools an agent may reach are still acorn's decision, taken at
  // the node: the tier and per-tool preferences the owner set, narrowed by the step's own ceiling
  // (docs/agent-tools.md § Projections).
  headlessArgv: (command, opts) => ({
    file: command,
    args: [
      ...(opts.resumeSessionId ? ['--resume', opts.resumeSessionId] : []),
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'auto',
      ...(opts.model ? ['--model', opts.model] : []),
      ...(opts.schema ? ['--json-schema', JSON.stringify(opts.schema)] : []),
      opts.prompt,
    ],
  }),
  resumeArgv: (command, sessionRef) => ({ file: command, args: ['--resume', sessionRef] }),
  // A decision is one structured turn with both built-in and projected tools disabled. It keeps
  // `dontAsk` where the headless turn moved to `auto`: with `--tools ''` there is nothing to approve,
  // and a deny is the right answer for anything that gets past that. A decide step reads and does not
  // act, so it is the one place the denying mode is the point.
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

