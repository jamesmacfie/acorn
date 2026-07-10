import type { AgentProfileContribution } from './types'

export const aiderProfile: AgentProfileContribution = {
  id: 'aider',
  label: 'Aider',
  kind: 'agent',
  command: 'aider',
  backendPreference: 'tmux',
  transport: 'pty',
}

