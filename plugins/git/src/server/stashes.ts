import { createHash } from 'node:crypto'
import { BridgeError, type CompiledCoreServices, type CoreServices } from '@acorn/plugin-api/node'
import type { Stash, StashApply, StashCreate, StashDrop, StashResult, StashRoster, StashSelection } from '../shared/api'
import { repositoryFor } from './history'
import { dirtyStatus, firstLine, mutateRepository, readOperation, targetCheckout } from './checkout'

type Core = Pick<CoreServices, 'git' | 'projects' | 'tasks'> & Pick<CompiledCoreServices, 'checkoutAdmission'>
type ReadCore = Pick<CoreServices, 'git' | 'projects'>
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export async function stashRoster(core: ReadCore, projectId: string, signal?: AbortSignal): Promise<StashRoster> {
  const repository = await repositoryFor(core, projectId, signal)
  const listed = await core.git.git(['stash', 'list', '-z', '--format=%gd%x00%H%x00%gs%x00%ct'],
    { cwd: repository, maxOutputBytes: 512 << 10, signal })
  signal?.throwIfAborted()
  if (listed.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(listed.stderr))
  const rows = listed.stdout.split('\0').filter(Boolean)
  const entries: Array<{ selector: string; objectId: string; message: string; at: number }> = []
  for (let i = 0; i + 3 < rows.length; i += 4) {
    const selector = rows[i]!.trim(), objectId = rows[i + 1]!.trim()
    if (!/^stash@\{\d+\}$/.test(selector) || !/^[0-9a-f]{40,64}$/.test(objectId)) throw new BridgeError(422, 'git_format', 'Invalid stash roster.')
    entries.push({ selector, objectId, message: rows[i + 2]!, at: Number(rows[i + 3]) * 1000 })
  }
  // Detail reads are sequential. Refuse an unusually long reflog instead of spawning without a bound.
  if (entries.length > 100) throw new BridgeError(422, 'stash_roster_limit', 'Stash browsing supports at most 100 entries.')
  const fingerprint = sha(entries.map(({ selector, objectId }) => [selector, objectId]))
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.objectId, (counts.get(entry.objectId) ?? 0) + 1)
  const stashes: Stash[] = []
  for (const entry of entries) {
    signal?.throwIfAborted()
    const parents = await core.git.git(['rev-list', '--parents', '-n', '1', entry.objectId], { cwd: repository, maxOutputBytes: 512, signal })
    signal?.throwIfAborted()
    if (parents.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(parents.stderr))
    const [, base, , untrackedParent] = parents.stdout.trim().split(' ')
    if (!base) throw new BridgeError(422, 'git_format', 'Stash has no base commit.')
    let untrackedFiles: string[] = []
    if (untrackedParent) {
      const paths = await core.git.git(['ls-tree', '-r', '--name-only', '-z', untrackedParent], { cwd: repository, maxOutputBytes: 256 << 10, signal })
      signal?.throwIfAborted()
      if (paths.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(paths.stderr))
      untrackedFiles = paths.stdout.split('\0').filter(Boolean)
    }
    const originBranch = /^(?:WIP on |On )([^:]+):/.exec(entry.message)?.[1] ?? null
    stashes.push({ id: counts.get(entry.objectId)! > 1 ? `${entry.objectId}-${entry.selector}-${fingerprint}` : entry.objectId,
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

async function writableCheckout(core: Core, repository: string, taskId: string, expectedPath: string, checkout: string) {
  await targetCheckout(core, repository, taskId, expectedPath, checkout)
  const state = await readOperation(core, checkout)
  if (state.conflicts.length) throw new BridgeError(409, 'conflicted_checkout', 'Resolve checkout conflicts in Changes before writing a stash.')
  if (state.operation) throw new BridgeError(409, 'operation_active', 'Finish the Git operation before creating a stash.')
}

async function conflicts(core: Core, checkout: string): Promise<string[]> {
  const result = await core.git.git(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: checkout, maxOutputBytes: 256 << 10 })
  if (result.code !== 0) throw new BridgeError(503, 'conflicts_unavailable', firstLine(result.stderr))
  return result.stdout.split('\0').filter(Boolean)
}
const result = (ok: boolean, error: string | null, conflicts: string[] | null, roster: StashRoster | null, changed: boolean): StashResult => ({ ok, error, conflicts, roster, changed })
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
async function command(core: Core, args: string[], cwd: string): Promise<{ ok: boolean; error: string | null }> {
  try {
    const response = await core.git.git(args, { cwd, maxOutputBytes: 256 << 10 })
    return { ok: response.code === 0, error: response.code === 0 ? null : firstLine(response.stderr || response.stdout) }
  } catch (error) { return { ok: false, error: `Git command may have changed repository data: ${errorText(error)}` } }
}
async function observed(core: Core, projectId: string, checkout: string | null, outcome: { ok: boolean; error: string | null }): Promise<StashResult> {
  const problems: string[] = []
  let files: string[] | null = null
  let roster: StashRoster | null = null
  if (checkout) {
    try { files = await conflicts(core, checkout) }
    catch (error) { problems.push(`Conflict state unavailable: ${errorText(error)}`) }
  }
  try { roster = await stashRoster(core, projectId) }
  catch (error) { problems.push(`Stash roster unavailable: ${errorText(error)}`) }
  return result(outcome.ok && problems.length === 0, [outcome.error, ...problems].filter(Boolean).join(' ') || null, files, roster, true)
}

export async function createStash(core: Core, projectId: string, input: StashCreate): Promise<StashResult> {
  const repository = await repositoryFor(core, projectId)
  return mutateRepository(core, repository, () => core.checkoutAdmission.write(input.taskId, async (checkout) => {
    await writableCheckout(core, repository, input.taskId, input.expectedPath, checkout)
    const before = await dirtyStatus(core, checkout)
    const relevant = before.split('\0').filter(Boolean).some((entry) => input.includeUntracked || !entry.startsWith('??'))
    if (!relevant) return result(false, 'There are no changes to stash with these options.', [], await stashRoster(core, projectId), false)
    const args = ['stash', 'push', '-m', input.message, ...(input.includeUntracked ? ['--include-untracked'] : []), ...(input.keepIndex ? ['--keep-index'] : [])]
    return observed(core, projectId, checkout, await command(core, args, checkout))
  }))
}

export async function applyStash(core: Core, projectId: string, input: StashApply, pop: boolean): Promise<StashResult> {
  const repository = await repositoryFor(core, projectId)
  return mutateRepository(core, repository, () => core.checkoutAdmission.write(input.taskId, async (checkout) => {
    await writableCheckout(core, repository, input.taskId, input.expectedPath, checkout)
    const roster = await stashRoster(core, projectId)
    const stash = selected(roster, input.selection)
    if (await dirtyStatus(core, checkout)) return result(false, 'Target checkout has changes. Commit or stash them in Changes first.', [], roster, false)
    const applied = await observed(core, projectId, checkout,
      await command(core, ['stash', 'apply', ...(input.restoreIndex ? ['--index'] : []), stash.objectId], checkout))
    if (!applied.ok || !pop) return applied
    try { selected(applied.roster!, input.selection) }
    catch { return { ...applied, ok: false, error: 'Stash applied, but the roster moved before removal. Refresh; the stash was retained.' } }
    const dropped = await command(core, ['stash', 'drop', stash.selector], repository)
    const afterDrop = await observed(core, projectId, checkout, dropped)
    return dropped.ok ? afterDrop : { ...afterDrop, error: `Stash applied but removal failed: ${afterDrop.error}` }
  }))
}

export async function dropStash(core: Core, projectId: string, input: StashDrop): Promise<StashResult> {
  const repository = await repositoryFor(core, projectId)
  return mutateRepository(core, repository, async () => {
    const roster = await stashRoster(core, projectId)
    const stash = selected(roster, input.selection)
    return observed(core, projectId, null, await command(core, ['stash', 'drop', stash.selector], repository))
  })
}
