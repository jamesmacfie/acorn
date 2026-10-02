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
  // Terminal builds standing context before spawn; no first-turn recall tool call is needed.
  launchContextArgs: (context) => [
    '--append-system-prompt',
    [context, 'This session runs inside acorn. Use task_context for the task, pull request and linked issues, and notes_read for task notes. Re-read notes when the task shifts; the user edits them while you work. Never ask the user for context you can pull yourself.'].filter(Boolean).join('\n\n'),
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
    { id: 'fable', label: 'Fable' },
    { id: 'haiku', label: 'Haiku' },
  ],
  // Leave the CLI's own account or organization default in place until a model is chosen here.
  defaultModelId: '',
  glyph: 'brand:agents/claude',
}
