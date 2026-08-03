import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request as requestHttp } from 'node:http'
import { request as requestHttps } from 'node:https'
import { isIP } from 'node:net'
import { and, asc, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { SecretUnavailableError, type SecretService } from '@acorn/node-core/main/core/secrets.ts'
import type { AgentWsFrame } from '@acorn/protocol/managedAgents.ts'

export type AgentWebhookEventType = 'completion' | 'attention'

export type AgentWebhook = {
  id: string
  taskId: string | null
  url: string
  events: AgentWebhookEventType[]
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export type AgentWebhookDelivery = {
  id: string
  webhookId: string
  eventId: string
  eventType: AgentWebhookEventType
  status: 'pending' | 'retrying' | 'delivered' | 'failed'
  attempt: number
  nextAttemptAt: number
  responseStatus: number | null
  error: string | null
  createdAt: number
  deliveredAt: number | null
}

type WebhookPayload = {
  version: 1
  event: AgentWebhookEventType
  eventId: string
  sessionId: string
  taskId: string
  sequence: number
  attention?: string
  occurredAt: number
}

const RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 120_000]
const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1
type ResolvedWebhookTarget = {
  url: URL
  address: string
  family: 4 | 6
}

const webhookFromRow = (row: typeof schema.agentWebhooks.$inferSelect): AgentWebhook => ({
  id: row.id,
  taskId: row.taskId,
  url: row.url,
  events: JSON.parse(row.eventsJson) as AgentWebhookEventType[],
  enabled: row.enabled,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const deliveryFromRow = (
  row: typeof schema.agentWebhookDeliveries.$inferSelect,
): AgentWebhookDelivery => ({
  id: row.id,
  webhookId: row.webhookId,
  eventId: row.eventId,
  eventType: row.eventType as AgentWebhookEventType,
  status: row.status as AgentWebhookDelivery['status'],
  attempt: row.attempt,
  nextAttemptAt: row.nextAttemptAt,
  responseStatus: row.responseStatus,
  error: row.error,
  createdAt: row.createdAt,
  deliveredAt: row.deliveredAt,
})

function isBlockedAddress(address: string): boolean {
  if (address === '127.0.0.1' || address === '::1') return false
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b! >= 64 && b! <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b! >= 16 && b! <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
  }
  const normalized = address.toLowerCase().split('%')[0]!
  return normalized.startsWith('fc') || normalized.startsWith('fd')
    || normalized.startsWith('fe8') || normalized.startsWith('fe9')
    || normalized.startsWith('fea') || normalized.startsWith('feb')
    || normalized.startsWith('ff')
    || normalized.startsWith('::ffff:')
    || normalized.startsWith('2001:db8:')
    || normalized.startsWith('2002:')
    || normalized === '::'
}

const normalizedHostname = (hostname: string): string =>
  hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname

const isLoopbackAddress = (address: string): boolean =>
  address === '127.0.0.1' || address === '::1'

async function resolvedWebhookTarget(value: string): Promise<ResolvedWebhookTarget> {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Webhook URL must use HTTPS.')
  if (url.username || url.password) throw new Error('Webhook URLs cannot contain credentials.')
  const hostname = normalizedHostname(url.hostname)
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error('Webhook URL resolves to a private or unsupported network address.')
  }
  if (url.protocol !== 'https:' && addresses.some(({ address }) => !isLoopbackAddress(address))) {
    throw new Error('Webhook URL must use HTTPS unless it resolves only to loopback.')
  }
  const target = addresses[0]!
  return {
    url,
    address: target.address,
    family: target.family === 6 ? 6 : 4,
  }
}

async function validatedWebhookUrl(value: string): Promise<string> {
  return (await resolvedWebhookTarget(value)).url.toString()
}

function postWebhook(
  target: ResolvedWebhookTarget,
  body: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const hostname = normalizedHostname(target.url.hostname)
    const request = (target.url.protocol === 'https:' ? requestHttps : requestHttp)({
      protocol: target.url.protocol,
      hostname: target.address,
      family: target.family,
      port: target.url.port || undefined,
      path: `${target.url.pathname}${target.url.search}`,
      method: 'POST',
      signal,
      ...(target.url.protocol === 'https:' && isIP(hostname) === 0 ? { servername: hostname } : {}),
      headers: {
        ...headers,
        host: target.url.host,
        'content-length': String(Buffer.byteLength(body)),
      },
    }, (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    request.on('error', reject)
    request.end(body)
  })
}

export class AgentWebhookService {
  readonly #db: AppDatabase
  readonly #secrets: SecretService
  #timer: ReturnType<typeof setTimeout> | null = null
  #pumping = false
  #stopped = false

  constructor(db: AppDatabase, secrets: SecretService) {
    this.#db = db
    this.#secrets = secrets
  }

  async create(input: {
    taskId?: string
    url: string
    events: AgentWebhookEventType[]
  }): Promise<{ webhook: AgentWebhook; signingSecret: string }> {
    if (input.taskId) {
      const [task] = await this.#db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, input.taskId))
        .limit(1)
      if (!task) throw new Error('Webhook task not found.')
    }
    const url = await validatedWebhookUrl(input.url)
    const events = [...new Set(input.events)]
    if (!events.length) throw new Error('Select at least one webhook event.')
    const id = randomUUID()
    const timestamp = Date.now()
    const signingSecret = randomBytes(32).toString('base64url')
    await this.#db.insert(schema.agentWebhooks).values({
      id,
      taskId: input.taskId ?? null,
      url,
      eventsJson: JSON.stringify(events),
      secretEnc: await this.#secrets.seal(signingSecret),
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const [row] = await this.#db.select().from(schema.agentWebhooks).where(eq(schema.agentWebhooks.id, id))
    if (!row) throw new Error('Webhook was not persisted.')
    return { webhook: webhookFromRow(row), signingSecret }
  }

  async list(): Promise<AgentWebhook[]> {
    const rows = await this.#db.select().from(schema.agentWebhooks).orderBy(asc(schema.agentWebhooks.createdAt))
    return rows.map(webhookFromRow)
  }

  async patch(id: string, patch: { enabled?: boolean; events?: AgentWebhookEventType[] }): Promise<AgentWebhook> {
    if (patch.events && !patch.events.length) throw new Error('Select at least one webhook event.')
    await this.#db
      .update(schema.agentWebhooks)
      .set({
        ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
        ...(patch.events ? { eventsJson: JSON.stringify([...new Set(patch.events)]) } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(schema.agentWebhooks.id, id))
    const [row] = await this.#db.select().from(schema.agentWebhooks).where(eq(schema.agentWebhooks.id, id))
    if (!row) throw new Error('Agent webhook not found.')
    return webhookFromRow(row)
  }

  async remove(id: string): Promise<void> {
    this.#db.transaction((tx) => {
      tx.delete(schema.agentWebhookDeliveries).where(eq(schema.agentWebhookDeliveries.webhookId, id)).run()
      tx.delete(schema.agentWebhooks).where(eq(schema.agentWebhooks.id, id)).run()
    })
  }

  async deliveries(webhookId: string, limit = 100): Promise<AgentWebhookDelivery[]> {
    const rows = await this.#db
      .select()
      .from(schema.agentWebhookDeliveries)
      .where(eq(schema.agentWebhookDeliveries.webhookId, webhookId))
      .orderBy(desc(schema.agentWebhookDeliveries.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200))
    return rows.map(deliveryFromRow)
  }

  async accept(frame: AgentWsFrame): Promise<void> {
    if (frame.channel !== 'agent:event') return
    const eventType = frame.event.event.type === 'turn_completed'
      ? 'completion'
      : frame.event.event.type === 'request' || frame.event.event.type === 'error'
        ? 'attention'
        : null
    if (!eventType) return
    const [session] = await this.#db
      .select({ taskId: schema.agentSessions.taskId, attention: schema.agentSessions.attention })
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.id, frame.event.sessionId))
      .limit(1)
    if (!session) return
    const webhooks = await this.#db
      .select()
      .from(schema.agentWebhooks)
      .where(and(
        eq(schema.agentWebhooks.enabled, true),
        or(
          eq(schema.agentWebhooks.taskId, session.taskId),
          isNull(schema.agentWebhooks.taskId),
        ),
      ))
    const payload: WebhookPayload = {
      version: 1,
      event: eventType,
      eventId: frame.event.id,
      sessionId: frame.event.sessionId,
      taskId: session.taskId,
      sequence: frame.event.seq,
      ...(eventType === 'attention' ? { attention: session.attention } : {}),
      occurredAt: frame.event.createdAt,
    }
    const timestamp = Date.now()
    for (const webhook of webhooks) {
      const events = JSON.parse(webhook.eventsJson) as AgentWebhookEventType[]
      if (!events.includes(eventType)) continue
      await this.#db.insert(schema.agentWebhookDeliveries).values({
        id: randomUUID(),
        webhookId: webhook.id,
        eventId: frame.event.id,
        eventType,
        payloadJson: JSON.stringify(payload),
        status: 'pending',
        nextAttemptAt: timestamp,
        createdAt: timestamp,
      }).onConflictDoNothing()
    }
    void this.pump()
  }

  async reconcile(): Promise<void> {
    await this.pump()
  }

  async stop(): Promise<void> {
    this.#stopped = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    while (this.#pumping) await new Promise((resolve) => setTimeout(resolve, 5))
  }

  async pump(): Promise<void> {
    if (this.#pumping || this.#stopped) return
    this.#pumping = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    try {
      for (;;) {
        const [delivery] = await this.#db
          .select()
          .from(schema.agentWebhookDeliveries)
          .where(and(
            inArray(schema.agentWebhookDeliveries.status, ['pending', 'retrying']),
            lte(schema.agentWebhookDeliveries.nextAttemptAt, Date.now()),
          ))
          .orderBy(asc(schema.agentWebhookDeliveries.nextAttemptAt))
          .limit(1)
        if (!delivery) break
        await this.#deliver(delivery)
      }
    } finally {
      this.#pumping = false
      if (!this.#stopped) await this.#scheduleNext()
    }
  }

  async #deliver(delivery: typeof schema.agentWebhookDeliveries.$inferSelect): Promise<void> {
    const [webhook] = await this.#db
      .select()
      .from(schema.agentWebhooks)
      .where(eq(schema.agentWebhooks.id, delivery.webhookId))
      .limit(1)
    if (!webhook?.enabled) {
      await this.#db
        .update(schema.agentWebhookDeliveries)
        .set({ status: 'failed', error: 'Webhook is disabled.' })
        .where(eq(schema.agentWebhookDeliveries.id, delivery.id))
      return
    }
    // reveal(): the signature is computed below over the delivery body, outside any scope this
    // could bracket. SecretUnavailable reads as the same null the old decrypt returned.
    const secret = await this.#secrets.reveal(webhook.secretEnc, 'agent webhook: sign delivery').catch((error: unknown) => {
      if (error instanceof SecretUnavailableError) return null
      throw error
    })
    if (!secret) {
      await this.#failAttempt(delivery, null, 'Webhook signing secret cannot be decrypted.', false)
      return
    }
    const signature = createHmac('sha256', secret).update(delivery.payloadJson).digest('hex')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      // Resolve and validate immediately before delivery, then connect to that exact address. This
      // closes the DNS-rebinding window between an SSRF check and the outbound socket.
      const target = await resolvedWebhookTarget(webhook.url)
      const responseStatus = await postWebhook(target, delivery.payloadJson, {
        'content-type': 'application/json',
        'user-agent': 'Acorn-Agent-Webhook/1',
        'x-acorn-event': delivery.eventType,
        'x-acorn-delivery': delivery.id,
        'x-acorn-signature-256': `sha256=${signature}`,
      }, controller.signal)
      if (responseStatus >= 200 && responseStatus < 300) {
        await this.#db
          .update(schema.agentWebhookDeliveries)
          .set({
            status: 'delivered',
            attempt: delivery.attempt + 1,
            responseStatus,
            error: null,
            deliveredAt: Date.now(),
          })
          .where(eq(schema.agentWebhookDeliveries.id, delivery.id))
      } else {
        await this.#failAttempt(
          delivery,
          responseStatus,
          `HTTP ${responseStatus}`,
          responseStatus >= 500 || responseStatus === 429,
        )
      }
    } catch (error) {
      await this.#failAttempt(
        delivery,
        null,
        error instanceof Error ? error.message.slice(0, 500) : 'Webhook delivery failed.',
        true,
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  async #failAttempt(
    delivery: typeof schema.agentWebhookDeliveries.$inferSelect,
    responseStatus: number | null,
    error: string,
    retryable: boolean,
  ): Promise<void> {
    const attempt = delivery.attempt + 1
    const retry = retryable && attempt < MAX_DELIVERY_ATTEMPTS
    await this.#db
      .update(schema.agentWebhookDeliveries)
      .set({
        status: retry ? 'retrying' : 'failed',
        attempt,
        responseStatus,
        error,
        nextAttemptAt: Date.now() + (retry ? RETRY_DELAYS_MS[attempt - 1]! : 0),
      })
      .where(eq(schema.agentWebhookDeliveries.id, delivery.id))
  }

  async #scheduleNext(): Promise<void> {
    const [next] = await this.#db
      .select({ at: schema.agentWebhookDeliveries.nextAttemptAt })
      .from(schema.agentWebhookDeliveries)
      .where(inArray(schema.agentWebhookDeliveries.status, ['pending', 'retrying']))
      .orderBy(asc(schema.agentWebhookDeliveries.nextAttemptAt))
      .limit(1)
    if (!next) return
    this.#timer = setTimeout(() => void this.pump(), Math.max(0, next.at - Date.now()))
  }
}
