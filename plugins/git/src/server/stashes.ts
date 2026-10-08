import { createHash } from 'node:crypto'
import { access } from 'node:fs/promises'
import { BridgeError, type CoreServices } from '@acorn/plugin-api/node'
import type { Stash, StashApply, StashCreate, StashDrop, StashResult, StashRoster, StashSelection } from '../shared/api'
import { repositoryFor } from './history'
import { canonicalPath } from './worktreeRoster'

type Core = Pick<CoreServices, 'git' | 'projects' | 'tasks' | 'checkoutAdmission'>
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const firstLine = (text: string) => text.trim().split('\n')[0] || 'Git refused the stash operation.'
const queue = new Map<string, Promise<void>>()
async function inRepository<T>(repository: string, action: () => Promise<T>): Promise<T> {
  const before = queue.get(repository) ?? Promise.resolve()
  let release!: () => void
  const done = new Promise<void>((resolve) => { release = resolve })
  const tail = before.then(() => done)
  queue.set(repository, tail)
  await before
  try { return await action() }
  finally { release(); if (queue.get(repository) === tail) queue.delete(repository) }
}

async function mutateRepository<T>(core: Core, repository: string, action: () => Promise<T>): Promise<T> {
  const common = await core.git.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repository, maxOutputBytes: 8192 })
  if (common.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(common.stderr))
  return inRepository(await canonicalPath(common.stdout.trim()), action)
}

export async function stashRoster(core: Core, projectId: string): Promise<StashRoster> {
  const repository = await repositoryFor(core, projectId)
  const listed = await core.git.git(['stash', 'list', '-z', '--format=%gd%x00%H%x00%gs%x00%ct'],
    { cwd: repository, maxOutputBytes: 512 << 10 })
  if (listed.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(listed.stderr))
  const rows = listed.stdout.split('\0').filter(Boolean)
  const entries: Array<{ selector: string; objectId: string; message: string; at: number }> = []
  for (let i = 0; i + 3 < rows.length; i += 4) {
    const selector = rows[i]!.trim(), objectId = rows[i + 1]!.trim()
    if (!/^stash@\{\d+\}$/.test(selector) || !/^[0-9a-f]{40,64}$/.test(objectId)) throw new BridgeError(422, 'git_format', 'Invalid stash roster.')
    entries.push({ selector, objectId, message: rows[i + 2]!, at: Number(rows[i + 3]) * 1000 })
  }
  const fingerprint = sha(entries.map(({ selector, objectId }) => [selector, objectId]))
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.objectId, (counts.get(entry.objectId) ?? 0) + 1)
  const stashes: Stash[] = []
  for (const entry of entries) {
    const parents = await core.git.git(['rev-list', '--parents', '-n', '1', entry.objectId], { cwd: repository, maxOutputBytes: 256 })
    if (parents.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(parents.stderr))
    const [, base, , untrackedParent] = parents.stdout.trim().split(' ')
    if (!base) throw new BridgeError(422, 'git_format', 'Stash has no base commit.')
    let untrackedFiles: string[] = []
    if (untrackedParent) {
      const paths = await core.git.git(['ls-tree', '-r', '--name-only', '-z', untrackedParent], { cwd: repository, maxOutputBytes: 256 << 10 })
      if (paths.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(paths.stderr))
      untrackedFiles = paths.stdout.split('\0').filter(Boolean)
    }
    const originBranch = /^(?:WIP on |On )([^:]+):/.exec(entry.message)?.[1] ?? null
    stashes.push({ id: counts.get(entry.objectId)! > 1 ? `${entry.objectId}-${entry.selector}` : entry.objectId,
      objectId: entry.objectId, selector: entry.selector, fingerprint, message: entry.message,
      originBranch, createdAt: entry.at, base, untrackedParent: untrackedParent ?? null, untrackedFiles })
  }
  return { projectId, repository, stashes, fingerprint }
}

function selected(roster: StashRoster, selection: StashSelection): Stash {
  const stash = roster.stashes.find((item) => item.selector === selection.selector)
  if (!stash || stash.objectId !== selection.objectId || roster.fingerprint !== selection.fingerprint) {
    throw new BridgeError(409, 'stale_stash', 'Stash roster changed. Refresh the selection and try again.')
  }
  return stash
}

