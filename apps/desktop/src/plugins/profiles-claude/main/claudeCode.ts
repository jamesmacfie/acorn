import { registerAcornMcp } from '@acorn/node-core/main/mcpRegister.ts'
import { lineDelimitedJsonAdapter } from '@acorn/node-core/main/agentProfiles/streamJson.ts'
import type { AgentProfileContribution } from '@acorn/node-core/main/agentProfiles/types.ts'

export const claudeCodeProfile: AgentProfileContribution = {
  id: 'claude-code',
  label: 'Claude Code',
  kind: 'agent',
  command: 'claude',
  backendPreference: 'tmux',
  transport: 'pty',
  mcpRegistration: (name, launcher) => registerAcornMcp('claude', name, launcher),
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

