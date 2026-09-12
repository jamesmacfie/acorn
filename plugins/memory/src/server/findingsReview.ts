import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { FindingReviewTargetContribution } from '@acorn/plugin-findings/contract/extensions.ts'
import { FINDINGS_REVIEW, type FindingTargetController } from '@acorn/plugin-findings/contract/review.ts'
import { memoryPromotionReceipts } from '../node/schema'
import { memoryChangePayloadSchema, resolveMemoryScope, type MemoryChangePayload } from '../contract/findingsReview'
import { privateMemoryRoot, projectMemoryDir, writeMemoryFile, type MemoryRow } from './memory'
import type { MemoryKnowledge } from './knowledgeChannel'

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const normalize = (text: string): string => text.trim().replace(/\s+/g, ' ')
const fingerprint = (payload: MemoryChangePayload): string => digest({ scope: payload.scope, name: payload.name.toLowerCase(), type: payload.type, description: normalize(payload.description), body: normalize(payload.body) })
const rowPayload = (row: MemoryRow): MemoryChangePayload => ({ operation: 'add', name: row.name, type: row.type as MemoryChangePayload['type'], description: row.description, body: row.body, scope: row.scope === 'private' ? { kind: 'private' } : { kind: 'project', projectId: row.projectId! } })
const rowVersionHash = (row: MemoryRow): string => digest(rowPayload(row))

export type MemoryFindingsTarget = {
  contribution: FindingReviewTargetContribution
  approve(args: { candidateId: string; revision: number; payloadHash: string; idempotencyKey: string; deviceId: string }): Promise<{ ok: boolean; state?: string; targetReference?: string; reason?: string }>
}

