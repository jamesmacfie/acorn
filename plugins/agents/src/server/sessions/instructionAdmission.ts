import { deliverableSkills, type CoreServices } from '@acorn/plugin-api/node'
import { readAgentSessionDefaults } from '../sessionDefaultsStore'
import { hiddenCharacterReason, hiddenCharactersIn } from './instructionCheck'
import { scanInstructions, type InstructionSnapshot } from './instructionSnapshot'
import { InstructionReviewStore, snapshotDigest } from './instructionReviewStore'
import { analyzeInstruction, instructionChanges } from './instructionAnalysis'

export class InstructionAdmission {
  constructor(private readonly core: CoreServices, private readonly dataDir: string, readonly store: InstructionReviewStore) {}

  async scan(taskId: string, signal?: AbortSignal): Promise<{ projectId: string; snapshot: InstructionSnapshot }> {
    const task = await this.core.tasks.load(taskId)
    if (!task) throw new Error('Task no longer exists.')
    const root = await this.core.tasks.requireRoot(taskId)
    const snapshot = await scanInstructions(root, await deliverableSkills(this.dataDir), signal)
    return { projectId: task.projectId, snapshot }
  }

  async review(taskId: string, signal?: AbortSignal) {
    const { projectId, snapshot } = await this.scan(taskId, signal)
    let prior = null
    try {
      const approved = await this.store.approved(projectId)
      prior = approved ? await this.store.get(approved.id) : null
    } catch { /* Damaged or unavailable ciphertext means a fresh baseline review. */ }
    const previous = prior?.metadata.files.map((file) => ({
      ...file, text: prior?.bodies.find((body) => body.path === file.path)?.text ?? null,
    })) ?? null
    const changes = instructionChanges(previous, snapshot)
    const changedPaths = new Set(changes.filter((change) => change.status !== 'removed').map((change) => change.path))
    const saved = await this.store.save(projectId, snapshot)
    return {
      id: saved.id, taskId, projectId, digest: saved.digest, scope: snapshot.scope,
      analyzerVersion: snapshot.version, baseline: !previous,
      findings: analyzeInstruction({ ...snapshot, files: snapshot.files.filter((file) => changedPaths.has(file.path)) }), changes,
      limits: 'A pre-turn scan cannot stop changes during a turn. Global instructions outside this scope are not reviewed. Host processes with owner access can change on-disk state.',
    }
  }

  async approve(taskId: string, id: string, signal?: AbortSignal): Promise<void> {
    const pending = await this.store.get(id)
    if (!pending) throw new Error('Review expired. Open the review again.')
    const current = await this.scan(taskId, signal)
    if (pending.metadata.projectId !== current.projectId || pending.metadata.digest !== snapshotDigest(current.snapshot)) {
      throw new Error('Instruction files changed since this review opened. Open a new review.')
    }
    await this.store.approve(id, current.projectId)
  }

  /** This runs for every queued turn, immediately before driver send. Hooks have separate semantics. */
  async admit(taskId: string, signal?: AbortSignal): Promise<void> {
    const userId = this.core.identity.active()
    // No owner has set these per-Node preferences until the Node has an active binding.
    if (!userId) return
    const settings = await readAgentSessionDefaults(this.core.prefs, userId)
    if (!settings.checkInstructionFiles && !settings.reviewChangedInstructions) return
    let result
    try { result = await this.scan(taskId, signal) }
    catch (error) {
      if (signal?.aborted) throw error
      throw new Error(`Instruction scan incomplete: ${error instanceof Error ? error.message : 'unknown error'}. Retry or change the checks in Settings > Security and backup.`)
    }
    if (settings.checkInstructionFiles) {
      const found = result.snapshot.files.flatMap((file) => file.text === null ? [] : hiddenCharactersIn(file.text, file.path))
      if (found.length) throw new Error(hiddenCharacterReason(found))
    }
    if (settings.reviewChangedInstructions) {
      let approved
      try { approved = await this.store.approved(result.projectId, snapshotDigest(result.snapshot)) }
      catch { throw new Error('Instruction review required: the encrypted approval cannot be opened. Open Security and backup to review again.') }
      if (!approved || approved.digest !== snapshotDigest(result.snapshot)) {
        throw new Error('Instruction review required: discovered instructions changed or have no approved baseline. Open Security and backup to review and approve them.')
      }
    }
  }
}
