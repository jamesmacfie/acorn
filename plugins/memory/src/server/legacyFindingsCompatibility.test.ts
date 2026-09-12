import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FindingCandidateRevision } from '@acorn/plugin-findings/contract/review.ts'
import type { FindingsLegacyMapping, FindingsMigrationReport } from '@acorn/plugin-findings/contract/lifecycle.ts'
import { MemoryProposalStore } from './memoryProposals'
import { resolveMappedLegacyProposal, type LegacyFindingsCompatibility } from './legacyFindingsCompatibility'

const report: FindingsMigrationReport = { version: 1, cutoverReady: true, files: 1, imported: { pending: 1, accepted: 0, rejected: 0 }, errors: 0, changed: 0, mappings: [] }
const candidate = (status: FindingCandidateRevision['status']): FindingCandidateRevision => ({
  candidateId: 'candidate-1', revision: 1, targetKind: 'memory:change', targetVersion: 1,
  scope: { kind: 'project', projectId: 'project-1' }, payload: {}, sourceObservationIds: ['observation-1'],
  payloadHash: 'payload-hash', fingerprint: 'fingerprint', subjectKey: 'subject', groupingExplanation: 'Legacy import.',
  warnings: [], base: null, status, snoozedUntil: null, createdAt: 1, updatedAt: 1,
})
const mapping = (id: string): FindingsLegacyMapping => ({
  legacyId: id, migrationVersion: 1, sourceFilename: `${id}.json`, sourceHash: 'source-hash', status: 'pending', observationId: 'observation-1',
  candidateId: 'candidate-1', candidateRevision: 1, candidatePayloadHash: 'payload-hash', oneToOne: true, error: null,
})

describe('legacy proposal status reconciliation after mapped findings decisions', () => {
  let dir: string, proposals: MemoryProposalStore
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'acorn-legacy-link-')); proposals = new MemoryProposalStore(dir) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const pending = () => proposals.propose({
    taskId: 'task-1', projectId: 'project-1', name: 'owner-boundaries', type: 'architecture',
    description: 'Keep writes with owners.', body: 'Use the owner boundary.', originSessionId: null,
  })
  const dependencies = (legacyId: string, overrides: Partial<LegacyFindingsCompatibility> = {}): LegacyFindingsCompatibility => ({
    migrationReport: async () => report,
    mapping: async () => mapping(legacyId),
    dismiss: async () => true,
    candidate: async () => candidate('ready'),
    approve: async () => ({ ok: true, state: 'applied' }),
    proposals,
    ...overrides,
  })

  it('repairs an interrupted approve link without repeating the memory effect, then stays hidden when findings is disabled', async () => {
    const proposal = await pending()
    let applied = false, memoryEffects = 0
    const approve = vi.fn(async () => {
      if (!applied) { applied = true; memoryEffects += 1 }
      return { ok: true, state: 'applied' }
    })
    const actualResolve = proposals.resolve.bind(proposals)
    const resolve = vi.fn()
      .mockRejectedValueOnce(new Error('status replacement interrupted'))
      .mockImplementation((...args: Parameters<MemoryProposalStore['resolve']>) => actualResolve(...args))
    const deps = dependencies(proposal.id, { approve, candidate: async () => candidate(applied ? 'applied' : 'ready'), proposals: { get: proposals.get.bind(proposals), resolve } })

    await expect(resolveMappedLegacyProposal({ id: proposal.id, approved: true, deviceId: 'device-1' }, deps)).rejects.toThrow('interrupted')
    expect((await proposals.get(proposal.id))?.status).toBe('pending')
    expect(await resolveMappedLegacyProposal({ id: proposal.id, approved: true, deviceId: 'device-1' }, deps)).toMatchObject({ ok: true, state: 'applied' })
    expect(memoryEffects).toBe(1)
    expect(await proposals.list('pending')).toEqual([])
  })

  it('repairs an interrupted rejection link, then stays hidden when findings is disabled', async () => {
    const proposal = await pending()
    let dismissed = false
    const dismiss = vi.fn(async () => { dismissed = true; return true })
    const actualResolve = proposals.resolve.bind(proposals)
    const resolve = vi.fn()
      .mockRejectedValueOnce(new Error('status replacement interrupted'))
      .mockImplementation((...args: Parameters<MemoryProposalStore['resolve']>) => actualResolve(...args))
    const deps = dependencies(proposal.id, { dismiss, candidate: async () => candidate(dismissed ? 'dismissed' : 'ready'), proposals: { get: proposals.get.bind(proposals), resolve } })

    await expect(resolveMappedLegacyProposal({ id: proposal.id, approved: false, deviceId: 'device-1' }, deps)).rejects.toThrow('interrupted')
    expect((await proposals.get(proposal.id))?.status).toBe('pending')
    expect(await resolveMappedLegacyProposal({ id: proposal.id, approved: false, deviceId: 'device-1' }, deps)).toEqual({ ok: true })
    expect(await proposals.list('pending')).toEqual([])
  })
})
