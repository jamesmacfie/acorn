import { resolve } from 'node:path'
import { BridgeError, type CompiledCoreServices, type CoreServices } from '@acorn/plugin-api/node'
import type { GitRef, RefChange, RefChangeResult, RefRoster, WorktreeOwner } from '../shared/api'
import { repositoryFor } from './history'
import { canonicalPath, parseRoster } from './worktreeRoster'

type Core = Pick<CoreServices, 'git' | 'projects' | 'tasks'>
const ID = /^[0-9a-f]{40,64}$/
const first = (stderr: string, fallback: string) => stderr.trim().split('\n')[0] || fallback

async function commonDirectory(core: Core, path: string): Promise<string | null> {
  const result = await core.git.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: path, maxOutputBytes: 8192 })
  return result.code === 0 && !result.truncated && !!result.stdout.trim() ? canonicalPath(resolve(path, result.stdout.trim())) : null
}

async function branchOwners(core: Core, repository: string): Promise<Map<string, WorktreeOwner[]>> {
  const identity = await commonDirectory(core, repository)
  const owners = new Map<string, WorktreeOwner[]>()
  if (!identity) throw new BridgeError(409, 'repository_unavailable', 'Could not verify repository identity.')
  for (const task of await core.tasks.branchClaims()) {
    if (!task.branch) continue
    const project = await core.projects.byId(task.projectId)
    if (!project?.path) throw new BridgeError(409, 'ownership_unavailable', 'Cannot verify task branch ownership. Refresh and try again.')
    const path = task.worktreePath ?? project?.path
    const mapped = path ? await commonDirectory(core, path) : null
    const projectIdentity = await commonDirectory(core, project.path)
    if (!projectIdentity || (!mapped && task.worktreePath)) throw new BridgeError(409, 'ownership_unavailable', 'Cannot verify task branch ownership. Refresh and try again.')
    if ((mapped ?? projectIdentity) !== identity && projectIdentity !== identity) continue
    owners.set(task.branch, [...owners.get(task.branch) ?? [], { id: task.id, title: task.title, projectId: task.projectId }])
  }
  return owners
}

