import type { AgentProfileContribution } from '@acorn/node-core/main/agentProfiles/types.ts'

export const aiderProfile: AgentProfileContribution = {
  id: 'aider',
  label: 'Aider',
  kind: 'agent',
  command: 'aider',
  backendPreference: 'tmux',
  transport: 'pty',
}

