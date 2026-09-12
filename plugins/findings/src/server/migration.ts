import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { FindingLegacySourceContribution } from '../contract/extensions'
import type { FindingsLegacyMapping, FindingsMigrationReport } from '../contract/lifecycle'
import {
  findingBundles,
  findingCandidateObservations,
  findingCandidateRevisions,
  findingCandidates,
  findingGroupingOutcomes,
  findingLegacyImports,
  findingLifecycleCheckpoints,
  findingPreparationInputs,
  findingPreparationJobs,
  findingReviewActions,
  observations,
} from '../node/schema'
import type { FindingsRuntime } from './runtime'

export const LEGACY_IMPORT_VERSION = 1

type LegacyProposal = {
  id: string
  taskId: string
  projectId: string | null
  name: string
  type: string
  description: string
  body: string
  flags: string[]
  originSessionId: string | null
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: number
}

const parseLegacy = (value: unknown): LegacyProposal => {
  if (!value || typeof value !== 'object') throw new Error('proposal is not an object')
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id || typeof row.taskId !== 'string' || !row.taskId) throw new Error('proposal identity is invalid')
  if (typeof row.name !== 'string' || typeof row.description !== 'string' || typeof row.body !== 'string' || typeof row.type !== 'string') throw new Error('proposal content is invalid')
  if (!['pending', 'accepted', 'rejected'].includes(String(row.status)) || typeof row.createdAt !== 'number') throw new Error('proposal lifecycle is invalid')
  return {
    id: row.id,
    taskId: row.taskId,
    projectId: typeof row.projectId === 'string' ? row.projectId : null,
    name: row.name,
    type: row.type,
    description: row.description,
    body: row.body,
    flags: Array.isArray(row.flags) ? row.flags.filter((flag): flag is string => typeof flag === 'string') : [],
    originSessionId: typeof row.originSessionId === 'string' ? row.originSessionId : null,
    status: row.status as LegacyProposal['status'],
    createdAt: row.createdAt,
  }
}

const mapping = (row: typeof findingLegacyImports.$inferSelect): FindingsLegacyMapping => ({
  migrationVersion: row.migrationVersion,
  legacyId: row.legacyId,
  sourceFilename: row.sourceFilename,
  sourceHash: row.sourceHash,
  status: row.status as FindingsLegacyMapping['status'],
  observationId: row.observationId,
  candidateId: row.candidateId,
  candidateRevision: row.candidateRevision,
  candidatePayloadHash: row.candidatePayloadHash,
  oneToOne: row.oneToOne,
  error: row.error,
})

export class FindingsLegacyMigration {
  constructor(
    private readonly db: PluginDatabase,
    private readonly runtime: FindingsRuntime,
    private readonly sources: () => readonly { id: string; value: FindingLegacySourceContribution }[],
  ) {}

  async run(): Promise<FindingsMigrationReport> {
    for (const source of this.sources()) {
      const files = await source.value.list()
      for (const file of [...files].sort((a, b) => a.filename.localeCompare(b.filename))) {
        await this.importFile(file.filename, file.source)
      }
    }
    return this.report()
  }

  report(): FindingsMigrationReport {
    const mappings = this.db.select().from(findingLegacyImports).all().map(mapping)
    const count = (status: FindingsLegacyMapping['status']) => mappings.filter((entry) => entry.status === status).length
    return {
      version: LEGACY_IMPORT_VERSION,
      cutoverReady: count('error') === 0 && count('changed') === 0,
      files: mappings.length,
      imported: { pending: count('pending'), accepted: count('accepted'), rejected: count('rejected') },
      errors: count('error'),
      changed: count('changed'),
      mappings,
    }
  }

  mapping(legacyId: string): FindingsLegacyMapping | null {
    const row = this.db.select().from(findingLegacyImports).where(eq(findingLegacyImports.legacyId, legacyId)).get()
    return row ? mapping(row) : null
  }

  dismissLegacy(legacyId: string, actorId: string): boolean {
    const entry = this.mapping(legacyId)
    if (!entry?.oneToOne || !entry.candidateId || !entry.candidateRevision) return false
    const candidate = this.runtime.candidate(entry.candidateId)
    if (!candidate || candidate.revision !== entry.candidateRevision || candidate.payloadHash !== entry.candidatePayloadHash
      || candidate.sourceObservationIds.length !== 1 || candidate.sourceObservationIds[0] !== entry.observationId) return false
    if (candidate.status === 'dismissed') return true
    if (candidate.status !== 'ready') return false
    this.runtime.decideCandidate({
      candidateId: candidate.candidateId,
      expectedRevision: candidate.revision,
      actorId,
      action: 'dismiss',
      idempotencyKey: `legacy-dismiss:${legacyId}:${candidate.revision}`,
    })
    return true
  }

