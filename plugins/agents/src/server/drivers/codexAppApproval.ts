import type { AgentAppApproval, AgentApprovalScope, AgentPermissionOption } from '../../contract/wire.ts'
import type { FormElicitationResponse } from './formElicitation'

type JsonObject = Record<string, unknown>

const asObject = (value: unknown): JsonObject | null =>
  typeof value === 'object' && value != null && !Array.isArray(value) ? value as JsonObject : null

// Computer Use's app-access request, as the installed integration sends it through Codex's
// `mcpServer/elicitation/request`. The shape is that integration's, read from its own source and
// checked against a captured request (docs/managed-agents.md § App-access approval), so every field
// is optional here and anything unexpected falls back to the plain consent form.
//
//   _meta: {
//     codex_approval_kind: 'mcp_tool_call', connector_id: 'computer-use', connector_name,
//     persist: ['session', 'always'] | ['session'], subtitle?, riskLevel,
//     tool_params: { app: <bundle identifier> },
//     tool_params_display: [{ name: 'app', value: <display name> }],
//   }
//
// The answer goes back as `_meta.persist`. The integration keeps the grant itself: per Codex thread
// for `session`, and in its own approvals file for `always`. Acorn stores the decision, never the grant.
const COMPUTER_USE = 'computer-use'
const SCOPES: readonly AgentApprovalScope[] = ['session', 'always']

// An identity that does not fit is refused rather than cut, because a shortened bundle identifier
// names a different app.
const MAX_ID = 500
const MAX_NAME = 200
const MAX_WARNING = 2_000

const boundedString = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max ? value.trim() : null

const hasFormFields = (schema: unknown): boolean =>
  Object.keys(asObject(asObject(schema)?.properties) ?? {}).length > 0

/** The approval a Codex elicitation asks for, or null when it is not one Acorn recognises. */
export function codexAppApproval(params: JsonObject): AgentAppApproval | null {
  const meta = asObject(params._meta)
  if (!meta || meta.codex_approval_kind !== 'mcp_tool_call' || meta.connector_id !== COMPUTER_USE) return null
  // A form with fields is asking for input, not consent, whatever its metadata says.
  if (hasFormFields(params.requestedSchema)) return null
  const id = boundedString(asObject(meta.tool_params)?.app, MAX_ID)
  const persist: unknown[] | null = Array.isArray(meta.persist) ? meta.persist : null
  if (!id || !persist) return null
  // Unknown scopes are dropped, not guessed at. Session approval is what a plain Allow always meant,
  // so a request that does not offer it is one Acorn does not understand.
  const scopes = SCOPES.filter((scope) => persist.includes(scope))
  if (!scopes.includes('session')) return null
  const display = Array.isArray(meta.tool_params_display)
    ? meta.tool_params_display.map(asObject).find((row) => row?.name === 'app')
    : undefined
  const warning = boundedString(meta.subtitle, MAX_WARNING)
  return {
    connector: boundedString(meta.connector_name, MAX_NAME) ?? 'Computer Use',
    app: { id, name: boundedString(display?.value, MAX_NAME) ?? id },
    scopes,
    ...(warning ? { warning } : {}),
  }
}

// The ids are Acorn's. `accept` keeps the id a plain Allow always had, so an answer recorded before
// this existed still reads as the session grant it was.
const OPTION_SCOPE: Record<string, AgentApprovalScope> = { accept: 'session', acceptAlways: 'always' }

export function appApprovalOptions(approval: AgentAppApproval): AgentPermissionOption[] {
  return [
    { id: 'accept', label: 'Allow for this session', kind: 'allow_once' },
    ...(approval.scopes.includes('always')
      ? [{ id: 'acceptAlways', label: 'Always allow', kind: 'allow_always' as const }]
      : []),
    { id: 'decline', label: 'Decline', kind: 'reject_once' },
  ]
}

export type AppApprovalResponse = FormElicitationResponse & { _meta?: { persist: AgentApprovalScope } }

/**
 * The provider response for a person's choice, checked against the request the provider sent rather
 * than against anything the client supplied. A scope the provider did not offer is refused outright:
 * answering with a narrower one would record a grant the person did not pick.
 */
export function appApprovalResponse(approval: AgentAppApproval, resolution: unknown): AppApprovalResponse {
  const optionId = asObject(resolution)?.optionId
  if (optionId === 'decline') return { action: 'decline' }
  if (typeof optionId !== 'string') return { action: 'cancel' }
  const scope = OPTION_SCOPE[optionId]
  if (!scope || !approval.scopes.includes(scope)) {
    throw new Error(`${approval.connector} did not offer that approval for ${approval.app.name}.`)
  }
  return { action: 'accept', content: {}, _meta: { persist: scope } }
}
