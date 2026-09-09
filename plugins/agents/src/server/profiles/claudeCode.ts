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
  // One structured turn with both built-in and projected tools disabled. Two callers now: a workflow
  // `decide` step, and any Generate control in the app spending this CLI as a text backend
  // (docs/integrations.md § Model providers).
  //
  // It keeps `dontAsk` where the headless turn moved to `auto`: with `--tools ''` there is nothing to
  // approve, and a deny is the right answer for anything that gets past that. Neither caller acts, so
  // this is the one path where the denying mode is the point.
  //
  // `--strict-mcp-config` is unconditional, and reaches `decide` as well as a generate, which is
  // intended: an MCP server the owner registered in `~/.claude.json` should not be started for a turn
  // that cannot call it. `--tools ''` empties the tool list but still lets those servers boot.
  //
  // `--system-prompt` REPLACES the CLI's default system prompt rather than appending to it, which is
  // what a generate wants: the coding-agent persona is noise in front of "answer with SQL only". That
  // is why this is not `--append-system-prompt`, which the launch path above uses for the opposite
  // reason.
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
      '--strict-mcp-config',
      ...(opts.system ? ['--system-prompt', opts.system] : []),
      ...(opts.model ? ['--model', opts.model] : []),
      ...(opts.schema ? ['--json-schema', JSON.stringify(opts.schema)] : []),
      opts.prompt,
    ],
  }),
  streamJson: lineDelimitedJsonAdapter,
  // The CLI's own aliases, not dated model ids: `claude` resolves an alias to whatever it ships with,
  // and a pinned id goes stale in the CLI before it goes stale here.
  models: [
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'opus', label: 'Opus' },
    { id: 'haiku', label: 'Haiku' },
  ],
  defaultModelId: 'sonnet',
  glyph: 'brand:agents/claude',
}

