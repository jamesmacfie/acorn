import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { observations } from './schema'

const migration = readFileSync(
  fileURLToPath(new URL('../../migrations/0007_classify_lifecycle_review_inputs.sql', import.meta.url)),
  'utf8',
)

describe('findings data migrations', () => {
  let store: TestPluginDb

  beforeEach(() => {
    store = makeTestPluginDb('findings')
  })

  afterEach(() => store.cleanup())

  it('reclassifies only lifecycle-generated legacy observations', () => {
    const row = (input: {
      id: string
      producerId: string
      kindId?: string
      kindLabel?: string
      createdAt: number
    }): typeof observations.$inferInsert => ({
      id: input.id,
      scopeKind: 'task',
      taskId: 'task',
      projectId: 'project',
      workspaceId: 'workspace',
      scopeLabelsJson: '{}',
      originKind: 'agent',
      originJson: JSON.stringify({ kind: 'agent', sessionId: 'session' }),
      producerId: input.producerId,
      kindId: input.kindId ?? 'findings:observation',
      kindVersion: 1,
      kindLabel: input.kindLabel ?? 'Observation',
      title: input.id,
      body: 'Stored evidence.',
      claimStatus: 'observed',
      sourceNamespace: `task:task:${input.producerId}`,
      sourceKey: input.id,
      payloadHash: `hash:${input.id}`,
      evidenceJson: '[]',
      createdAt: input.createdAt,
    })

    store.db.insert(observations).values([
      row({ id: 'legacy-lifecycle', producerId: 'lifecycle:agent', createdAt: 1 }),
      row({ id: 'explicit-finding', producerId: 'findings:agent-tool', createdAt: 2 }),
      row({ id: 'other-lifecycle-kind', producerId: 'lifecycle:workflow', kindId: 'scanner:hazard', kindLabel: 'Hazard', createdAt: 3 }),
    ]).run()

    store.db.$client.exec(migration)

    expect(store.db.select({
      id: observations.id,
      kindId: observations.kindId,
      kindLabel: observations.kindLabel,
      body: observations.body,
    }).from(observations).all()).toEqual([
      { id: 'legacy-lifecycle', kindId: 'findings:review-input', kindLabel: 'Review input', body: 'Stored evidence.' },
      { id: 'explicit-finding', kindId: 'findings:observation', kindLabel: 'Observation', body: 'Stored evidence.' },
      { id: 'other-lifecycle-kind', kindId: 'scanner:hazard', kindLabel: 'Hazard', body: 'Stored evidence.' },
    ])
  })
})
