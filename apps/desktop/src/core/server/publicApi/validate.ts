import type { Context } from 'hono'
import { z } from 'zod'
import { PublicApiError } from '../../shared/publicApi/errors'
import type { PublicAppEnv } from './context'
import type { AnyEndpoint, EndpointInput } from './defineEndpoint'
import { zodIssues } from './respond'

const DEFAULT_BODY_LIMIT = 1_048_576 // 1 MiB (authentication.md §8)

function parse<T>(schema: z.ZodType<T> | undefined, value: unknown, where: string): T | undefined {
  if (!schema) return undefined
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new PublicApiError('validation_failed', `Invalid ${where}`, { issues: zodIssues(result.error) })
  }
  return result.data
}

// Collect query params into a plain object (first value per key). Public query schemas are strict
// objects of scalars, so unknown params fail 422 exactly like unknown body keys.
function queryObject(c: Context<PublicAppEnv>): Record<string, string> {
  const out: Record<string, string> = {}
  const url = new URL(c.req.url)
  for (const [k, v] of url.searchParams.entries()) if (!(k in out)) out[k] = v
  return out
}

// A headers schema is validated only over the keys it declares (so a strictObject can be used
// without every incoming header tripping it). Header names are matched case-insensitively.
function headerObject(c: Context<PublicAppEnv>, schema: z.ZodTypeAny): Record<string, string | undefined> {
  const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape
  const out: Record<string, string | undefined> = {}
  if (!shape) return out
  for (const key of Object.keys(shape)) out[key] = c.req.header(key)
  return out
}

async function parseBody(c: Context<PublicAppEnv>, endpoint: AnyEndpoint): Promise<unknown> {
  const limit = endpoint.bodyLimitBytes ?? DEFAULT_BODY_LIMIT
  const raw = await c.req.text()
  if (Buffer.byteLength(raw) > limit) {
    throw new PublicApiError('payload_too_large', `Request body exceeds ${limit} bytes`)
  }
  if (raw.length === 0) return undefined
  const contentType = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new PublicApiError('unsupported_media_type', 'Content-Type must be application/json')
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new PublicApiError('malformed_json', 'Request body is not valid JSON')
  }
}

// Validate every declared part of a request against the endpoint schemas. Throws a PublicApiError
// (422/400/413/415) on the first failure; returns the typed input on success.
export async function validateRequest(
  c: Context<PublicAppEnv>,
  endpoint: AnyEndpoint,
): Promise<EndpointInput<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>> {
  const params = parse(endpoint.params, c.req.param() as Record<string, string>, 'path parameters')
  const query = parse(endpoint.query, queryObject(c), 'query parameters')
  const headers = endpoint.headers ? parse(endpoint.headers, headerObject(c, endpoint.headers), 'headers') : undefined

  let body: unknown
  if (endpoint.method === 'GET' || endpoint.method === 'DELETE') {
    body = undefined
  } else {
    const rawBody = await parseBody(c, endpoint)
    body = parse(endpoint.body, rawBody, 'request body')
  }

  return { params, query, headers, body } as EndpointInput<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>
}

// Validate a success payload against the endpoint response schema. In production a mismatch is
// 500 response_contract_violation with no leaked payload; in dev/test it throws with detail so the
// bug is loud (protocol.md §2).
export function validateResponse(endpoint: AnyEndpoint, payload: unknown): unknown {
  const result = endpoint.response.safeParse(payload)
  if (result.success) return result.data
  if (process.env.NODE_ENV === 'production') {
    throw new PublicApiError('response_contract_violation', 'Response failed its contract')
  }
  throw new PublicApiError('response_contract_violation', `Response failed its contract for ${endpoint.operationId}`, {
    issues: zodIssues(result.error),
  })
}
