import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { BridgeError, type CompiledCoreServices, type CoreServices } from '@acorn/plugin-api/node'
import type {
  ConflictDetail,
  ConflictResolve,
  ConflictResolveResult,
  ConflictResult,
  ConflictSide,
  OperationKind,
} from '../shared/api'
import { repositoryFor } from './history'
import { firstLine, mutateRepository, readOperation, targetCheckout } from './checkout'
import { observe, recordedCheckout } from './operations'

type Core = Pick<CoreServices, 'git' | 'projects' | 'tasks' | 'fs'> & Pick<CompiledCoreServices, 'checkoutAdmission'>

/** Per side and for the result, so one response holds at most four of these. */
export const CONFLICT_TEXT_BYTES = 512 << 10
const TERMINAL =
  'Resolve it in a terminal: `git checkout --ours` or `--theirs`, or edit it, then `git add` or `git rm`.'
// Same hash as Editor's file revision, so a draft acknowledged here matches what Editor reads next.
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
// Conflict start and end lines. A lone `=======` is ordinary text in many formats, so it doesn't count.
const MARKER = /^(<{7}|>{7})(?: |\r?$)/m

function utf8(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    return text.includes('\0') ? null : text
  } catch {
    return null
  }
}

/** Git's names for the stages are fixed; what each side holds depends on the operation. During a rebase,
 *  "ours" is the commit being rebased onto and "theirs" is the task commit being replayed. */
function stageLabels(operation: OperationKind | null, source: string | null): [string, string, string] {
  const short = source?.slice(0, 12) ?? 'the source'
  switch (operation) {
    case 'merge':
      return ['Common ancestor', 'Task (HEAD)', `Merging ${short}`]
    case 'rebase':
      return ['Common ancestor', `Rebased so far onto ${short}`, 'Task commit being replayed']
    case 'cherry-pick':
      return [`Parent of ${short}`, 'Task (HEAD)', `Picked ${short}`]
    case 'revert':
      return [`Reverted ${short}`, 'Task (HEAD)', `Parent of ${short}`]
    case null:
      return ['Stash base', 'Checkout', 'Stash']
  }
}

async function readSide(
  core: Pick<CoreServices, 'git'>,
  checkout: string,
  stage: 1 | 2 | 3,
  label: string,
  entry: { mode: string; id: string } | undefined,
  signal?: AbortSignal,
): Promise<{ side: ConflictSide; unsupported: string | null }> {
  const side: ConflictSide = {
    stage,
    label,
    present: !!entry,
    objectId: entry?.id ?? null,
    mode: entry?.mode ?? null,
    text: null,
  }
  if (!entry) return { side, unsupported: null }
  if (entry.mode === '120000' || entry.mode === '160000')
    return { side, unsupported: `${label} is a ${entry.mode === '120000' ? 'symbolic link' : 'submodule'}.` }
  const size = await core.git.git(['cat-file', '-s', entry.id], { cwd: checkout, maxOutputBytes: 128, signal })
  if (size.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(size.stderr))
  if (Number(size.stdout) > CONFLICT_TEXT_BYTES)
    return { side, unsupported: `${label} is larger than ${CONFLICT_TEXT_BYTES >> 10} KiB.` }
  // latin1 keeps one character per byte, so the bytes can be checked as UTF-8 here.
  const body = await core.git.git(['cat-file', 'blob', entry.id], {
    cwd: checkout,
    maxOutputBytes: CONFLICT_TEXT_BYTES,
    stdoutEncoding: 'latin1',
    signal,
  })
  if (body.code !== 0) throw new BridgeError(422, 'git_failed', firstLine(body.stderr))
  side.text = utf8(Buffer.from(body.stdout, 'latin1'))
  return { side, unsupported: side.text === null ? `${label} is binary or not UTF-8 text.` : null }
}

async function readResult(
  core: Pick<CoreServices, 'fs'>,
  checkout: string,
  path: string,
): Promise<{ abs: string; result: ConflictResult; unsupported: string | null; identity: string }> {
  const abs = core.fs.resolveInRoot(checkout, path)
  if (!abs) throw new BridgeError(403, 'path_outside', 'Path is outside the checkout.')
  const absent = { abs, result: { present: false, revision: null, text: null }, unsupported: null, identity: 'absent' }
  const info = await lstat(abs).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!info) return absent
  if (!info.isFile()) {
    return {
      ...absent,
      result: { ...absent.result, present: true },
      unsupported: info.isSymbolicLink() ? 'The working file is a symbolic link.' : 'The working path is not a file.',
      identity: `other:${info.mode}`,
    }
  }
  if (info.size > CONFLICT_TEXT_BYTES) {
    return {
      ...absent,
      result: { ...absent.result, present: true },
      unsupported: `The working file is larger than ${CONFLICT_TEXT_BYTES >> 10} KiB.`,
      identity: `large:${info.size}:${info.mtimeMs}`,
    }
  }
  const bytes = await readFile(abs)
  const revision = sha256(bytes)
  const text = utf8(bytes)
  return {
    abs,
    result: { present: true, revision, text },
    unsupported: text === null ? 'The working file is binary or not UTF-8 text.' : null,
    identity: revision,
  }
}

