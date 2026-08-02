import type { AgentProfileContribution } from './types'

export const shellProfile: AgentProfileContribution = {
  id: 'shell',
  label: 'Shell',
  kind: 'shell',
  command: '$SHELL',
  backendPreference: 'node-pty',
  transport: 'pty',
}