  export(): unknown {
    return {
      version: 1,
      exportedAt: Date.now(),
      migration: this.report(),
      observations: this.db.select().from(observations).all(),
      lifecycleCheckpoints: this.db.select().from(findingLifecycleCheckpoints).all(),
      candidates: this.db.select().from(findingCandidates).all(),
      candidateRevisions: this.db.select().from(findingCandidateRevisions).all(),
      candidateObservations: this.db.select().from(findingCandidateObservations).all(),
      bundles: this.db.select().from(findingBundles).all(),
      groupingOutcomes: this.db.select().from(findingGroupingOutcomes).all(),
      preparationJobs: this.db.select().from(findingPreparationJobs).all(),
      preparationInputs: this.db.select().from(findingPreparationInputs).all(),
      reviewHistory: this.db.select().from(findingReviewActions).all(),
    }
  }

  private async importFile(filename: string, source: string | null): Promise<void> {
    const sourceFilename = filename.split(/[\\/]/).at(-1) ?? filename
    const fallbackId = `file:${filename.replace(/\.json$/, '')}`
    if (source == null) return this.recordFailure(fallbackId, sourceFilename, '', 'proposal file is unreadable')
    const sourceHash = createHash('sha256').update(source).digest('hex')
    let proposal: LegacyProposal
    try { proposal = parseLegacy(JSON.parse(source) as unknown) }
    catch (error) { return this.recordFailure(fallbackId, sourceFilename, sourceHash, error instanceof Error ? error.message : 'proposal is malformed') }
    const filenameFailure = this.db.select().from(findingLegacyImports).where(and(
      eq(findingLegacyImports.sourceFilename, sourceFilename),
      eq(findingLegacyImports.status, 'error'),
    )).get()
    if (filenameFailure && filenameFailure.legacyId !== proposal.id) {
      this.db.delete(findingLegacyImports).where(eq(findingLegacyImports.legacyId, filenameFailure.legacyId)).run()
    }
    const existing = this.db.select().from(findingLegacyImports).where(eq(findingLegacyImports.legacyId, proposal.id)).get()
    if (existing?.sourceHash === sourceHash && existing.status !== 'error') return
    if (existing && existing.status !== 'error' && existing.sourceHash !== sourceHash) {
      try {
        const imported = await this.runtime.importLegacyProposal(proposal)
        if (existing.observationId !== imported.observationId || existing.candidateId !== imported.candidateId
          || existing.candidateRevision !== imported.revision || existing.candidatePayloadHash !== imported.payloadHash) {
          throw new Error('the imported destination identity changed')
        }
        this.db.update(findingLegacyImports).set({
          sourceHash,
          status: proposal.status,
          error: null,
          updatedAt: Date.now(),
        }).where(eq(findingLegacyImports.legacyId, proposal.id)).run()
      } catch {
        this.db.update(findingLegacyImports).set({ status: 'changed', error: 'Legacy source changed after import; reconcile it before cutover.', updatedAt: Date.now() }).where(eq(findingLegacyImports.legacyId, proposal.id)).run()
      }
      return
    }
    try {
      const imported = await this.runtime.importLegacyProposal(proposal)
      const at = Date.now()
      this.db.insert(findingLegacyImports).values({
        legacyId: proposal.id,
        migrationVersion: LEGACY_IMPORT_VERSION,
        sourceFilename,
        sourceHash,
        status: proposal.status,
        observationId: imported.observationId,
        candidateId: imported.candidateId,
        candidateRevision: imported.revision,
        candidatePayloadHash: imported.payloadHash,
        oneToOne: true,
        error: null,
        importedAt: at,
        updatedAt: at,
      }).onConflictDoUpdate({
        target: findingLegacyImports.legacyId,
        set: { sourceFilename, sourceHash, status: proposal.status, observationId: imported.observationId, candidateId: imported.candidateId, candidateRevision: imported.revision, candidatePayloadHash: imported.payloadHash, oneToOne: true, error: null, updatedAt: at },
      }).run()
    } catch (error) {
      this.recordFailure(proposal.id, sourceFilename, sourceHash, error instanceof Error ? error.message : 'legacy import failed')
    }
  }

  private recordFailure(legacyId: string, sourceFilename: string, sourceHash: string, error: string): void {
    const at = Date.now()
    this.db.insert(findingLegacyImports).values({
      legacyId,
      migrationVersion: LEGACY_IMPORT_VERSION,
      sourceFilename,
      sourceHash,
      status: 'error',
      observationId: null,
      candidateId: null,
      candidateRevision: null,
      candidatePayloadHash: null,
      oneToOne: false,
      error,
      importedAt: at,
      updatedAt: at,
    }).onConflictDoUpdate({ target: findingLegacyImports.legacyId, set: { sourceFilename, sourceHash, status: 'error', error, updatedAt: at } }).run()
  }
}
