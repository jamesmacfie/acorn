import { Hono } from 'hono'
import { z } from 'zod'
import { respondError, type AppEnv, type Principal } from '@acorn/plugin-api/node'
import { FINDING_LIMITS, findingRecordInputSchema } from '../../contract/records'
import { FindingCaptureError } from '../capture'
import type { FindingsRuntime } from '../runtime'
import { requestContext } from './carrier'

const LIST_RESPONSE_MAX_BYTES = 256 * 1024
const CONTEXT_RESPONSE_MAX_BYTES = 16 * 1024
const CONTEXT_COMPACT_MAX_BYTES = 4 * 1024

const utf8Bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8')
const truncateUtf8Prefix = (value: string, maxBytes: number): string => {
  const encoded = Buffer.from(value, 'utf8')
  if (encoded.byteLength <= maxBytes) return value
  let end = maxBytes
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end -= 1
  return encoded.subarray(0, end).toString('utf8')
}

const transportOrigin = z.unknown().optional()

const listInput = z.strictObject({
  cursor: z.string().max(400).optional(),
  limit: z.number().int().min(1).max(FINDING_LIMITS.pageSize).optional(),
  state: z.enum(['active', 'history']).default('active'),
})
const getInput = z.strictObject({ id: z.string().min(1).max(200) })
const withdrawInput = z.strictObject({
  id: z.string().min(1).max(200),
  reason: z.string().max(FINDING_LIMITS.reasonChars).optional(),
})
const recordEnvelope = z.strictObject({ arguments: findingRecordInputSchema, origin: transportOrigin })
const listEnvelope = z.strictObject({ arguments: listInput, origin: transportOrigin })
const getEnvelope = z.strictObject({ arguments: getInput, origin: transportOrigin })
const withdrawEnvelope = z.strictObject({ arguments: withdrawInput, origin: transportOrigin })

const routeError = (c: Parameters<typeof respondError>[0], error: unknown): Response => {
  if (!(error instanceof FindingCaptureError)) {
    return respondError(c, 500, 'internal', [error instanceof Error ? error.message : 'findings operation failed'])
  }
  const status = error.kind === 'not-found' ? 404
    : error.kind === 'conflict' ? 409
      : error.kind === 'forbidden' ? 403
        : error.kind === 'unavailable' ? 503 : 400
  const code = error.kind === 'not-found' ? 'not_found'
    : error.kind === 'invalid-input' ? 'bad_request' : error.kind
  return respondError(c, status, code, [error.message])
}

type TaskPrincipal = Principal & { kind: 'internal'; scope: 'task'; taskId: string }
const taskPrincipal = (c: Parameters<typeof requestContext>[0]): TaskPrincipal | null => {
  const principal = requestContext(c).principal
  return principal.kind === 'internal' && principal.scope === 'task' && principal.taskId ? principal as TaskPrincipal : null
}

const parse = async <T extends z.ZodTypeAny>(c: Parameters<typeof requestContext>[0], schema: T): Promise<z.ZodSafeParseResult<z.output<T>>> =>
  schema.safeParse(await c.req.json().catch(() => null))

const compact = (items: readonly { title: string; body: string; claimStatus: string }[]): string => {
  const lines = items.map((item) => `- ${item.title} (${item.claimStatus}): ${truncateUtf8Prefix(item.body.replace(/\s+/g, ' '), 500)}`)
  let value = lines.join('\n')
  while (Buffer.byteLength(value, 'utf8') > CONTEXT_COMPACT_MAX_BYTES && lines.length > 1) {
    lines.pop()
    value = lines.join('\n')
  }
  return truncateUtf8Prefix(value, CONTEXT_COMPACT_MAX_BYTES)
}

const boundedList = async (
  runtime: FindingsRuntime,
  taskId: string,
  options: z.output<typeof listInput>,
) => {
  let limit = options.limit ?? 50
  while (true) {
    const page = await runtime.listTask(taskId, { ...options, limit })
    if (utf8Bytes(page) <= LIST_RESPONSE_MAX_BYTES) return page
    if (limit === 1) throw new FindingCaptureError('unavailable', 'one finding exceeds the tool response limit')
    limit = Math.max(1, Math.floor(limit / 2))
  }
}

