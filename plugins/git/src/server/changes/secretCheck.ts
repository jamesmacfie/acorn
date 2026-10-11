// Secret checks for the two Git operations Changes publishes through (docs/security/secret-publication.md
// § Git). Git selection lives here; the detector and the gate are core's (@acorn/plugin-api/node).
// `localGitBridge` loads this module only while blocking is on, or for a check the owner asked for.
//
// Both checks read Git objects, never the disk: a commit takes the index, and a push takes whatever
// HEAD reaches that the remote does not have. Neither throws. A failure is an unscanned entry, so an
// enabled gate refuses an incomplete check instead of passing it.
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import {
  describeSecretRefusal,
  git,
  gitOrThrow,
  gitText,
  scanSecretText,
  SECRET_DETECTOR_VERSION,
  secretReport,
  type SecretPublicationGate,
} from '@acorn/plugin-api/node'
import type {
  SecretCheckReport,
  SecretFinding,
  SecretPublicationRefusal,
  SecretUnscanned,
} from '@acorn/protocol/secretChecks.ts'
import type { CommitOptions, GitSecretCheckResult, PushOptions } from '../../shared/changes/api'
import { branchOf, commitStaged, NETWORK_TIMEOUT_MS, pushBranch } from './localDiff'
import type { GitActionResult } from './routes/localGit'

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** A text blob larger than this is unscanned, which an enabled gate treats as incomplete. */
export const SECRET_BLOB_MAX_BYTES = 8 << 20
/** The bytes and blobs one check reads before it stops as incomplete. */
export const SECRET_TOTAL_MAX_BYTES = 64 << 20
export const SECRET_MAX_BLOBS = 20_000
const BATCH_BYTES = 16 << 20
/** Annotated tags a followTags push may carry before the check stops as incomplete. */
const MAX_TAGS = 200

export type GitSecretCheck = { destination: string; report: SecretCheckReport }

// Per blob id and detector version: positions and rule ids only, never a value or a line. A blob is
// immutable, so a result never goes stale; the bound keeps the map from growing with history.
const CACHE_LIMIT = 20_000
type CachedBlob = { findings: Omit<SecretFinding, 'location'>[] }
const blobCache = new Map<string, CachedBlob>()
const remember = (id: string, result: CachedBlob) => {
  blobCache.set(`${SECRET_DETECTOR_VERSION}:${id}`, result)
  if (blobCache.size > CACHE_LIMIT) blobCache.delete(blobCache.keys().next().value!)
}

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const text = async (
  root: string,
  args: string[],
  options: {
    stdin?: string
    env?: Record<string, string>
    timeoutMs?: number
    stdoutEncoding?: 'utf8' | 'latin1'
  } = {},
) =>
  (await gitOrThrow(args, { cwd: root, timeoutMs: options.timeoutMs ?? 30_000, maxOutputBytes: 64 << 20, ...options }))
    .stdout
const optional = async (root: string, args: string[]) => {
  const result = await git(args, { cwd: root, timeoutMs: 15_000 })
  return result.code === 0 ? result.stdout.trim() : null
}

type Blob = { id: string; path: string }

/** Scan blobs by id, reading each once through `git cat-file --batch`. Every blob is scanned,
 *  binary included: a NUL byte must not hide an ASCII token next to it, and the size bounds still apply. */
