import { access, readFile } from 'node:fs/promises'
import { BridgeError, type CoreServices } from '@acorn/plugin-api/node'
import type { OperationConflict, OperationKind } from '../shared/api'
import { repositoryFor } from './history'
import { canonicalPath, parseRoster } from './worktreeRoster'

type Core = Pick<CoreServices, 'git' | 'projects' | 'tasks'>
export const firstLine = (text: string, fallback = 'Git refused the operation.') =>
  text.trim().split('\n')[0] || fallback

const queue = new Map<string, Promise<void>>()
async function inRepository<T>(repository: string, action: () => Promise<T>): Promise<T> {
  const before = queue.get(repository) ?? Promise.resolve()
  let release!: () => void
  const done = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = before.then(() => done)
  queue.set(repository, tail)
  await before
  try {
    return await action()
  } finally {
    release()
    if (queue.get(repository) === tail) queue.delete(repository)
  }
}

/** Serializes this plugin's writes by Git common directory. Core's checkout admission nests inside it. */
export async function mutateRepository<T>(
  core: Pick<CoreServices, 'git'>,
  repository: string,
  action: () => Promise<T>,
): Promise<T> {
  const common = await core.git.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repository,
    maxOutputBytes: 8192,
  })
  if (common.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(common.stderr))
  return inRepository(await canonicalPath(common.stdout.trim()), action)
}

/** Proves that the admitted checkout is still the task's registered worktree in `repository`. */
export async function targetCheckout(
  core: Core,
  repository: string,
  taskId: string,
  expectedPath: string,
  checkout: string,
) {
  const task = await core.tasks.load(taskId)
  if (!task) throw new BridgeError(404, 'task_missing', 'Target task is unavailable.')
  if (task.branch && !task.worktreePath)
    throw new BridgeError(409, 'checkout_missing', 'Target task checkout has not been created. Open the task first.')
  const targetRepository = await repositoryFor(core, task.projectId)
  const targetProject = await core.projects.byId(task.projectId)
  if ((task.worktreePath ?? targetProject?.path) !== expectedPath)
    throw new BridgeError(409, 'checkout_moved', 'Target checkout moved. Close and reopen this action.')
  const expectedRepository = await core.git.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repository,
    maxOutputBytes: 8192,
  })
  const actualRepository = await core.git.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: checkout,
    maxOutputBytes: 8192,
  })
  if (
    expectedRepository.code !== 0 ||
    actualRepository.code !== 0 ||
    (await canonicalPath(expectedRepository.stdout.trim())) !== (await canonicalPath(actualRepository.stdout.trim()))
  ) {
    throw new BridgeError(409, 'wrong_repository', 'Target task belongs to a different repository.')
  }
  const root = await core.git.git(['rev-parse', '--show-toplevel'], { cwd: checkout, maxOutputBytes: 8192 })
  if (root.code !== 0 || (await canonicalPath(root.stdout.trim())) !== (await canonicalPath(checkout)))
    throw new BridgeError(409, 'checkout_moved', 'Target checkout moved or is unavailable.')
  const registered = await core.git.git(['worktree', 'list', '--porcelain', '-z'], {
    cwd: targetRepository,
    maxOutputBytes: 1 << 20,
  })
  const checkoutPath = await canonicalPath(checkout)
  let ownsCheckout = false
  if (registered.code === 0)
    for (const entry of parseRoster(registered.stdout)) {
      if (!entry.prunable && !entry.locked && (await canonicalPath(entry.path)) === checkoutPath) ownsCheckout = true
    }
  if (!ownsCheckout) {
    throw new BridgeError(409, 'checkout_moved', 'Target checkout is no longer a registered, available worktree.')
  }
}

export async function dirtyStatus(core: Pick<CoreServices, 'git'>, checkout: string): Promise<string> {
  const result = await core.git.git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: checkout,
    maxOutputBytes: 1 << 20,
  })
  if (result.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(result.stderr))
  return result.stdout
}

export type CheckoutOperation = {
  operation: OperationKind | null
  source: string | null
  conflicts: OperationConflict[]
}

/** Reads Git's own markers, so an operation started in a terminal or before a restart looks the same.
 *  Unmerged entries without a marker are what a conflicted `stash apply` leaves behind. */
export async function readOperation(core: Pick<CoreServices, 'git'>, checkout: string): Promise<CheckoutOperation> {
  const unmerged = await core.git.git(['ls-files', '-u', '-z'], { cwd: checkout, maxOutputBytes: 256 << 10 })
  if (unmerged.code !== 0 || unmerged.truncated)
    throw new BridgeError(422, 'git_failed', firstLine(unmerged.stderr, 'Could not read every unresolved path.'))
  const stages = new Map<string, number[]>()
  // Each record is `<mode> <object> <stage>\t<path>`.
  for (const record of unmerged.stdout.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t')
    const stage = Number(record.slice(0, tab).split(' ')[2])
    const path = record.slice(tab + 1)
    stages.set(path, [...(stages.get(path) ?? []), stage])
  }
  const conflicts = [...stages].map(([path, entries]) => ({ path, stages: entries.sort((a, b) => a - b) }))
  const gitPath = async (name: string) => {
    const path = await core.git.git(['rev-parse', '--path-format=absolute', '--git-path', name], {
      cwd: checkout,
      maxOutputBytes: 8192,
    })
    if (path.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(path.stderr))
    return path.stdout.trim()
  }
  const read = async (name: string): Promise<string | null> =>
    readFile(await gitPath(name), 'utf8').then(
      (text) => text,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'EISDIR') return null
        throw new BridgeError(503, 'operation_unavailable', 'Cannot inspect Git operation state.')
      },
    )
  const exists = async (name: string) =>
    access(await gitPath(name)).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw new BridgeError(503, 'operation_unavailable', 'Cannot inspect Git operation state.')
      },
    )
  const firstId = (text: string | null) => text?.trim().split('\n')[0] || null
  for (const directory of ['rebase-merge', 'rebase-apply']) {
    if (await exists(directory))
      return { operation: 'rebase', source: firstId(await read(`${directory}/onto`)), conflicts }
  }
  const merge = await read('MERGE_HEAD')
  if (merge !== null) return { operation: 'merge', source: firstId(merge), conflicts }
  const pick = await read('CHERRY_PICK_HEAD')
  if (pick !== null) return { operation: 'cherry-pick', source: firstId(pick), conflicts }
  const revert = await read('REVERT_HEAD')
  if (revert !== null) return { operation: 'revert', source: firstId(revert), conflicts }
  // A multi-commit pick or revert that stopped after its conflicted commit was committed keeps only
  // the sequencer. Its next instruction says which command owns it.
  const todo = await read('sequencer/todo')
  if (todo !== null) {
    const [verb, id] = todo.trim().split(/\s+/)
    return { operation: verb === 'revert' || verb === 'r' ? 'revert' : 'cherry-pick', source: id ?? null, conflicts }
  }
  return { operation: null, source: null, conflicts }
}
