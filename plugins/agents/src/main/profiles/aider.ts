import type { AgentProfileContribution } from '@acorn/plugin-api/node'

export const aiderProfile: AgentProfileContribution = {
  id: 'aider',
  label: 'Aider',
  kind: 'agent',
  command: 'aider',
  backendPreference: 'tmux',
  transport: 'pty',
}