/** One conflicted path's index stages and working file, or null when the path is no longer conflicted. */
export async function readConflict(
  core: Pick<CoreServices, 'git' | 'fs'>,
  checkout: string,
  path: string,
  signal?: AbortSignal,
): Promise<ConflictDetail | null> {
  if (!core.fs.resolveInRoot(checkout, path))
    throw new BridgeError(403, 'path_outside', 'Path is outside the checkout.')
  // `--literal-pathspecs` so a name such as `*.ts` or `:(top)` means only itself.
  const listed = await core.git.git(['--literal-pathspecs', 'ls-files', '-u', '-z', '--', path], {
    cwd: checkout,
    maxOutputBytes: 64 << 10,
    signal,
  })
  if (listed.code !== 0 || listed.truncated)
    throw new BridgeError(422, 'git_failed', firstLine(listed.stderr, 'Could not read the conflicted path.'))
  const entries = new Map<number, { mode: string; id: string }>()
  // Each record is `<mode> <object> <stage>\t<path>`.
  for (const record of listed.stdout.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t')
    if (record.slice(tab + 1) !== path) continue
    const [mode, id, stage] = record.slice(0, tab).split(' ')
    entries.set(Number(stage), { mode: mode!, id: id! })
  }
  if (!entries.size) return null
  const { operation, source } = await readOperation(core, checkout)
  const labels = stageLabels(operation, source)
  const sides = await Promise.all(
    ([1, 2, 3] as const).map((stage) => readSide(core, checkout, stage, labels[stage - 1], entries.get(stage), signal)),
  )
  const working = await readResult(core, checkout, path)
  signal?.throwIfAborted()
  const unsupported = [...sides.map((entry) => entry.unsupported), working.unsupported].find(Boolean)
  return {
    path,
    operation,
    sides: sides.map((entry) => entry.side),
    result: working.result,
    fingerprint: sha256(`${listed.stdout}\0${working.identity}`),
    unsupported: unsupported ? `${unsupported} ${TERMINAL}` : null,
  }
}

export async function conflictDetail(
  core: Core,
  taskId: string,
  path: string,
  signal?: AbortSignal,
): Promise<ConflictDetail> {
  const { checkout } = await recordedCheckout(core, taskId)
  const detail = await readConflict(core, checkout, path, signal)
  if (!detail) throw new BridgeError(404, 'not_conflicted', 'This path has no unresolved conflict.')
  return detail
}

/** Writes or deletes the working file, then stages it, after proving nothing changed since the person read it.
 *  A save that lands before staging fails is reported as saved, so the client keeps the draft acknowledged. */
export async function resolveConflict(
  core: Core,
  taskId: string,
  input: ConflictResolve,
): Promise<ConflictResolveResult> {
  if (input.resolution.kind === 'text') {
    if (Buffer.byteLength(input.resolution.text) > CONFLICT_TEXT_BYTES)
      throw new BridgeError(422, 'too_large', `The result is larger than ${CONFLICT_TEXT_BYTES >> 10} KiB.`)
    if (MARKER.test(input.resolution.text))
      throw new BridgeError(
        422,
        'unresolved_markers',
        'The result still has conflict markers. Remove every <<<<<<< and >>>>>>> line first.',
      )
  }
  const { task } = await recordedCheckout(core, taskId)
  const repository = await repositoryFor(core, task.projectId)
  return mutateRepository(core, repository, () =>
    core.checkoutAdmission.write(taskId, async (checkout) => {
      await targetCheckout(core, repository, taskId, input.expectedPath, checkout)
      const current = await readConflict(core, checkout, input.path)
      if (!current || current.fingerprint !== input.fingerprint) {
        throw new BridgeError(
          409,
          'stale_conflict',
          'The file or its conflict changed since you opened it. Reload it and review the result again.',
        )
      }
      if (current.unsupported) throw new BridgeError(422, 'unsupported_conflict', current.unsupported)
      // readConflict confined this path a moment ago.
      const abs = core.fs.resolveInRoot(checkout, input.path)!
      let revision: string | null = null
      try {
        if (input.resolution.kind === 'delete') {
          if (current.result.present) await unlink(abs)
        } else if (current.result.present) {
          // `r+` refuses a file deleted after the check. Plain `writeFile` would recreate it.
          const file = await open(abs, 'r+')
          try {
            await file.truncate(0)
            await file.writeFile(input.resolution.text, 'utf8')
          } finally {
            await file.close()
          }
          revision = sha256(input.resolution.text)
        } else {
          await mkdir(dirname(abs), { recursive: true })
          await writeFile(abs, input.resolution.text, { encoding: 'utf8', flag: 'wx' })
          revision = sha256(input.resolution.text)
        }
      } catch (cause) {
        return {
          ok: false,
          saved: false,
          error: `Could not save the result: ${errorText(cause)}`,
          revision: null,
          state: await observe(core, taskId, checkout).catch(() => null),
        }
      }
      const stage = input.resolution.kind === 'delete' ? ['rm', '-q', '--cached', '--ignore-unmatch'] : ['add']
      const staged = await core.git
        .git(['--literal-pathspecs', ...stage, '--', input.path], { cwd: checkout, maxOutputBytes: 64 << 10 })
        .then(
          (result) => (result.code === 0 ? null : firstLine(result.stderr, 'Git refused to stage the result.')),
          errorText,
        )
      const state = await observe(core, taskId, checkout).catch(() => null)
      return staged
        ? { ok: false, saved: true, error: `Saved, but not staged: ${staged}`, revision, state }
        : { ok: true, saved: true, error: null, revision, state }
    }),
  )
}
