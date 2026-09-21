import { describe, expect, it, vi } from 'vitest'
import type { FindingReviewTargetContribution } from '../contract/extensions'
import type { FindingObservation } from '../contract/records'
import { synthesizeFindingsWithModel } from './modelSynthesis'

const observation: FindingObservation = {
  id: 'observation-1', scope: { kind: 'task', taskId: 'task-1' }, scopeLabels: {},
  origin: { kind: 'agent', sessionId: 'session-1' },
  kind: { id: 'findings:observation', version: 1, label: 'Observation', available: true },
  title: 'Repository boundaries', body: 'Keep writes behind the owning service.', claimStatus: 'observed',
  sourceKey: 'source-1', evidence: [], createdAt: 1, withdrawal: null,
}

const response = (operation: string, usage: { inputTokens: number; outputTokens: number }) => ({
  text: JSON.stringify({
    candidates: [{
      payload: { operation }, sourceIds: [observation.id], explanation: 'Reusable architecture rule.',
    }],
    omitted: [],
  }),
  providerId: 'fixture', backendId: 'connection:model-1', modelId: 'fixture-model', usage,
})

const target = (): FindingReviewTargetContribution => ({
  version: 1,
  connect: () => {},
  acceptedFingerprints: async () => [],
  validate: async ({ payload }) => {
    const operation = (payload as { operation?: unknown }).operation
    if (operation !== 'add' && operation !== 'update') throw new Error('operation: Invalid option: expected one of "add"|"update"')
    return { payload, payloadHash: JSON.stringify(payload), fingerprint: JSON.stringify(payload), subjectKey: 'repository-boundaries', warnings: [] }
  },
})

describe('model findings synthesis', () => {
  it('corrects one target-invalid response before returning candidates', async () => {
    const generateText = vi.fn()
      .mockResolvedValueOnce(response('create', { inputTokens: 10, outputTokens: 4 }))
      .mockResolvedValueOnce(response('add', { inputTokens: 12, outputTokens: 5 }))

    const result = await synthesizeFindingsWithModel({
      observations: [observation], scope: { kind: 'project', projectId: 'project-1' }, target: target(),
      targetContext: { instructions: 'Use add or update.', existing: [] }, generateText,
      userId: 'owner', backendId: 'connection:model-1', modelId: 'fixture-model',
    })

    expect(result.groups[0]?.payload).toEqual({ operation: 'add' })
    expect(result.usage).toEqual({ inputTokens: 22, outputTokens: 9 })
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(JSON.parse(generateText.mock.calls[1]![0].input.prompt)).toMatchObject({
      correction: {
        error: 'operation: Invalid option: expected one of "add"|"update"',
        instruction: expect.stringContaining('complete replacement response'),
      },
    })
  })

  it('stops after one correction pass', async () => {
    const generateText = vi.fn().mockResolvedValue(response('create', { inputTokens: 1, outputTokens: 1 }))

    await expect(synthesizeFindingsWithModel({
      observations: [observation], scope: { kind: 'project', projectId: 'project-1' }, target: target(),
      targetContext: null, generateText, userId: 'owner', backendId: 'connection:model-1',
    })).rejects.toThrow('expected one of')
    expect(generateText).toHaveBeenCalledTimes(2)
  })
})
