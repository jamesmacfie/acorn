import { z } from 'zod'

// Error envelope + status vocabulary for /api/v1 (docs/next/api/protocol.md §5). Every non-2xx
// response is built from PublicApiError so the wire shape is exactly ErrorResponseSchema.

export const ValidationIssueSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number().int()])),
  code: z.string(),
  message: z.string(),
})
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>

export const ErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
    issues: z.array(ValidationIssueSchema).optional(),
  }),
})
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>

// The complete status → code vocabulary. The map is the single source of truth for which HTTP
// status a code carries, so respond.ts never guesses.
export const ERROR_STATUS = {
  malformed_json: 400,
  bad_request: 400,
  invalid_token: 401,
  insufficient_scope: 403,
  forbidden_host: 403,
  operation_forbidden: 403,
  not_found: 404,
  endpoint_not_found: 404,
  command_not_found: 404,
  plugin_not_found: 404,
  conflict: 409,
  ui_unavailable: 409,
  command_unavailable: 409,
  dirty_worktree: 409,
  port_in_use: 409,
  config_trust_required: 409,
  config_changed: 409,
  cannot_delete_default: 409,
  idempotency_conflict: 409,
  presentation_revision_conflict: 409,
  presentation_owner_required: 409,
  setting_overridden: 409,
  upstream_not_configured: 409,
  session_running: 409,
  file_changed: 409,
  replay_unavailable: 409,
  payload_too_large: 413,
  response_too_large: 413,
  unsupported_media_type: 415,
  validation_failed: 422,
  provider_validation_failed: 422,
  provider_mismatch: 422,
  upstream_reauthentication_required: 424,
  provider_unavailable: 424,
  upstream_rate_limited: 429,
  internal_error: 500,
  response_contract_violation: 500,
  capability_unavailable: 503,
  starting: 503,
  shutting_down: 503,
  ui_command_timeout: 504,
  upstream_timeout: 504,
  execution_expired: 410,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS
export type ErrorStatus = (typeof ERROR_STATUS)[ErrorCode]

// The one error type public handlers and middleware throw. respond.ts maps it to the envelope +
// status. `details`/`issues` are optional structured extras; message is human-safe prose (never a
// stack, SQL, provider body, or filesystem path — see protocol.md §5).
export class PublicApiError extends Error {
  readonly code: ErrorCode
  readonly status: ErrorStatus
  readonly details?: unknown
  readonly issues?: ValidationIssue[]
  readonly headers?: Record<string, string>

  constructor(
    code: ErrorCode,
    message: string,
    opts?: { details?: unknown; issues?: ValidationIssue[]; headers?: Record<string, string> },
  ) {
    super(message)
    this.name = 'PublicApiError'
    this.code = code
    this.status = ERROR_STATUS[code]
    this.details = opts?.details
    this.issues = opts?.issues
    this.headers = opts?.headers
  }
}

// Convenience constructors for the codes handlers reach for most.
export const notFound = (message = 'Resource not found') => new PublicApiError('not_found', message)
export const conflict = (code: ErrorCode, message: string, details?: unknown) =>
  new PublicApiError(code, message, { details })
export const badRequest = (message: string) => new PublicApiError('bad_request', message)
export const capabilityUnavailable = (message = 'Required capability is not available') =>
  new PublicApiError('capability_unavailable', message)
