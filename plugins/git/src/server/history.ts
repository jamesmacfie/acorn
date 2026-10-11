import { createHash } from 'node:crypto'
import { BridgeError, type CoreServices } from '@acorn/plugin-api/node'
import type { Commit, HistoryFilter, HistoryPage } from '../shared/api'
import { canonicalPath } from './worktreeRoster'

type Core = Pick<CoreServices, 'git' | 'projects'>
const ID = /^[0-9a-f]{40,64}$/
const PAGE = 100
const SEARCH_LIMIT = 5_000
const MAX_REFS = 1_024
const SNAPSHOTS = 32
const SNAPSHOT_AGE_MS = 10 * 60_000
const snapshots = new Map<string, { repository: string; tips: string[]; at: number }>()
const FORMAT = '%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%B'

export async function repositoryFor(core: Core, projectId: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const project = await core.projects.byId(projectId)
  signal?.throwIfAborted()
  if (!project?.path) throw new BridgeError(404, 'project_unmapped', 'Project has no mapped checkout on this Node.')
  const root = await core.git.git(['rev-parse', '--show-toplevel'], { cwd: project.path, maxOutputBytes: 8192, signal })
  signal?.throwIfAborted()
  if (root.code !== 0)
    throw new BridgeError(404, 'repository_unavailable', root.stderr.trim() || 'Git repository unavailable.')
  return canonicalPath(root.stdout.trim())
}

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const cursorOf = (snapshot: string, offset: number, filter: HistoryFilter) =>
  Buffer.from(JSON.stringify({ snapshot, offset, filter })).toString('base64url')
function readCursor(value: string | null, filter: HistoryFilter): { snapshot: string; offset: number } | null {
  if (!value) return null
  try {
    if (value.length > 1024) throw new Error('too long')
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as {
      snapshot: string
      offset: number
      filter: HistoryFilter
    }
    if (
      !/^[0-9a-f]{64}$/.test(parsed.snapshot) ||
      !Number.isSafeInteger(parsed.offset) ||
      parsed.offset < 0 ||
      parsed.offset > (filter.query.trim() ? SEARCH_LIMIT : Number.MAX_SAFE_INTEGER - PAGE) ||
      JSON.stringify(parsed.filter) !== JSON.stringify(filter)
    )
      throw new Error('invalid')
    return parsed
  } catch {
    throw new BridgeError(400, 'bad_cursor', 'History cursor does not match this filter.')
  }
}

function parseCommits(output: string): Commit[] {
  const values = output.split('\0')
  const commits: Commit[] = []
  for (let i = 0; i + 9 < values.length; i += 10) {
    const [id, parents, an, ae, at, cn, ce, ct, subject, message] = values.slice(i, i + 10)
    if (!id || !ID.test(id)) break
    commits.push({
      id,
      parents: parents ? parents.split(' ') : [],
      author: { name: an!, email: ae!, at: Number(at) * 1000 },
      committer: { name: cn!, email: ce!, at: Number(ct) * 1000 },
      subject: subject!,
      message: message!,
      refs: [],
    })
  }
  return commits
}

async function refSnapshot(
  core: Core,
  repository: string,
  signal?: AbortSignal,
): Promise<{ tips: string[]; names: Map<string, string[]>; refs: string[] }> {
  const refs = await core.git.git(
    ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(*objectname)', 'refs/heads', 'refs/remotes', 'refs/tags'],
    { cwd: repository, maxOutputBytes: 256 * 1024, signal },
  )
  signal?.throwIfAborted()
  if (refs.code !== 0) throw new BridgeError(422, 'git_failed', refs.stderr.trim())
  const names = new Map<string, string[]>()
  const lines = refs.stdout.trimEnd().split('\n').filter(Boolean)
  if (lines.length > MAX_REFS) throw new BridgeError(422, 'too_many_refs', `History supports at most ${MAX_REFS} refs.`)
  for (const line of lines) {
    const [name, object, peeled] = line.split('\0')
    const id = peeled || object
    if (name && id && ID.test(id)) names.set(name, [...(names.get(name) ?? []), id])
  }
  const head = await core.git.git(['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd: repository,
    maxOutputBytes: 128,
    signal,
  })
  signal?.throwIfAborted()
  if (head.code === 0 && ID.test(head.stdout.trim())) names.set('HEAD', [head.stdout.trim()])
  return { tips: [...new Set([...names.values()].flat())], names, refs: [...names.keys()] }
}