export const createMemoryFindingsTarget = (args: { db: PluginDatabase; memory: MemoryKnowledge; capabilities: { get(id: typeof FINDINGS_REVIEW): import('@acorn/plugin-findings/contract/review.ts').FindingsReviewCapability | undefined }; homeDir: string; announce(projectId: string | null): void }): MemoryFindingsTarget => {
  let controller: FindingTargetController | null = null
  const allRows = async (scope: MemoryChangePayload['scope']): Promise<MemoryRow[]> => {
    await args.memory.reconciled()
    const rows = await args.memory.list(scope.kind === 'project' ? { projectId: scope.projectId } : { projectId: null })
    return rows.filter((row) => scope.kind === 'private' ? row.scope === 'private' : row.scope === 'project' && row.projectId === scope.projectId)
  }
  const validate: FindingReviewTargetContribution['validate'] = async ({ scope, payload: raw }) => {
    const parsed = memoryChangePayloadSchema.safeParse(raw)
    if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
    let payload = resolveMemoryScope(parsed.data, scope)
    if (payload.scope.kind === 'project' && !payload.scope.projectId) throw new Error('project memory requires a project-scoped candidate')
    const rows = await allRows(payload.scope)
    const sameName = rows.find((row) => row.name === payload.name)
    const warnings: string[] = []
    let base: { targetId: string; hash: string; payload: unknown } | undefined
    if (payload.operation === 'add' && sameName && fingerprint(rowPayload(sameName)) !== fingerprint(payload)) {
      const baseHash = rowVersionHash(sameName)
      payload = { ...payload, operation: 'update', baseMemoryId: sameName.id, baseHash }
      base = { targetId: sameName.id, hash: baseHash, payload: rowPayload(sameName) }
      warnings.push(`Updates the existing '${sameName.name}' memory; review the before/after diff.`)
    } else if (payload.operation === 'update') {
      const found = rows.find((row) => row.id === payload.baseMemoryId)
      if (!found || rowVersionHash(found) !== payload.baseHash) {
        // A durable approval may have replaced the content-addressed base before Findings received
        // its applied transition. Treat the exact desired file as the completed effect so retry can
        // repair linkage without writing again; every other base change remains a conflict.
        if (!sameName || fingerprint(rowPayload(sameName)) !== fingerprint(payload)) throw new Error('the proposed update base is no longer current')
      } else {
        if (found.name !== payload.name) throw new Error('renaming a memory during an update is not supported')
        base = { targetId: found.id, hash: rowVersionHash(found), payload: rowPayload(found) }
      }
    }
    return { payload, payloadHash: digest(payload), fingerprint: fingerprint(payload), subjectKey: `${payload.scope.kind}:${payload.scope.kind === 'project' ? payload.scope.projectId : ''}:${payload.name.toLowerCase()}`, warnings, ...(base ? { base } : {}) }
  }
  const contribution: FindingReviewTargetContribution = {
    version: 1,
    validate,
    acceptedFingerprints: async (scope) => {
      const resolvedScope = scope.kind === 'project' ? { kind: 'project' as const, projectId: scope.projectId } : { kind: 'private' as const }
      return (await allRows(resolvedScope)).map((row) => fingerprint(rowPayload(row)))
    },
    connect: (next) => { controller = next; return () => { if (controller === next) controller = null } },
  }

  const approve: MemoryFindingsTarget['approve'] = async (request) => {
    const findings = args.capabilities.get(FINDINGS_REVIEW)
    if (!findings || !controller) return { ok: false, reason: 'Findings review is unavailable.' }
    const keyedReceipt = args.db.select().from(memoryPromotionReceipts).where(eq(memoryPromotionReceipts.operationId, request.idempotencyKey)).get()
    const revisionReceipt = args.db.select().from(memoryPromotionReceipts).where(and(eq(memoryPromotionReceipts.candidateId, request.candidateId), eq(memoryPromotionReceipts.candidateRevision, request.revision))).get()
    if (keyedReceipt && revisionReceipt && keyedReceipt.operationId !== revisionReceipt.operationId) return { ok: false, reason: 'That approval idempotency key belongs to a different approval.' }
    // Candidate revision is the durable exactly-once identity. A reconnect can mint a fresh HTTP
    // key after losing the response; reuse the existing revision receipt after verifying its full
    // binding instead of stranding an applying candidate or creating a second file effect.
    const existingReceipt = keyedReceipt ?? revisionReceipt
    const operationId = existingReceipt?.operationId ?? request.idempotencyKey
    const [latest, requested] = await Promise.all([findings.candidate(request.candidateId), findings.candidate(request.candidateId, request.revision)])
    const retryableState = !!existingReceipt && (latest?.status === 'applying' || latest?.status === 'applied')
    if (!requested || !latest || latest.revision !== request.revision || requested.payloadHash !== request.payloadHash || (latest.status !== 'ready' && !retryableState)) return { ok: false, reason: 'This candidate changed. Refresh its preview before approving.' }
    const validated = await validate({ scope: requested.scope, payload: requested.payload }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
    if ('error' in validated) { await controller.conflict(request.candidateId, request.revision, operationId, validated.error); return { ok: false, reason: validated.error } }
    if (validated.payloadHash !== requested.payloadHash) return { ok: false, reason: 'Memory validation changed the approved payload. Refresh before approving.' }
    const payload = validated.payload as MemoryChangePayload
    const targetPathIdentity = `${payload.scope.kind}:${payload.scope.kind === 'project' ? payload.scope.projectId : ''}:${payload.name}`
    if (existingReceipt && (
      existingReceipt.candidateId !== request.candidateId
      || existingReceipt.candidateRevision !== request.revision
      || existingReceipt.payloadHash !== request.payloadHash
      || existingReceipt.deviceId !== request.deviceId
      || existingReceipt.targetPathIdentity !== targetPathIdentity
    )) return { ok: false, reason: 'That approval idempotency key belongs to a different approval.' }
    const at = Date.now()
    if (!existingReceipt) args.db.insert(memoryPromotionReceipts).values({ operationId: request.idempotencyKey, candidateId: request.candidateId, candidateRevision: request.revision, payloadHash: request.payloadHash, payloadJson: JSON.stringify(payload), scopeJson: JSON.stringify(payload.scope), targetPathIdentity, expectedBaseHash: payload.baseHash ?? null, deviceId: request.deviceId, state: 'prepared', targetReference: null, failureCode: null, createdAt: at, updatedAt: at }).run()
    const receipt = existingReceipt ?? args.db.select().from(memoryPromotionReceipts).where(eq(memoryPromotionReceipts.operationId, request.idempotencyKey)).get()!
    if (receipt.state === 'applied' && receipt.targetReference) {
      await controller.applied(request.candidateId, request.revision, operationId, receipt.targetReference).catch(() => undefined)
      return { ok: true, state: 'applied', targetReference: receipt.targetReference }
    }
    await controller.applying(request.candidateId, request.revision, operationId)
    await args.memory.reconciled()
    const rows = await allRows(payload.scope)
    const target = rows.find((row) => row.name === payload.name)
    const updateBase = payload.operation === 'update' ? rows.find((row) => row.id === payload.baseMemoryId) : null
    if (target && fingerprint(rowPayload(target)) === fingerprint(payload)) {
      args.db.update(memoryPromotionReceipts).set({ state: 'applied', targetReference: target.id, updatedAt: Date.now() }).where(eq(memoryPromotionReceipts.operationId, operationId)).run()
      await controller.applied(request.candidateId, request.revision, operationId, target.id).catch(() => undefined)
      return { ok: true, state: 'applied', targetReference: target.id }
    }
    if (payload.operation === 'update' && (!updateBase || rowVersionHash(updateBase) !== payload.baseHash)) {
      const reason = 'The accepted memory changed after this preview was prepared.'
      args.db.update(memoryPromotionReceipts).set({ state: 'conflict', failureCode: 'base_changed', updatedAt: Date.now() }).where(eq(memoryPromotionReceipts.operationId, operationId)).run()
      await controller.conflict(request.candidateId, request.revision, operationId, reason); return { ok: false, reason }
    }
    if (payload.operation === 'add' && target) {
      const reason = 'A different memory now uses this name.'
      args.db.update(memoryPromotionReceipts).set({ state: 'conflict', failureCode: 'name_changed', updatedAt: Date.now() }).where(eq(memoryPromotionReceipts.operationId, operationId)).run()
      await controller.conflict(request.candidateId, request.revision, operationId, reason)
      return { ok: false, reason }
    }
    const dir = payload.scope.kind === 'private' ? privateMemoryRoot(args.homeDir) : projectMemoryDir(args.homeDir, payload.scope.projectId!)
    await writeMemoryFile(dir, { name: payload.name, type: payload.type, description: payload.description, body: payload.body, originSessionId: null, commitSha: null, supersededBy: null, createdAt: target?.createdAt ?? Date.now() })
    await args.memory.reconciled()
    const written = (await allRows(payload.scope)).find((row) => row.name === payload.name)
    if (!written || fingerprint(rowPayload(written)) !== fingerprint(payload)) throw new Error('memory write could not be reconciled')
    args.db.update(memoryPromotionReceipts).set({ state: 'applied', targetReference: written.id, failureCode: null, updatedAt: Date.now() }).where(eq(memoryPromotionReceipts.operationId, operationId)).run()
    args.announce(payload.scope.kind === 'project' ? payload.scope.projectId! : null)
    await controller.applied(request.candidateId, request.revision, operationId, written.id).catch(() => undefined)
    return { ok: true, state: 'applied', targetReference: written.id }
  }
  return { contribution, approve }
}
