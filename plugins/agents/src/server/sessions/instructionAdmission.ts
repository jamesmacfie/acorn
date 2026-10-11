import { deliverableSkills, type CoreServices } from '@acorn/plugin-api/node'
import { readAgentSessionDefaults } from '../sessionDefaultsStore'
import { hiddenCharacterReason, hiddenCharactersIn } from './instructionCheck'
import { InstructionScanIncomplete, scanInstructions, type InstructionSnapshot } from './instructionSnapshot'
import { InstructionReviewStore, snapshotDigest } from './instructionReviewStore'
import { analyzeInstruction, instructionChanges } from './instructionAnalysis'
import { InstructionAdmissionError } from './instructionAdmissionError'
import type { InstructionReview } from '../../shared/instructionReview'

export type InstructionAdmissionObservation = {
  taskId: string
  projectId: string
  checkedAt: number
  outcome: 'passed' | 'blocked' | 'incomplete'
}

export class InstructionAdmission {
  private readonly observations = new Map<string, InstructionAdmissionObservation>()
  constructor(
    private readonly core: CoreServices,
    private readonly dataDir: string,
    readonly store: InstructionReviewStore,
  ) {}

  latest(projectId: string | null, taskId: string | null): InstructionAdmissionObservation | null {
    if (taskId) return this.observations.get(taskId) ?? null
    if (!projectId) return null
    return [...this.observations.values()].reverse().find((entry) => entry.projectId === projectId) ?? null
  }

  private observe(taskId: string, projectId: string, outcome: InstructionAdmissionObservation['outcome']): void {
    this.observations.delete(taskId)
    this.observations.set(taskId, { taskId, projectId, checkedAt: Date.now(), outcome })
    if (this.observations.size > 100) this.observations.delete(this.observations.keys().next().value!)
  }

  async scan(taskId: string, signal?: AbortSignal): Promise<{ projectId: string; snapshot: InstructionSnapshot }> {
    this.checkCancellation(signal)
    const task = await this.core.tasks.load(taskId)
    this.checkCancellation(signal)
    if (!task) throw new Error('Task no longer exists.')
    const root = await this.core.tasks.requireRoot(taskId)
    this.checkCancellation(signal)
    const skills = await deliverableSkills(this.dataDir)
    this.checkCancellation(signal)
    const snapshot = await scanInstructions(root, skills, signal)
    return { projectId: task.projectId, snapshot }
  }

  async review(taskId: string, signal?: AbortSignal): Promise<InstructionReview> {
    const { projectId, snapshot } = await this.scan(taskId, signal)
    this.checkCancellation(signal)
    const digest = snapshotDigest(snapshot)
    const limits =
      'A pre-turn scan cannot stop changes during a turn. Global instructions outside this scope are not reviewed. Host processes with owner access can change on-disk state.'
    if (!snapshot.files.length)
      return {
        id: null,
        taskId,
        projectId,
        digest,
        scope: snapshot.scope,
        analyzerVersion: snapshot.version,
        baseline: false,
        empty: true,
        approved: false,
        findings: [],
        changes: [],
        limits,
      }
    let prior = null
    try {
      const matching = await this.store.approvedSnapshot(digest)
      this.checkCancellation(signal)
      if (matching)
        return {
          id: matching.id,
          taskId,
          projectId,
          digest,
          scope: snapshot.scope,
          analyzerVersion: snapshot.version,
          baseline: false,
          approved: true,
          findings: [],
          changes: [],
          limits,
        }
      const approved = await this.store.approved(projectId)
      prior = approved ? await this.store.get(approved.id) : null
    } catch {
      /* Damaged or unavailable ciphertext means a fresh baseline review. */
    }
    this.checkCancellation(signal)
    const previous =
      prior?.metadata.files.map((file) => ({
        ...file,
        text: prior?.bodies.find((body) => body.path === file.path)?.text ?? null,
      })) ?? null
    const changes = instructionChanges(previous, snapshot)
    const changedPaths = new Set(changes.filter((change) => change.status !== 'removed').map((change) => change.path))
    this.checkCancellation(signal)
    const saved = await this.store.save(projectId, snapshot, signal)
    return {
      id: saved.id,
      taskId,
      projectId,
      digest: saved.digest,
      scope: snapshot.scope,
      analyzerVersion: snapshot.version,
      baseline: !previous,
      approved: false,
      findings: analyzeInstruction({
        ...snapshot,
        files: snapshot.files.filter((file) => changedPaths.has(file.path)),
      }),
      changes,
      limits,
    }
  }

  async approve(taskId: string, id: string, signal?: AbortSignal): Promise<void> {
    this.checkCancellation(signal)
    const pending = await this.store.get(id)
    this.checkCancellation(signal)
    if (!pending) throw new Error('Review expired. Open the review again.')
    const current = await this.scan(taskId, signal)
    if (
      pending.metadata.projectId !== current.projectId ||
      pending.metadata.digest !== snapshotDigest(current.snapshot)
    ) {
      throw new Error('Instruction files changed since this review opened. Open a new review.')
    }
    this.checkCancellation(signal)
    await this.store.approve(id, current.projectId)
  }

  /** This runs for every queued turn, immediately before driver send. Hooks have separate semantics. */
  async admit(taskId: string, signal?: AbortSignal): Promise<void> {
    this.checkCancellation(signal)
    const userId = this.core.identity.active()
    // No owner has set these per-Node preferences until the Node has an active binding.
    if (!userId) return
    const settings = await readAgentSessionDefaults(this.core.prefs, userId)
    this.checkCancellation(signal)
    if (!settings.checkInstructionFiles && !settings.reviewChangedInstructions) return
    const task = await this.core.tasks.load(taskId)
    if (!task) throw new Error('Task no longer exists.')
    let result
    try {
      result = await this.scan(taskId, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      this.observe(taskId, task.projectId, 'incomplete')
      throw new InstructionAdmissionError(
        'instruction_scan_incomplete',
        `Instruction scan incomplete: ${error instanceof Error ? error.message : 'unknown error'}. Retry or change the checks in Settings > Security and backup.`,
      )
    }
    this.checkCancellation(signal)
    try {
      if (settings.checkInstructionFiles) {
        for (const file of result.snapshot.files) {
          if (file.text === null) continue
          const found = hiddenCharactersIn(file.text, file.path, 1)
          if (found.length)
            throw new InstructionAdmissionError('instruction_hidden_characters', hiddenCharacterReason(found))
        }
      }
      if (settings.reviewChangedInstructions && result.snapshot.files.length) {
        let approved
        try {
          approved = await this.store.approvedSnapshot(snapshotDigest(result.snapshot))
        } catch {
          throw new InstructionAdmissionError(
            'instruction_review_required',
            'Instruction review required: the saved approval could not be read. Review the instructions again.',
          )
        }
        if (!approved || approved.digest !== snapshotDigest(result.snapshot)) {
          throw new InstructionAdmissionError(
            'instruction_review_required',
            'Instruction review required: approve the instructions for this task before the agent continues.',
          )
        }
      }
      this.observe(taskId, result.projectId, 'passed')
    } catch (error) {
      if (!signal?.aborted) this.observe(taskId, result.projectId, 'blocked')
      throw error
    }
  }

  private checkCancellation(signal?: AbortSignal): void {
    if (signal?.aborted)
      throw new InstructionScanIncomplete(
        'Instruction scan did not finish because the request was cancelled. Retry the review.',
      )
  }
}
