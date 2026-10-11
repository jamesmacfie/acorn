import { createHash } from 'node:crypto'
import { BridgeError, type CoreServices } from '@acorn/plugin-api/node'
import {
  documentCache,
  documentTopology,
  fileDocument,
  searchDocument,
  MAX_DOCUMENT_FILES,
  MAX_SEGMENTS_PER_REQUEST,
  SEARCH_MAX_QUERY,
  type DiffDocumentFile,
  type DiffSearchRequest,
  type DiffSegmentRequest,
} from '@acorn/diff-document/document'
import type { RevisionDetail, RevisionFile } from '../shared/api'
import { commitById, repositoryFor } from './history'

type Core = Pick<CoreServices, 'git' | 'projects'>
const ID = /^[0-9a-f]{40,64}$/
const MAX_FILES = Math.min(MAX_DOCUMENT_FILES, 500)
const PATCH_BYTES = 8 << 20
const TEXT_BYTES = 256 << 10
const parsed = documentCache(32 << 20)
const documents = new Map<string, RevisionDetail>()
const DOCUMENTS = 16
const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`
const key = (repository: string, id: string, base: string | null) => `${repository}\0${id}\0${base ?? ''}`
const docKey = (repository: string, id: string, base: string | null, patchKey: string) =>
  `${key(repository, id, base)}\0${patchKey}`

export function parseRawFiles(output: string): RevisionFile[] {
  const fields = output.split('\0')
  const files: RevisionFile[] = []
  for (let i = 0; i < fields.length - 1;) {
    const header = fields[i++]!
    const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])\d*$/.exec(header)
    if (!match) throw new BridgeError(422, 'git_format', 'Unexpected Git diff topology.')
    const first = fields[i++]!
    const moved = match[5] === 'R' || match[5] === 'C'
    const path = moved ? fields[i++]! : first
    files.push({
      path,
      oldPath: moved ? first : null,
      status: match[5]!,
      oldMode: match[1]!,
      newMode: match[2]!,
      oldId: match[3]!,
      newId: match[4]!,
      binary: false,
      omission: null,
    })
  }
  return files
}

async function resolveBase(
  core: Core,
  repository: string,
  id: string,
  requested: string | null | undefined,
  parents: string[],
  signal?: AbortSignal,
  comparison = false,
): Promise<string | null> {
  if (requested === undefined) return parents[0] ?? null
  if (requested === null) {
    if (parents.length) throw new BridgeError(400, 'bad_base', 'Only a root commit can use the empty tree.')
    return null
  }
  if (!ID.test(requested) || (!comparison && !parents.includes(requested)))
    throw new BridgeError(400, 'bad_base', 'Comparison base must be a parent of this commit.')
  await commitById(core, repository, requested, signal)
  return requested
}

async function emptyTree(core: Core, repository: string, signal?: AbortSignal): Promise<string> {
  const result = await core.git.git(['hash-object', '-t', 'tree', '--stdin'], {
    cwd: repository,
    stdin: '',
    maxOutputBytes: 128,
    signal,
  })
  signal?.throwIfAborted()
  const id = result.stdout.trim()
  if (result.code !== 0 || !ID.test(id))
    throw new BridgeError(422, 'git_failed', result.stderr.trim() || 'Cannot resolve the empty tree.')
  return id
}

export async function revision(
  core: Core,
  projectId: string,
  id: string,
  requested?: string | null,
  signal?: AbortSignal,
  withLabels = false,
  comparison = false,
): Promise<RevisionDetail> {
  const repository = await repositoryFor(core, projectId, signal)
  signal?.throwIfAborted()
  const commit = await commitById(core, repository, id, signal)
  const base = await resolveBase(core, repository, id, requested, commit.parents, signal, comparison)
  const cacheKey = key(repository, id, base)
  const held = documents.get(cacheKey)
  if (held) {
    documents.delete(cacheKey)
    documents.set(cacheKey, held)
  }
  if (withLabels) {
    const [pointing, head] = await Promise.all([
      core.git.git(
        ['for-each-ref', '--points-at', id, '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags'],
        { cwd: repository, maxOutputBytes: 32 << 10, signal },
      ),
      core.git.git(['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: repository, maxOutputBytes: 128, signal }),
    ])
    signal?.throwIfAborted()
    if (pointing.code === 0) commit.refs = pointing.stdout.trim().split('\n').filter(Boolean)
    if (head.code === 0 && head.stdout.trim() === id) commit.refs.unshift('HEAD')
  }
  if (held) {
    signal?.throwIfAborted()
    if (withLabels) held.commit.refs = commit.refs
    return held
  }
  const pair = [base ?? (await emptyTree(core, repository, signal)), id]
  const raw = await core.git.git(['diff', '--raw', '-z', '--no-abbrev', '-M', '--no-ext-diff', ...pair], {
    cwd: repository,
    maxOutputBytes: 512 << 10,
    signal,
  })
  signal?.throwIfAborted()
  if (raw.code !== 0) throw new BridgeError(422, 'git_failed', raw.stderr.trim())
  const all = parseRawFiles(raw.stdout)
  const files = all.slice(0, MAX_FILES)
  const omitted = all.length > MAX_FILES ? `Showing the first ${MAX_FILES} of ${all.length} changed files.` : null
  // This bounded one-process patch read computes segment descriptors. The client receives only
  // descriptors now and asks for row payloads when they enter the viewport.
  let patches: string[] = []
  let patchOmission: string | null = null
  try {
    const result = await core.git.git(
      [
        '-c',
        'core.quotePath=false',
        'diff',
        '--patch',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '-M',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        ...pair,
      ],
      { cwd: repository, maxOutputBytes: PATCH_BYTES, signal },
    )
    signal?.throwIfAborted()
    if (result.code !== 0) throw new Error(result.stderr.trim())
    patches = result.stdout
      .split(/^diff --git /m)
      .slice(1)
      .map((part) => `diff --git ${part}`)
    if (patches.length !== all.length) patchOmission = 'Git patch and topology counts differ; patches are unavailable.'
  } catch (error) {
    signal?.throwIfAborted()
    patchOmission = `Patch content unavailable within the ${PATCH_BYTES >> 20} MiB limit: ${error instanceof Error ? error.message : String(error)}`
  }
  signal?.throwIfAborted()
  const docFiles: DiffDocumentFile[] = files.map((file, index) => {
    const patch = patchOmission ? '' : (patches[index] ?? '')
    file.binary = /^(Binary files |GIT binary patch)/m.test(patch)
    const hunk = patch.indexOf('\n@@')
    const text = !file.binary && hunk >= 0 ? patch.slice(hunk + 1) : ''
    if (patchOmission) file.omission = patchOmission
    else if (file.binary) file.omission = 'Binary content is not shown.'
    const patchKey = text ? digest(text) : null
    const doc = patchKey ? fileDocument(file.path, text) : null
    if (doc && patchKey) parsed.set(docKey(repository, id, base, patchKey), doc)
    const status =
      ({ A: 'added', D: 'deleted', R: 'renamed', C: 'copied', M: 'modified', T: 'modified' } as Record<string, string>)[
        file.status
      ] ?? 'modified'
    return {
      path: file.path,
      status,
      additions: null,
      deletions: null,
      sha: file.newMode === '000000' || file.newMode === '160000' ? null : file.newId,
      viewed: false,
      patchKey,
      segments: doc?.descriptors ?? [],
    }
  })
  const detail = {
    commit,
    base,
    files,
    topology: documentTopology(docFiles),
    omitted: [omitted, patchOmission].filter(Boolean).join(' ') || null,
  }
  documents.set(cacheKey, detail)
  if (documents.size > DOCUMENTS) documents.delete(documents.keys().next().value!)
  return detail
}

async function rows(
  core: Core,
  repository: string,
  projectId: string,
  detail: RevisionDetail,
  path: string,
  patchKey: string,
  signal?: AbortSignal,
  comparison = false,
) {
  signal?.throwIfAborted()
  const file = detail.topology.files.find((entry) => entry.path === path && entry.patchKey === patchKey)
  if (!file) throw new BridgeError(409, 'revision_conflict', 'Diff segment is not in this revision.')
  let doc = parsed.get(docKey(repository, detail.commit.id, detail.base, patchKey))
  if (!doc) {
    // A cache miss re-reads the bounded immutable revision, then finds its parsed file.
    documents.delete(key(repository, detail.commit.id, detail.base))
    const refreshed = await revision(core, projectId, detail.commit.id, detail.base, signal, false, comparison)
    signal?.throwIfAborted()
    doc = parsed.get(docKey(repository, refreshed.commit.id, refreshed.base, patchKey))
  }
  if (!doc) throw new BridgeError(422, 'patch_unavailable', 'Patch is unavailable within the document cache budget.')
  return doc.segments
}

export async function revisionFor(
  core: Core,
  projectId: string,
  id: string,
  base?: string | null,
  signal?: AbortSignal,
  comparison = false,
) {
  return revision(core, projectId, id, base, signal, true, comparison)
}

export async function segments(
  core: Core,
  projectId: string,
  id: string,
  base: string | null,
  requests: DiffSegmentRequest[],
  signal?: AbortSignal,
  comparison = false,
) {
  if (requests.length > MAX_SEGMENTS_PER_REQUEST)
    throw new BridgeError(400, 'too_many_segments', 'Too many diff segments.')
  const repository = await repositoryFor(core, projectId, signal)
  const detail = await revision(core, projectId, id, base, signal, false, comparison)
  const result = []
  for (const request of requests) {
    const content = await rows(core, repository, projectId, detail, request.path, request.patchKey, signal, comparison)
    const selected = content[request.ordinal]
    if (!selected) throw new BridgeError(400, 'bad_ordinal', 'Diff segment does not exist.')
    result.push({ ...request, rows: selected })
  }
  signal?.throwIfAborted()
  return result
}

export async function search(
  core: Core,
  projectId: string,
  id: string,
  base: string | null,
  request: DiffSearchRequest,
  signal?: AbortSignal,
  comparison = false,
) {
  if (request.query.length > SEARCH_MAX_QUERY) throw new BridgeError(400, 'bad_query', 'Search query is too long.')
  const repository = await repositoryFor(core, projectId, signal)
  const detail = await revision(core, projectId, id, base, signal, false, comparison)
  const files = detail.topology.files.map(({ path, patchKey }) => ({ path, patchKey }))
  const page = await searchDocument(
    files,
    (file) => rows(core, repository, projectId, detail, file.path, file.patchKey, signal, comparison),
    request,
  )
  signal?.throwIfAborted()
  if (!page) throw new BridgeError(400, 'bad_cursor', 'Invalid diff search cursor.')
  return page
}

export async function fileText(
  core: Core,
  projectId: string,
  id: string,
  base: string | null,
  path: string,
  sha: string,
  signal?: AbortSignal,
  comparison = false,
) {
  const repository = await repositoryFor(core, projectId, signal)
  const detail = await revision(core, projectId, id, base, signal, false, comparison)
  const file = detail.topology.files.find((entry) => entry.path === path && entry.sha === sha)
  if (!file || !ID.test(sha)) throw new BridgeError(400, 'bad_blob', 'Blob is not in this revision.')
  const size = await core.git.git(['cat-file', '-s', sha], { cwd: repository, maxOutputBytes: 128, signal })
  signal?.throwIfAborted()
  if (size.code !== 0 || Number(size.stdout) > TEXT_BYTES)
    throw new BridgeError(422, 'file_too_large', `Gap expansion supports files up to ${TEXT_BYTES >> 10} KiB.`)
  const body = await core.git.git(['cat-file', 'blob', sha], { cwd: repository, maxOutputBytes: TEXT_BYTES, signal })
  signal?.throwIfAborted()
  if (body.code !== 0) throw new BridgeError(404, 'blob_missing', 'Blob is unavailable.')
  return { text: body.stdout }
}

export const revisionCacheStats = () => ({ documents: documents.size, ...parsed.stats() })