async function targetCheckout(core: Core, repository: string, taskId: string, expectedPath: string, checkout: string) {
  const task = await core.tasks.load(taskId)
  if (!task) throw new BridgeError(404, 'task_missing', 'Target task is unavailable.')
  if (task.branch && !task.worktreePath) throw new BridgeError(409, 'checkout_missing', 'Target task checkout has not been created. Open the task first.')
  const targetRepository = await repositoryFor(core, task.projectId)
  const targetProject = await core.projects.byId(task.projectId)
  if ((task.worktreePath ?? targetProject?.path) !== expectedPath) throw new BridgeError(409, 'checkout_moved', 'Target checkout moved. Close and reopen this action.')
  const expectedRepository = await core.git.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repository, maxOutputBytes: 8192 })
  const actualRepository = await core.git.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: targetRepository, maxOutputBytes: 8192 })
  if (expectedRepository.code !== 0 || actualRepository.code !== 0 ||
    await canonicalPath(expectedRepository.stdout.trim()) !== await canonicalPath(actualRepository.stdout.trim())) {
    throw new BridgeError(409, 'wrong_repository', 'Target task belongs to a different repository.')
  }
  const root = await core.git.git(['rev-parse', '--show-toplevel'], { cwd: checkout, maxOutputBytes: 8192 })
  if (root.code !== 0 || await canonicalPath(root.stdout.trim()) !== await canonicalPath(checkout)) throw new BridgeError(409, 'checkout_moved', 'Target checkout moved or is unavailable.')
  const operation = await core.git.git(['ls-files', '-u', '-z'], { cwd: checkout, maxOutputBytes: 256 << 10 })
  if (operation.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(operation.stderr))
  if (operation.stdout) throw new BridgeError(409, 'conflicted_checkout', 'Resolve checkout conflicts in Changes before writing a stash.')
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply']) {
    const path = await core.git.git(['rev-parse', '--path-format=absolute', '--git-path', marker], { cwd: checkout, maxOutputBytes: 8192 })
    if (path.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(path.stderr))
    if (await access(path.stdout.trim()).then(() => true, () => false)) throw new BridgeError(409, 'operation_active', 'Finish the Git operation before creating a stash.')
  }
}

async function status(core: Core, checkout: string) {
  const result = await core.git.git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: checkout, maxOutputBytes: 1 << 20 })
  if (result.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(result.stderr))
  return result.stdout
}
async function conflicts(core: Core, checkout: string): Promise<string[]> {
  const result = await core.git.git(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: checkout, maxOutputBytes: 256 << 10 })
  return result.code === 0 ? result.stdout.split('\0').filter(Boolean) : []
}
const result = (ok: boolean, error: string | null, conflicts: string[], roster: StashRoster | null, changed: boolean): StashResult => ({ ok, error, conflicts, roster, changed })

export async function createStash(core: Core, projectId: string, input: StashCreate): Promise<StashResult> {
  const repository = await repositoryFor(core, projectId)
  return mutateRepository(core, repository, () => core.checkoutAdmission.write(input.taskId, async (checkout) => {
    await targetCheckout(core, repository, input.taskId, input.expectedPath, checkout)
    const before = await status(core, checkout)
    const relevant = before.split('\0').filter(Boolean).some((entry) => input.includeUntracked || !entry.startsWith('??'))
    if (!relevant) return result(false, 'There are no changes to stash with these options.', [], await stashRoster(core, projectId), false)
    const args = ['stash', 'push', '-m', input.message, ...(input.includeUntracked ? ['--include-untracked'] : []), ...(input.keepIndex ? ['--keep-index'] : [])]
    const command = await core.git.git(args, { cwd: checkout, maxOutputBytes: 256 << 10 })
    const after = await stashRoster(core, projectId)
    return result(command.code === 0, command.code === 0 ? null : firstLine(command.stderr), await conflicts(core, checkout), after, true)
  }))
}

export async function applyStash(core: Core, projectId: string, input: StashApply, pop: boolean): Promise<StashResult> {
  const repository = await repositoryFor(core, projectId)
  return mutateRepository(core, repository, () => core.checkoutAdmission.write(input.taskId, async (checkout) => {
    await targetCheckout(core, repository, input.taskId, input.expectedPath, checkout)
    const roster = await stashRoster(core, projectId)
    const stash = selected(roster, input.selection)
    if (await status(core, checkout)) return result(false, 'Target checkout has changes. Commit or stash them in Changes first.', [], roster, false)
    const applied = await core.git.git(['stash', 'apply', ...(input.restoreIndex ? ['--index'] : []), stash.objectId], { cwd: checkout, maxOutputBytes: 256 << 10 })
    const files = await conflicts(core, checkout)
    if (applied.code !== 0) return result(false, firstLine(applied.stderr || applied.stdout), files, await stashRoster(core, projectId), true)
    if (!pop) return result(true, null, [], await stashRoster(core, projectId), true)
    const afterApply = await stashRoster(core, projectId)
    try { selected(afterApply, input.selection) }
    catch { return result(false, 'Stash applied, but the roster moved before removal. Refresh; the stash was retained.', [], afterApply, true) }
    const dropped = await core.git.git(['stash', 'drop', stash.selector], { cwd: repository, maxOutputBytes: 256 << 10 })
    return result(dropped.code === 0, dropped.code === 0 ? null : `Stash applied but removal failed: ${firstLine(dropped.stderr)}`, [], await stashRoster(core, projectId), true)
  }))
}

export async function dropStash(core: Core, projectId: string, input: StashDrop): Promise<StashResult> {
  const repository = await repositoryFor(core, projectId)
  return mutateRepository(core, repository, async () => {
    const roster = await stashRoster(core, projectId)
    const stash = selected(roster, input.selection)
    const dropped = await core.git.git(['stash', 'drop', stash.selector], { cwd: repository, maxOutputBytes: 256 << 10 })
    return result(dropped.code === 0, dropped.code === 0 ? null : firstLine(dropped.stderr), [], await stashRoster(core, projectId), dropped.code === 0)
  })
}
