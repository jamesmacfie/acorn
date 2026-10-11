/** A short-lived, device-only account of evidence on one Node. No raw provider data crosses this wire. */
export const agentSecurityDiagnosticsRoute = '/v1/p/agents/security-diagnostics'

export type SecurityEvidenceState = 'observed' | 'configured_only' | 'unknown' | 'unsupported' | 'failed'
export type SecuritySeverity = 'info' | 'attention' | 'warning'
export type SecurityFinding = {
  id: string
  owner: 'agents' | 'core' | 'project'
  nodeId: string
  projectId: string | null
  checkedAt: number
  state: SecurityEvidenceState
  severity: SecuritySeverity
  source: string
  summary: string
  /** Human-readable result; the full evidence remains in summary and limits. Optional for older Nodes.
   *  Mixed-version path until 2027-01-07. */
  description?: string
  title?: string
  facts?: Array<{ label: string; value: string }>
  limits: string
  repair: string
}
export type SecurityDiagnostics = {
  nodeId: string
  projectId: string | null
  checkedAt: number
  expiresAt: number
  findings: SecurityFinding[]
}
export type SecurityScope = { projectId?: string }
export type SecurityScopeChoices = {
  projects: Array<{ id: string; name: string }>
}