/** Host-dispatched routes for manifest agent tools and the bounded context section. */
export const findingsRuntimeRoutes = (runtime: FindingsRuntime) => new Hono<AppEnv>()
  .use('*', async (c, next) => {
    if (!taskPrincipal(c)) return respondError(c, 403, 'forbidden')
    await next()
  })
  .post('/runtime/tools/record', async (c) => {
    const principal = taskPrincipal(c)!
    if (!principal.sessionId) return respondError(c, 403, 'forbidden', ['a managed session is required'])
    const parsed = await parse(c, recordEnvelope)
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((issue) => issue.message))
    try {
      return c.json(await runtime.record({
        scope: { kind: 'task', taskId: principal.taskId },
        origin: { kind: 'agent', sessionId: principal.sessionId },
        producerId: 'findings:agent-tool',
        input: parsed.data.arguments,
      }))
    } catch (error) { return routeError(c, error) }
  })
  .post('/runtime/tools/list', async (c) => {
    const principal = taskPrincipal(c)!
    const parsed = await parse(c, listEnvelope)
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((issue) => issue.message))
    try { return c.json(await boundedList(runtime, principal.taskId, parsed.data.arguments)) }
    catch (error) { return routeError(c, error) }
  })
  .post('/runtime/tools/get', async (c) => {
    const principal = taskPrincipal(c)!
    const parsed = await parse(c, getEnvelope)
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const found = runtime.getTask(principal.taskId, parsed.data.arguments.id)
    return found ? c.json(found) : respondError(c, 404, 'not_found')
  })
  .post('/runtime/tools/withdraw', async (c) => {
    const principal = taskPrincipal(c)!
    if (!principal.sessionId) return respondError(c, 403, 'forbidden', ['a managed session is required'])
    const parsed = await parse(c, withdrawEnvelope)
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    try {
      return c.json(runtime.withdrawTask({
        taskId: principal.taskId,
        observationId: parsed.data.arguments.id,
        actor: { kind: 'agent', id: principal.sessionId },
        ...(parsed.data.arguments.reason === undefined ? {} : { reason: parsed.data.arguments.reason }),
      }))
    } catch (error) { return routeError(c, error) }
  })
  .post('/runtime/context', async (c) => {
    const principal = taskPrincipal(c)!
    try {
      const page = await runtime.listTask(principal.taskId, { state: 'active', limit: 13 })
      const visible = page.items.slice(0, 12)
      const compactText = compact(visible)
      const items: Array<{
        id: string
        kind: string
        label: string
        body?: string
        details: string[]
        sources?: Array<{ label: string; uri?: string }>
      }> = []
      let omitted = page.items.length - visible.length + (page.nextCursor ? 1 : 0)
      for (const finding of visible) {
        const candidate = {
          id: finding.id,
          kind: 'finding',
          label: finding.title,
          body: truncateUtf8Prefix(finding.body, 2_000),
          details: [`Claim: ${finding.claimStatus}`, `Origin: ${finding.origin.kind}`],
          sources: finding.evidence.slice(0, 20).map((evidence) => ({
            label: evidence.label ?? evidence.kind,
            ...('url' in evidence ? { uri: evidence.url } : {}),
          })),
        }
        while (candidate.sources.length && utf8Bytes({ items: [...items, candidate], compact: compactText, omitted }) > CONTEXT_RESPONSE_MAX_BYTES) {
          candidate.sources.pop()
        }
        if (utf8Bytes({ items: [...items, candidate], compact: compactText, omitted }) > CONTEXT_RESPONSE_MAX_BYTES) {
          candidate.body = truncateUtf8Prefix(candidate.body, 256)
        }
        if (utf8Bytes({ items: [...items, candidate], compact: compactText, omitted }) > CONTEXT_RESPONSE_MAX_BYTES) {
          omitted += 1
          continue
        }
        items.push(candidate)
      }
      while (items.length && utf8Bytes({ items, compact: compactText, omitted }) > CONTEXT_RESPONSE_MAX_BYTES) {
        items.pop()
        omitted += 1
      }
      return c.json({ items, compact: compactText, omitted })
    } catch (error) { return routeError(c, error) }
  })