export async function scanBlobs(
  root: string,
  blobs: readonly Blob[],
  signal?: AbortSignal,
): Promise<{ findings: SecretFinding[]; unscanned: SecretUnscanned[]; stopped: boolean }> {
  const findings: SecretFinding[] = []
  const unscanned: SecretUnscanned[] = []
  const unique = [...new Map(blobs.map((blob) => [blob.id, blob])).values()]
  if (unique.length > SECRET_MAX_BLOBS) {
    return {
      findings,
      unscanned: [{ location: `${unique.length} blobs`, reason: `More than ${SECRET_MAX_BLOBS} blobs to check.` }],
      stopped: true,
    }
  }
  const record = (blob: Blob, result: CachedBlob) => {
    for (const finding of result.findings) findings.push({ ...finding, location: blob.path })
  }
  const pending = unique.filter((blob) => {
    const cached = blobCache.get(`${SECRET_DETECTOR_VERSION}:${blob.id}`)
    if (cached) record(blob, cached)
    return !cached
  })
  if (!pending.length) return { findings, unscanned, stopped: false }

  const sizes = await text(root, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    stdin: pending.map((blob) => blob.id).join('\n') + '\n',
  })
  const sized = new Map(
    sizes
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, type, size] = line.split(' ')
        return [id!, { type: type!, size: Number(size) }] as const
      }),
  )
  let total = 0
  let batch: Blob[] = []
  let batchBytes = 0
  const flush = async () => {
    if (!batch.length) return
    signal?.throwIfAborted()
    // Latin-1 keeps one character per byte, so each object is sliced by the size in its own header
    // rather than found by searching for the next header, which a blob's content could imitate.
    const output = await text(root, ['cat-file', '--batch'], {
      stdin: batch.map((blob) => blob.id).join('\n') + '\n',
      stdoutEncoding: 'latin1',
    })
    let at = 0
    for (const [index, blob] of batch.entries()) {
      const header = output.indexOf('\n', at)
      const [id, type, size] = output.slice(at, header).split(' ')
      const end = header + 1 + Number(size)
      if (
        header < 0 ||
        id !== blob.id ||
        type !== 'blob' ||
        !Number.isSafeInteger(Number(size)) ||
        output[end] !== '\n'
      ) {
        // Every later object in this batch is unreadable too: the stream lost its framing here.
        for (const lost of batch.slice(index))
          unscanned.push({ location: lost.path, reason: 'Git could not read this object.' })
        break
      }
      at = end + 1
      // Lossy UTF-8: tokens are ASCII and survive it, in text and binary content alike.
      const body = new TextDecoder().decode(Buffer.from(output.slice(header + 1, end), 'latin1'))
      const result: CachedBlob = {
        findings: scanSecretText(body, blob.path).map(({ location: _location, ...finding }) => finding),
      }
      remember(blob.id, result)
      record(blob, result)
    }
    batch = []
    batchBytes = 0
  }
  for (const blob of pending) {
    const info = sized.get(blob.id)
    // `rev-list --objects` names trees with paths too; they hold no content of their own.
    if (info?.type === 'tree') continue
    if (!info || info.type !== 'blob') {
      unscanned.push({ location: blob.path, reason: 'Git could not read this object.' })
      continue
    }
    if (info.size > SECRET_BLOB_MAX_BYTES) {
      unscanned.push({ location: blob.path, reason: `Larger than ${SECRET_BLOB_MAX_BYTES >> 20} MiB.` })
      continue
    }
    total += info.size
    if (total > SECRET_TOTAL_MAX_BYTES) {
      unscanned.push({ location: blob.path, reason: `The check stopped after ${SECRET_TOTAL_MAX_BYTES >> 20} MiB.` })
      return { findings, unscanned, stopped: true }
    }
    if (batchBytes + info.size > BATCH_BYTES) await flush()
    batch.push(blob)
    batchBytes += info.size
  }
  await flush()
  return { findings, unscanned, stopped: false }
}

// `git diff-tree -r -z` records: `:<mode> <mode> <old> <new> <status>\0<path>\0`. Added, modified,
// and type-changed blobs only; a deletion publishes nothing and a submodule is not a blob.
export function changedBlobs(output: string): Blob[] {
  const parts = output.split('\0')
  const out: Blob[] = []
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const [, newMode, , id, status] = parts[index]!.split(' ')
    if (status && /^[AMT]/.test(status) && newMode !== '160000' && newMode !== '000000')
      out.push({ id: id!, path: parts[index + 1]! })
  }
  return out
}

const failure = (digest: string, location: string, error: unknown, limits: string[] = []): SecretCheckReport =>
  secretReport({
    digest,
    findings: [],
    unscanned: [
      { location, reason: error instanceof Error ? error.message.split('\n')[0]!.slice(0, 200) : 'The check failed.' },
    ],
    limits,
  })

function finish(digest: string, scan: Awaited<ReturnType<typeof scanBlobs>>, limits: string[]): SecretCheckReport {
  return secretReport({ digest, findings: scan.findings, unscanned: scan.unscanned, stopped: scan.stopped, limits })
}

// ── Commit ───────────────────────────────────────────────────────────────────────────────────────

/** The tree the next commit would record. The index, or for `-a` the index plus every tracked
 *  change, built in a copy of the index so the real one is untouched. */
export async function commitTree(root: string, options: CommitOptions): Promise<string> {
  if (!options.all) return (await text(root, ['write-tree'])).trim()
  const indexPath = (await text(root, ['rev-parse', '--git-path', 'index'])).trim()
  const dir = await mkdtemp(join(tmpdir(), 'acorn-secret-index-'))
  try {
    const copy = join(dir, 'index')
    // No index yet means nothing is tracked, and `add -u` on a new index file adds nothing.
    await copyFile(isAbsolute(indexPath) ? indexPath : join(root, indexPath), copy).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      },
    )
    await text(root, ['add', '-u'], { env: { GIT_INDEX_FILE: copy } })
    return (await text(root, ['write-tree'], { env: { GIT_INDEX_FILE: copy } })).trim()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export const headOf = (root: string) => optional(root, ['rev-parse', '--verify', '-q', 'HEAD'])

