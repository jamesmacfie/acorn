import type { AgentAppApproval, AgentApprovalScope, AgentRequest } from '../../contract/wire.ts'

// The words around an app-access approval (docs/managed-agents.md § App-access approval), shared by
// the card that takes the answer (./AgentRequestCard.tsx) and the record it leaves in the thread
// (./AgentEventCard.tsx), so the two never describe the same grant differently.

const SCOPES: readonly AgentApprovalScope[] = ['session', 'always']

/** The approval a stored request carries, or null for a request without one, or a malformed one. */
export function appApprovalOf(value: unknown): AgentAppApproval | null {
  if (typeof value !== 'object' || value == null) return null
  const row = value as Record<string, unknown>
  const app = typeof row.app === 'object' && row.app != null ? row.app as Record<string, unknown> : null
  if (typeof row.connector !== 'string' || typeof app?.id !== 'string' || typeof app.name !== 'string') return null
  const scopes = Array.isArray(row.scopes) ? SCOPES.filter((scope) => (row.scopes as unknown[]).includes(scope)) : []
  if (!scopes.length) return null
  return {
    connector: row.connector,
    app: { id: app.id, name: app.name },
    scopes,
    ...(typeof row.warning === 'string' && row.warning ? { warning: row.warning } : {}),
  }
}

/** The app, by the name a person knows and the identifier the grant is actually keyed on. */
export const approvalTarget = (approval: AgentAppApproval): string =>
  approval.app.name === approval.app.id ? approval.app.id : `${approval.app.name} (${approval.app.id})`

/** What each choice means. Always allow trusts the identifier, not just the window this agent opened. */
export function approvalScopeNote(approval: AgentAppApproval): string {
  const session = 'Allow for this session lasts for this agent session only.'
  if (!approval.scopes.includes('always')) return session
  return `${session} Always allow lets ${approval.connector} use any app with this identifier in future sessions, `
    + `including rebuilds, until you revoke it in ${approval.connector}'s settings.`
}

/** The button a settled request was answered with, if it was answered with one. */
export function sentOptionId(request: AgentRequest | undefined): string | null {
  const resolution = request?.resolution
  if (typeof resolution !== 'object' || resolution == null) return null
  const optionId = (resolution as { optionId?: unknown }).optionId
  return typeof optionId === 'string' ? optionId : null
}

/** What happened after a choice was sent. The provider saves any grant, and Acorn cannot see it do so. */
export function approvalSentNote(approval: AgentAppApproval, optionId: string | null): string | null {
  if (optionId !== 'acceptAlways') return null
  return `Sent to ${approval.connector}, which saves the grant itself. Revoke it in ${approval.connector}'s settings.`
}
