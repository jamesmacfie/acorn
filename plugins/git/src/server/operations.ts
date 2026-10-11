import { BridgeError, type CompiledCoreServices, type CoreServices } from '@acorn/plugin-api/node'
import type { OperationControl, OperationControlAction, OperationResult, OperationStart, OperationState } from '../shared/api'
import { repositoryFor } from './history'
import { dirtyStatus, mutateRepository, readOperation, targetCheckout } from './checkout'

type Core = Pick<CoreServices, 'git' | 'projects' | 'tasks'> & Pick<CompiledCoreServices, 'checkoutAdmission'>
// Git treats the editor `:` as "keep the prepared message", so no command here waits on a prompt.
const NONINTERACTIVE = { GIT_EDITOR: ':', GIT_SEQUENCE_EDITOR: ':', GIT_MERGE_AUTOEDIT: 'no' }
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

export async function recordedCheckout(core: Core, taskId: string) {
  const task = await core.tasks.load(taskId)
  if (!task) throw new BridgeError(404, 'task_missing', 'Target task is unavailable.')
  if (task.branch && !task.worktreePath) throw new BridgeError(409, 'checkout_missing', 'Target task checkout has not been created. Open the task first.')
  const checkout = task.worktreePath ?? (await core.projects.byId(task.projectId))?.path
  if (!checkout) throw new BridgeError(409, 'checkout_unmapped', 'Task checkout is not mapped on this Node.')
  return { task, checkout }
}

export async function observe(core: Core, taskId: string, checkout: string): Promise<OperationState> {
  const [operation, head, branch, busy] = await Promise.all([
    readOperation(core, checkout),
    core.git.git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: checkout, maxOutputBytes: 512 }),
    core.git.git(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: checkout, maxOutputBytes: 1024 }),
    core.checkoutAdmission.activity(taskId).then((rows) => rows.map((row) => `${row.taskId} ${row.description}`),
      (error) => [`Activity unavailable: ${errorText(error)}`]),
  ])
  return { taskId, checkout, ...operation, busy,
    head: head.code === 0 ? head.stdout.trim() : null, branch: branch.code === 0 ? branch.stdout.trim() : null }
}

export async function operationState(core: Core, taskId: string): Promise<OperationState> {
  const { checkout } = await recordedCheckout(core, taskId)
  return observe(core, taskId, checkout)
}

/** Runs one admitted command and reports what Git left behind, whether or not the command succeeded. */
async function admitted(core: Core, taskId: string, expectedPath: string, prepare: (checkout: string) => Promise<string[]>): Promise<OperationResult> {
  const { task } = await recordedCheckout(core, taskId)
  const repository = await repositoryFor(core, task.projectId)
  return mutateRepository(core, repository, () => core.checkoutAdmission.write(taskId, async (checkout) => {
    await targetCheckout(core, repository, taskId, expectedPath, checkout)
    const args = await prepare(checkout)
    let error: string | null
    try {
      const result = await core.git.git(args, { cwd: checkout, env: NONINTERACTIVE, timeoutMs: 120_000, maxOutputBytes: 256 << 10 })
      // Keep Git's whole explanation: a conflict or hook refusal is several lines.
      error = result.code === 0 ? null : (result.stderr || result.stdout).trim().slice(0, 4000) || 'Git refused the operation.'
    } catch (cause) { error = `Git command may have changed the checkout: ${errorText(cause)}` }
    try {
      const state = await observe(core, taskId, checkout)
      const stopped = !error && (state.operation || state.conflicts.length) ? 'Git stopped before finishing. Resolve any conflicts, then continue, skip, or abort.' : null
      return { ok: !error && !stopped, error: error ?? stopped, state }
    } catch (cause) {
      return { ok: false, error: [error, `Checkout state unavailable: ${errorText(cause)}`].filter(Boolean).join(' '), state: null }
    }
  }))
}

export function startOperation(core: Core, taskId: string, input: OperationStart): Promise<OperationResult> {
  return admitted(core, taskId, input.expectedPath, async (checkout) => {
    const current = await readOperation(core, checkout)
    if (current.operation) throw new BridgeError(409, 'operation_active', `Finish or abort the ${current.operation} in progress first.`)
    if (current.conflicts.length) throw new BridgeError(409, 'conflicted_checkout', 'Resolve the conflicted files in this checkout first.')
    if (await dirtyStatus(core, checkout)) throw new BridgeError(409, 'dirty_checkout', 'Target checkout has changes. Commit or stash them in Changes first.')
    const head = await core.git.git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: checkout, maxOutputBytes: 512 })
    if (head.code !== 0 || head.stdout.trim() !== input.expectedHead) throw new BridgeError(409, 'stale_head', 'Target checkout moved to another commit. Reopen this action.')
    const parents = await core.git.git(['rev-list', '--parents', '-n', '1', `${input.source}^{commit}`], { cwd: checkout, maxOutputBytes: 1024 })
    if (parents.code !== 0) throw new BridgeError(422, 'source_missing', 'The selected commit is unavailable in this repository.')
    // A merge commit needs a chosen mainline parent. Guessing one would apply the wrong side.
    if ((input.operation === 'cherry-pick' || input.operation === 'revert') && parents.stdout.trim().split(' ').length > 2) {
      throw new BridgeError(422, 'mainline_unsupported', `Acorn cannot ${input.operation} a merge commit. Use a terminal and choose its mainline parent.`)
    }
    switch (input.operation) {
      case 'merge': return ['merge', '--no-edit', input.source]
      // Other branches stay where they are, including ones other tasks own.
      case 'rebase': return ['-c', 'rebase.updateRefs=false', 'rebase', '--no-autostash', input.source]
      case 'cherry-pick': return ['cherry-pick', input.source]
      case 'revert': return ['revert', '--no-edit', input.source]
    }
  })
}

export function controlOperation(core: Core, taskId: string, action: OperationControlAction, input: OperationControl): Promise<OperationResult> {
  return admitted(core, taskId, input.expectedPath, async (checkout) => {
    const current = await readOperation(core, checkout)
    if (current.operation !== input.operation) throw new BridgeError(409, 'stale_operation', 'The Git operation changed. Refresh and try again.')
    if (action === 'skip' && input.operation === 'merge') throw new BridgeError(422, 'skip_unsupported', 'A merge cannot skip. Continue or abort it.')
    if (action === 'continue' && current.conflicts.length) {
      throw new BridgeError(409, 'unresolved_conflicts', 'Resolve and stage every conflicted file in Changes before continuing.')
    }
    return [input.operation, `--${action}`]
  })
}