export async function refRoster(core: Core, projectId: string): Promise<RefRoster> {
  const repository = await repositoryFor(core, projectId)
  const [listed, worktrees, owners] = await Promise.all([
    core.git.git(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00%(upstream)', 'refs/heads', 'refs/remotes', 'refs/tags'], { cwd: repository, maxOutputBytes: 256 * 1024 }),
    core.git.git(['worktree', 'list', '--porcelain', '-z'], { cwd: repository, maxOutputBytes: 1 << 20 }),
    branchOwners(core, repository),
  ])
  if (listed.code !== 0 || worktrees.code !== 0 || listed.truncated || worktrees.truncated || !worktrees.stdout.endsWith('\0\0')) throw new BridgeError(422, 'git_failed', first(listed.stderr || worktrees.stderr, 'Could not inspect complete refs and worktrees.'))
  const checkedOut = new Set(parseRoster(worktrees.stdout).map((entry) => entry.branch).filter((name): name is string => !!name))
  const refs: GitRef[] = []
  for (const line of listed.stdout.trimEnd().split('\n')) {
    if (!line) continue
    const [full, objectId, objectType, peeled, peeledType, upstream] = line.split('\0')
    if (!full || !objectId || !ID.test(objectId)) throw new BridgeError(422, 'git_failed', 'Git returned an incomplete ref roster.')
    const kind = full.startsWith('refs/heads/') ? 'local' : full.startsWith('refs/remotes/') ? 'remote' : 'tag'
    const name = full.slice(kind === 'local' ? 11 : kind === 'remote' ? 13 : 10)
    refs.push({ name, kind, objectId, commitId: objectType === 'commit' ? objectId : peeledType === 'commit' && ID.test(peeled ?? '') ? peeled : null,
      upstream: kind === 'local' ? upstream || null : null, checkedOut: kind === 'local' && checkedOut.has(name),
      reservedBy: kind === 'local' ? owners.get(name) ?? [] : [] })
  }
  return { repository, refs }
}

async function validName(core: Core, repository: string, name: string, kind: 'branch' | 'tag'): Promise<boolean> {
  if (!name || name.startsWith('-') || name.includes('\0') || name.length > 240) return false
  const full = kind === 'branch' ? `refs/heads/${name}` : `refs/tags/${name}`
  return (await core.git.git(['check-ref-format', full], { cwd: repository, maxOutputBytes: 1024 })).code === 0
}

async function commitExists(core: Core, repository: string, id: string): Promise<boolean> {
  if (!ID.test(id)) return false
  const type = await core.git.git(['cat-file', '-t', id], { cwd: repository, maxOutputBytes: 128 })
  return type.code === 0 && type.stdout.trim() === 'commit'
}

export async function changeRef(core: Core & Pick<CompiledCoreServices, 'repositoryMetadata'>, projectId: string, change: RefChange, changed: () => void = () => {}): Promise<RefChangeResult> {
  return core.repositoryMetadata.write(projectId, async (observedRepository, observedCommon) => {
    let roster = await refRoster(core, projectId)
    const refuse = (reason: string): RefChangeResult => ({ ok: false, reason, roster, postState: 'fresh', command: null })
    const moved = (): RefChangeResult => ({ ok: false, reason: 'Project repository changed. Reopen the action.',
      roster, postState: 'unavailable', command: null })
    const repository = roster.repository
    if (repository !== observedRepository || await commonDirectory(core, repository) !== observedCommon) return moved()
    const kind = change.action.endsWith('tag') ? 'tag' : 'branch'
    if (!await validName(core, repository, change.name, kind)) return refuse(`Invalid ${kind} name.`)
    if (change.action === 'rename-branch' && !await validName(core, repository, change.nextName, 'branch')) return refuse('Invalid new branch name.')
    const current = roster.refs.find((ref) => ref.kind === (kind === 'tag' ? 'tag' : 'local') && ref.name === change.name)
    if ('startId' in change) {
      if (current) return refuse('This ref already exists. Refresh before creating it.')
      if (!await commitExists(core, repository, change.startId)) return refuse('The selected starting commit is unavailable.')
    } else if (!current || current.objectId !== change.expectedId) return refuse('This ref changed. Refresh and try again.')
    if (kind === 'branch' && !('startId' in change) && current && (current.checkedOut || current.reservedBy.length)) {
      return refuse(current.checkedOut ? 'This branch is checked out in a worktree.' : `This branch belongs to ${current.reservedBy.map((owner) => owner.title).join(', ')}.`)
    }
    let args: string[]
    switch (change.action) {
      case 'create-branch': args = ['branch', '--', change.name, change.startId]; break
      case 'rename-branch': args = ['branch', '-m', '--', change.name, change.nextName]; break
      case 'delete-branch': args = ['branch', '-d', '--', change.name]; break
      case 'set-upstream': {
        if (change.upstream && !roster.refs.some((ref) => ref.kind === 'remote' && `refs/remotes/${ref.name}` === change.upstream)) return refuse('Choose an existing remote branch as upstream.')
        args = change.upstream ? ['branch', '--set-upstream-to', change.upstream, '--', change.name] : ['branch', '--unset-upstream', '--', change.name]
        break
      }
      case 'create-tag': args = change.message === null ? ['tag', '--', change.name, change.startId] : ['tag', '-a', '-m', change.message, '--', change.name, change.startId]; break
      case 'delete-tag': args = ['tag', '-d', '--', change.name]; break
    }
    // The second observation narrows the window between the menu selection and the Git write.
    const latest = await refRoster(core, projectId)
    if (latest.repository !== repository || await commonDirectory(core, repository) !== observedCommon) return moved()
    roster = latest
    const fresh = roster.refs.find((ref) => ref.kind === (kind === 'tag' ? 'tag' : 'local') && ref.name === change.name)
    if ('startId' in change ? !!fresh : !fresh || fresh.objectId !== change.expectedId || fresh.checkedOut || fresh.reservedBy.length) return refuse('Ref or task ownership changed. Refresh and try again.')

    let command: RefChangeResult['command']
    try {
      const result = await core.git.git(args, { cwd: repository, maxOutputBytes: 8192, timeoutMs: 30_000 })
      command = { code: result.code, error: result.code === 0 ? null : first(result.stderr, 'Git refused the ref change.') }
    } catch (error) {
      command = { code: null, error: error instanceof Error ? error.message : String(error) }
    } finally {
      changed()
    }
    try {
      const currentRoster = await refRoster(core, projectId)
      if (currentRoster.repository !== repository || await commonDirectory(core, repository) !== observedCommon) throw new Error('Project repository changed during readback.')
      return { ok: command.code === 0, reason: command.error, roster: currentRoster, postState: 'fresh', command }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { ok: command.code === 0, reason: `${command.error ? `${command.error} ` : 'Git command completed. '}Post-state unavailable: ${detail}`,
        roster, postState: 'unavailable', command }
    }
  })
}
