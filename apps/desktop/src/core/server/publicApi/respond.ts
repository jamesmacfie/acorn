import type { Context } from 'hono'
import { z } from 'zod'
import { ERROR_STATUS, type ErrorResponse, PublicApiError, type ValidationIssue } from '../../shared/publicApi/errors'
import type { PublicAppEnv } from './context'

// Success + error envelope construction (docs/public-api.md). The single place that turns
// a domain result or a PublicApiError into a wire response, so the shape is uniform everywhere.

export const DataResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.strictObject({ data, requestId: z.string() })

// Single-resource / paged success. `status` defaults to 200; callers pass 201/202 and a Location
// header for creation.
export function dataResponse(
  c: Context<PublicAppEnv>,
  data: unknown,
  opts?: { status?: 200 | 201 | 202; headers?: Record<string, string> },
): Response {
  const requestId = c.get('requestId')
  for (const [k, v] of Object.entries(opts?.headers ?? {})) c.header(k, v)
  return c.json({ data, requestId }, opts?.status ?? 200)
}

export function noContentResponse(c: Context<PublicAppEnv>): Response {
  return c.body(null, 204)
}

// Map a PublicApiError to the error envelope + status, attaching any error-specific headers
// (WWW-Authenticate for auth failures, Retry-After for rate limits).
export function errorResponse(c: Context<PublicAppEnv>, err: PublicApiError): Response {
  const requestId = c.get('requestId') ?? 'unknown'
  const body: ErrorResponse = {
    error: {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.details !== undefined ? { details: err.details } : {}),
      ...(err.issues ? { issues: err.issues } : {}),
    },
  }
  for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v)
  return c.json(body, err.status)
}

// Turn a Zod error into the ValidationIssue[] the envelope carries.
export function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({
    path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
    code: i.code,
    message: i.message,
  }))
}

// Last-resort backstop: any non-PublicApiError becomes a 500 internal_error with no leaked detail
// (protocol.md §5 forbids stacks/SQL/paths in generic 500s).
export function toPublicApiError(err: unknown): PublicApiError {
  if (err instanceof PublicApiError) return err
  if (err instanceof z.ZodError) {
    return new PublicApiError('validation_failed', 'Request failed validation', { issues: zodIssues(err) })
  }
  return new PublicApiError('internal_error', 'An unexpected error occurred')
}

export { ERROR_STATUS }