export async function history(
  core: Core,
  projectId: string,
  filter: HistoryFilter,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<HistoryPage> {
  if (filter.query.length > 128 || !['message', 'author', 'hash'].includes(filter.field))
    throw new BridgeError(400, 'bad_filter', 'Invalid history search.')
  const repository = await repositoryFor(core, projectId, signal)
  const snapshot = await refSnapshot(core, repository, signal)
  const previous = readCursor(cursor, filter)
  if (!previous && filter.ref && !snapshot.names.has(filter.ref))
    throw new BridgeError(400, 'bad_ref', 'Ref is unavailable.')
  const pinned = previous ? snapshots.get(previous.snapshot) : null
  if (previous && (!pinned || pinned.repository !== repository || Date.now() - pinned.at > SNAPSHOT_AGE_MS))
    throw new BridgeError(409, 'history_expired', 'History page expired. Refresh from the first page.')
  const tips = pinned?.tips ?? (filter.ref ? snapshot.names.get(filter.ref)! : snapshot.tips)
  const snapshotId = previous?.snapshot ?? sha([repository, tips, filter, Date.now()])
  const offset = previous?.offset ?? 0
  const observation = sha([tips, filter])
  const labels = new Map<string, string[]>()
  for (const [name, ids] of snapshot.names) for (const id of ids) labels.set(id, [...(labels.get(id) ?? []), name])
  if (!tips.length)
    return { commits: [], refs: snapshot.refs, nextCursor: null, observation, searched: 0, limit: PAGE, omitted: null }
  const search = filter.query.trim().toLocaleLowerCase()
  const count = search ? SEARCH_LIMIT + 1 : PAGE + 1
  const args = [
    'log',
    '--topo-order',
    '-z',
    `--format=${FORMAT}`,
    `--max-count=${count}`,
    ...(search ? [] : [`--skip=${offset}`]),
    ...tips,
  ]
  let result: Awaited<ReturnType<Core['git']['git']>>
  try {
    result = await core.git.git(args, {
      cwd: repository,
      maxOutputBytes: search ? 16 << 20 : 2 << 20,
      timeoutMs: 30_000,
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new BridgeError(422, 'history_limit', `History read exceeded its ${search ? 16 : 2} MiB or 30-second limit.`)
  }
  if (result.code !== 0)
    throw new BridgeError(409, 'history_expired', result.stderr.trim() || 'Pinned history objects are unavailable.')
  signal?.throwIfAborted()
  const all = parseCommits(result.stdout)
  const matched = search
    ? all.slice(0, SEARCH_LIMIT).filter((commit) => {
        const text =
          filter.field === 'hash'
            ? commit.id
            : filter.field === 'author'
              ? `${commit.author.name} ${commit.author.email}`
              : commit.message
        return text.toLocaleLowerCase().includes(search)
      })
    : all
  const slice = matched.slice(search ? offset : 0, (search ? offset : 0) + PAGE)
  const more = search ? matched.length > offset + PAGE : all.length > PAGE
  signal?.throwIfAborted()
  if (!previous && more) {
    snapshots.set(snapshotId, { repository, tips, at: Date.now() })
    if (snapshots.size > SNAPSHOTS) snapshots.delete(snapshots.keys().next().value!)
  }
  return {
    commits: slice.map((commit) => ({ ...commit, refs: labels.get(commit.id) ?? [] })),
    refs: snapshot.refs,
    nextCursor: more ? cursorOf(snapshotId, offset + PAGE, filter) : null,
    observation,
    searched: search ? Math.min(all.length, SEARCH_LIMIT) : slice.length,
    limit: PAGE,
    omitted:
      search && all.length > SEARCH_LIMIT ? `Search examined the newest ${SEARCH_LIMIT} reachable commits.` : null,
  }
}

export function _clearHistorySnapshots(): void {
  snapshots.clear()
}

export async function commitById(core: Core, repository: string, id: string, signal?: AbortSignal): Promise<Commit> {
  if (!ID.test(id)) throw new BridgeError(400, 'bad_object', 'Invalid commit ID.')
  const result = await core.git.git(['show', '-s', '-z', `--format=${FORMAT}`, id], {
    cwd: repository,
    maxOutputBytes: 256 * 1024,
    signal,
  })
  signal?.throwIfAborted()
  const commit = result.code === 0 ? parseCommits(result.stdout)[0] : undefined
  if (!commit || commit.id !== id) throw new BridgeError(404, 'commit_missing', 'Commit is no longer available.')
  return commit
}
