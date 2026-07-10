import type { AgentProfileContribution } from '../../../core/main/agentProfiles/types'

export const aiderProfile: AgentProfileContribution = {
  id: 'aider',
  label: 'Aider',
  kind: 'agent',
  command: 'aider',
  backendPreference: 'tmux',
  transport: 'pty',
}