/** Check the blobs the commit adds over its parent: HEAD, or HEAD's parent for an amend, so an amend
 *  covers the whole final tree it records. `recorded` re-checks a commit Git already made: its tree,
 *  and the HEAD it was made on. */
export async function commitSecretCheck(
  root: string,
  branch: string,
  options: CommitOptions,
  recorded?: { tree: string; head: string | null },
  signal?: AbortSignal,
): Promise<GitSecretCheck & { tree: string | null }> {
  const destination = `${branch || 'detached HEAD'} in ${root}`
  const limits = [
    'Checks the staged tree, not files on disk. A Git process outside Acorn can still change the index before the commit.',
  ]
  try {
    const head = recorded ? recorded.head : await headOf(root)
    const tree = recorded?.tree
    const base = options.amend
      ? ((head ? await optional(root, ['rev-parse', '--verify', '-q', `${head}^`]) : null) ?? EMPTY_TREE)
      : (head ?? EMPTY_TREE)
    const final = tree ?? (await commitTree(root, options))
    const digest = sha256([
      'commit',
      final,
      base,
      !!options.all,
      !!options.amend,
      !!options.signoff,
      !!options.noVerify,
      branch,
    ])
    const diff = await text(root, ['diff-tree', '-r', '-z', '--no-renames', base, final])
    return {
      destination,
      tree: final,
      report: finish(digest, await scanBlobs(root, changedBlobs(diff), signal), limits),
    }
  } catch (error) {
    // Stable for the same tree state and options, so the owner can allow an incomplete check once.
    const identity = [
      'commit',
      'incomplete',
      await headOf(root),
      await optional(root, ['write-tree']),
      !!options.all,
      !!options.amend,
      !!options.signoff,
      !!options.noVerify,
      branch,
    ]
    return { destination, tree: null, report: failure(sha256(identity), 'staged changes', error, limits) }
  }
}

// ── Push ─────────────────────────────────────────────────────────────────────────────────────────

/** Every blob HEAD reaches that the remote's actual refs do not. Asked of the remote, not of the
 *  local tracking refs, which can be stale in either direction. Covers a secret a later commit
 *  removed: it is still in the history being pushed. */
export async function pushSecretCheck(
  root: string,
  branch: string,
  options: PushOptions,
  signal?: AbortSignal,
): Promise<GitSecretCheck & { head: string | null }> {
  const target = `refs/heads/${branch}`
  let destination = `origin ${target}`
  const limits = [
    'Checks the outgoing history at the time of the check. A Git process outside Acorn can move HEAD before the push.',
  ]
  try {
    if (!branch) throw new Error('HEAD is detached, so there is no branch to push.')
    const url = await optional(root, ['remote', 'get-url', '--push', 'origin'])
    if (!url) throw new Error('This repository has no origin remote.')
    destination = `${url} ${target}`
    const head = await headOf(root)
    if (!head) throw new Error('This branch has no commits.')
    const advertised = (await text(root, ['ls-remote', 'origin'], { timeoutMs: NETWORK_TIMEOUT_MS }))
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t') as [string, string])
    const expected = advertised.find(([, ref]) => ref === target)?.[0] ?? null
    const remoteIds = [...new Set(advertised.map(([id]) => id))]
    // Only objects this clone has can bound the walk. A remote ref we never fetched cannot, so the
    // walk includes more, never less.
    const known = remoteIds.length
      ? (
          await text(root, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
            stdin: remoteIds.join('\n') + '\n',
          })
        )
          .split('\n')
          .filter((line) => / (?:commit|tag)$/.test(line))
          .map((line) => line.split(' ')[0]!)
          .sort()
      : []
    if (!expected)
      limits.push('The remote has no branch with this name, so every commit not on another remote ref is checked.')
    // With push.followTags, Git also sends annotated tags that point into HEAD's history and that
    // the remote lacks. Their commits are already in the walk below; the tag messages are new text.
    const tags =
      (await optional(root, ['config', '--type=bool', '--get', 'push.followTags'])) === 'true'
        ? (
            await text(root, [
              'for-each-ref',
              '--merged',
              head,
              '--format=%(objecttype) %(objectname) %(refname)',
              'refs/tags',
            ])
          )
            .split('\n')
            .filter((line) => line.startsWith('tag '))
            .map((line) => line.split(' ') as [string, string, string])
            .filter(([, id, ref]) => !advertised.some(([remoteId, remoteRef]) => remoteRef === ref && remoteId === id))
        : []
    if (tags.length > MAX_TAGS) throw new Error(`More than ${MAX_TAGS} annotated tags would be pushed.`)
    const digest = sha256(['push', destination, head, expected, !!options.force, known, tags.map(([, id]) => id)])
    const objects = await text(root, ['rev-list', '--objects', '--stdin'], {
      stdin: [head, ...known.map((id) => `^${id}`)].join('\n') + '\n',
    })
    const blobs = objects.split('\n').flatMap((line) => {
      const space = line.indexOf(' ')
      return space > 0 ? [{ id: line.slice(0, space), path: line.slice(space + 1) }] : []
    })
    const scan = await scanBlobs(root, blobs, signal)
    for (const [, id, ref] of tags)
      scan.findings.push(...scanSecretText(await text(root, ['cat-file', 'tag', id]), ref))
    return { destination, head, report: finish(digest, scan, limits) }
  } catch (error) {
    return {
      destination,
      head: null,
      report: failure(
        sha256(['push', 'incomplete', destination, await headOf(root), !!options.force]),
        'outgoing history',
        error,
        limits,
      ),
    }
  }
}

