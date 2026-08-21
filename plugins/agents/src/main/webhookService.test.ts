import { randomUUID } from 'node:crypto'
import { SecretService } from '@acorn/node-core/main/core/secrets.ts'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { memoryIdentityStore } from '@acorn/node-core/main/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/main/core/index.ts'
import { makeTestDb, makeTestPluginDb, type TestDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import * as schema from '../node/schema'
import { AgentWebhookService } from './webhookService'

const ENCRYPTION_KEY = '22'.repeat(32)
const SECRETS = new SecretService(ENCRYPTION_KEY)

describe('managed-agent signed webhooks', () => {
  // The webhook and delivery rows live in this plugin's file. `coreDb` exists only so the create-time
  // "does this task exist" guard has a real core database to fail against, which is what the last case in
  // this file asserts.
  let testDb: TestPluginDb
  let coreDb: TestDb
  let service: AgentWebhookService

  beforeEach(() => {
    testDb = makeTestPluginDb('agents')
    coreDb = makeTestDb()
    service = new AgentWebhookService(testDb.db, SECRETS, createCoreServices({ secrets: SECRETS, db: coreDb.db, activeIdentity: memoryIdentityStore() }))
  })

  afterEach(async () => {
    await service.stop()
    testDb.cleanup()
    coreDb.cleanup()
  })

  it('shows a signing secret once and stores only its encrypted form', async () => {
    const created = await service.create({
      url: 'http://127.0.0.1:54321/acorn',
      events: ['completion', 'attention'],
    })
    expect(created.signingSecret).toHaveLength(43)
    expect(await service.list()).toEqual([created.webhook])
    const [row] = await testDb.db
      .select()
      .from(schema.agentWebhooks)
      .where(eq(schema.agentWebhooks.id, created.webhook.id))
    expect(row.secretEnc).not.toContain(created.signingSecret)
  })

  it('queues a content-free, deduplicated delivery after the event ledger commit', async () => {
    const webhook = await service.create({
      url: 'http://127.0.0.1:54321/acorn',
      events: ['attention'],
    })
    await service.stop()
    const sessionId = randomUUID()
    const taskId = randomUUID()
    const timestamp = Date.now()
    await testDb.db.insert(schema.agentSessions).values({
      id: sessionId,
      taskId,
      providerId: 'codex',
      profileId: 'codex',
      kind: 'interactive',
      driverKind: 'codex-app-server',
      driverVersion: 'test',
      controller: 'acorn',
      runtimeState: 'waiting',
      attention: 'permission',
      statusAuthority: 'protocol',
      title: 'Secret prompt-derived title',
      configJson: '{}',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const eventId = randomUUID()
    const frame = {
      channel: 'agent:event' as const,
      event: {
        id: eventId,
        sessionId,
        turnId: randomUUID(),
        seq: 4,
        schemaVersion: 1,
        event: {
          type: 'request' as const,
          requestId: 'permission-1',
          kind: 'permission' as const,
          title: 'Run rm on secret-file?',
        },
        searchText: null,
        createdAt: timestamp,
      },
    }
    await service.accept(frame)
    await service.accept(frame)
    const deliveries = await service.deliveries(webhook.webhook.id)
    expect(deliveries).toHaveLength(1)
    const [row] = await testDb.db
      .select()
      .from(schema.agentWebhookDeliveries)
      .where(eq(schema.agentWebhookDeliveries.id, deliveries[0]!.id))
    expect(row.payloadJson).not.toContain('secret')
    expect(JSON.parse(row.payloadJson)).toMatchObject({
      event: 'attention',
      eventId,
      sessionId,
      taskId,
      sequence: 4,
      attention: 'permission',
    })
  })

  it('refuses non-loopback cleartext and private-network destinations', async () => {
    await expect(service.create({
      url: 'http://169.254.169.254/latest/meta-data',
      events: ['attention'],
    })).rejects.toThrow(/private|HTTPS/)
  })

  it('normalizes IPv6 loopback without treating URL brackets as a DNS hostname', async () => {
    const created = await service.create({
      url: 'http://[::1]:54321/acorn',
      events: ['completion'],
    })
    expect(created.webhook.url).toBe('http://[::1]:54321/acorn')
  })

  it('does not create a task-filtered webhook for an unknown task', async () => {
    await expect(service.create({
      taskId: randomUUID(),
      url: 'http://127.0.0.1:54321/acorn',
      events: ['attention'],
    })).rejects.toThrow(/task not found/)
  })
})