// ── Admission ────────────────────────────────────────────────────────────────────────────────────

const refused = (refusal: SecretPublicationRefusal, prefix = ''): GitActionResult => ({
  ok: false,
  reason: prefix + describeSecretRefusal(refusal),
  secretCheck: refusal,
})

/** Commit through an enabled gate. The caller holds the worktree's index lane and has run the
 *  optional hook, so a stage from the pane cannot land between this check and the commit. */
export async function gatedCommit(
  root: string,
  branch: string,
  message: string,
  options: CommitOptions,
  gate: SecretPublicationGate,
): Promise<GitActionResult> {
  const checked = await commitSecretCheck(root, branch, options)
  const refusal = await gate.admit({ operation: 'commit', destination: checked.destination, report: checked.report })
  if (refusal) return refused(refusal)
  if (checked.tree && checked.tree !== (await commitTree(root, options).catch(() => null))) {
    return { ok: false, reason: 'The staged changes moved during the secret check. Try the commit again.' }
  }
  const before = await headOf(root)
  const result = await commitStaged(root, message, options)
  if (!result.ok) return result
  // A native pre-commit hook can restage files after the check. Bind the tree Git actually recorded:
  // check it, and if it is refused, move the branch back. The index keeps the hook's changes, so
  // nothing is lost and the next attempt checks the same tree.
  const after = await headOf(root)
  const recorded = after ? await gitText(['rev-parse', `${after}^{tree}`], { cwd: root }).catch(() => null) : null
  if (recorded === checked.tree) return result
  const final = recorded ? await commitSecretCheck(root, branch, options, { tree: recorded, head: before }) : null
  const late = final
    ? await gate.admit({ operation: 'commit', destination: final.destination, report: final.report })
    : null
  if (final && !late) return result
  await undoCommit(root, before, after)
  return late
    ? refused(late, 'A Git hook changed the commit after the check. ')
    : {
        ok: false,
        reason:
          'A Git hook changed the commit after the check, and the result could not be read, so the commit was undone.',
      }
}

/** Push through an enabled gate. HEAD is re-read before the push; a Git process outside Acorn can
 *  still move it in the moment between. */
export async function gatedPush(
  root: string,
  branch: string,
  options: PushOptions,
  gate: SecretPublicationGate,
): Promise<GitActionResult> {
  const checked = await pushSecretCheck(root, branch, options)
  const refusal = await gate.admit({ operation: 'push', destination: checked.destination, report: checked.report })
  if (refusal) return refused(refusal)
  if (checked.head && checked.head !== (await headOf(root)))
    return { ok: false, reason: 'HEAD moved during the secret check. Try the push again.' }
  return pushBranch(root, options)
}

/** The check a commit or push would run, on request. The commit check follows the button: Commit
 *  staged when something is staged, Commit tracked otherwise. */
export async function manualSecretCheck(root: string, operation: 'commit' | 'push'): Promise<GitSecretCheckResult> {
  const branch = await branchOf(root)
  const staged = (await git(['diff', '--cached', '--quiet'], { cwd: root, timeoutMs: 15_000 })).code === 1
  const { destination, report } =
    operation === 'commit'
      ? await commitSecretCheck(root, branch, { all: !staged })
      : await pushSecretCheck(root, branch, {})
  return { operation, destination, report }
}

// Move the branch back to where it was before a refused commit, only if it still points at the
// commit we made. `update-ref` with an old value is Git's compare-and-swap; a root commit deletes
// the branch ref instead. Leaves the index and the disk alone.
async function undoCommit(root: string, before: string | null, after: string | null): Promise<void> {
  if (!after) return
  const args = before
    ? ['update-ref', '-m', 'acorn: undo a commit the secret check refused', 'HEAD', before, after]
    : ['update-ref', '-d', 'HEAD', after]
  await git(args, { cwd: root, timeoutMs: 15_000 })
}
