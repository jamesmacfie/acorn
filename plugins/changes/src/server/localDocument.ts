// A working tree's diff as a document (docs/diff-rendering.md § The document): the stacked files'
// patches, cut into segments on the node, answered as descriptors, and then segment by segment as the
// viewer comes near them.
//
// Nothing here is durable. A working tree moves every time an agent saves, so the parsed files live in
// a process-local cache keyed by worktree and patch digest, and a file is diffed again only when its
// status key says it moved. A segment request names the digest it was cut from; if that is not the
// digest the last document gave the file, or not what git says now when the node has no document to
// go by, the request is refused as a revision conflict, so the viewer never draws rows from two states
// of the tree.
//
// Patches are read in batches of paths, one `git diff` per batch, rather than a process per file. An
// untracked file has no index entry to diff against and still takes its own `--no-index` call.

import { createHash } from 'node:crypto'
import { BridgeError, gitOrThrow } from '@acorn/plugin-api/node'
import {
  documentCache, fileDocument, searchDocument,
  type DiffSearchPage, type DiffSearchRequest, type DiffSegmentDescriptor, type DiffSegmentPayload, type DiffSegmentRequest,
  type FileDocument,
} from '@acorn/diff-document/document'
import { isValidRelPath, literalPath, localDiff, pathChunks, stripToHunks, type LocalScope } from './localDiff'

/** One stacked file, by path and the status key the pane last saw for it (../client/model.ts § patchKey). */
export type DocumentFileRequest = { path: string; key: string }
/** What the node answers per file: which patch, and how it cuts. The pane already holds the rest. */
export type LocalDocumentFile = { path: string; patchKey: string | null; segments: DiffSegmentDescriptor[] }

/** Parsed patches, by worktree and digest. Keyed by worktree as well so one task's request can never
 *  be answered from another's tree, whatever digest it names. */
const parsed = documentCache(64 * 1024 * 1024)
/** Which digest a file's status key produced, so a poll that finds nothing new runs no git. */
const byStatus = new Map<string, string | null>()
const STATUS_ENTRIES = 20_000
/** The digest each file had in the last document this node answered for its worktree and scope. A
 *  segment request for any other digest is out of date, even when the rows for it are still cached:
 *  serving them would draw one file from two states of the tree. */
const latest = new Map<string, string | null>()
const latestKey = (worktree: string, scope: LocalScope, path: string) => `${worktree}\u0000${scope}\u0000${path}`

const digest = (patch: string) => `sha256:${createHash('sha256').update(patch).digest('hex')}`
const cacheKey = (worktree: string, patchKey: string) => `${worktree}\u0000${patchKey}`
const statusKey = (worktree: string, scope: LocalScope, file: DocumentFileRequest) => `${worktree}\u0000${scope}\u0000${file.path}\u0000${file.key}`

const bounded = <V,>(map: Map<string, V>, key: string, value: V) => {
  map.delete(key)
  map.set(key, value)
  if (map.size > STATUS_ENTRIES) map.delete(map.keys().next().value!)
}

/** The path in a `diff --git a/<path> b/<path>` header. Without renames both halves are the same path,
 *  so the header is split by length rather than at a ` b/`, which a path can contain. A path git had
 *  to quote starts with `"` and is not matched; that file is read on its own below. */
function headerPath(header: string): string | null {
  const length = (header.length - 5) / 2
  if (!Number.isInteger(length) || length < 1 || !header.startsWith('a/')) return null
  const path = header.slice(2, 2 + length)
  return header.slice(2 + length) === ` b/${path}` ? path : null
}

/** Split a multi-file `git diff` into each file's hunks, by the path in its header. */
function splitDiff(output: string): Map<string, string> {
  const raw = new Map<string, string>()
  for (const part of output.split(/^diff --git /m).slice(1)) {
    const newline = part.indexOf('\n')
    const path = headerPath(newline < 0 ? part : part.slice(0, newline))
    // A file that changed type, such as into a symlink, comes as two parts under one path. Joined, as
    // a single-file read prints them.
    if (path != null) raw.set(path, `${raw.get(path) ?? ''}diff --git ${part}`)
  }
  // Byte for byte what `git diff -- <path>` prints for the file alone, trailing newline included, so
  // its digest matches the one a single-file read computes when a segment is asked for later.
  const out = new Map<string, string>()
  for (const [path, text] of raw) out.set(path, stripToHunks(text))
  return out
}

/** One file read on its own. A file git cannot read, such as one without read permission, is drawn
 *  with no diff rather than failing every other file in the document. */
const aloneOrEmpty = async (worktree: string, path: string, scope: LocalScope): Promise<string> =>
  (await localDiff(worktree, path, scope).catch(() => ({ patch: '' }))).patch

/** The current patch of every path, in as few git calls as the paths allow. */
async function patchesFor(worktree: string, scope: LocalScope, paths: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!paths.length) return out
  const tracked = new Set<string>()
  // Chunks whose batch failed, most often by printing more than git's output cap for 200 files at
  // once. Their files are read one at a time instead.
  const alone = new Set<string>()
  for (const chunk of pathChunks(paths)) {
    const { stdout } = await gitOrThrow(['-c', 'core.quotePath=false', 'ls-files', '-z', '--', ...chunk.map(literalPath)], { cwd: worktree, timeoutMs: 15_000 })
    for (const path of stdout.split('\0')) if (path) tracked.add(path)
    // `--no-renames`: a rename whose two names are both in the batch would otherwise come back as one
    // diff under the new name, and the pane stacks each name as its own file. The prefixes are pinned,
    // because a user's `diff.noprefix` or `diff.mnemonicPrefix` would change every header.
    const args = [
      '-c', 'core.quotePath=false', 'diff', ...(scope === 'staged' ? ['--staged'] : []),
      '--no-renames', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--', ...chunk.map(literalPath),
    ]
    let diffed: Map<string, string>
    try {
      diffed = splitDiff((await gitOrThrow(args, { cwd: worktree, timeoutMs: 30_000 })).stdout)
    } catch {
      for (const path of chunk) alone.add(path)
      continue
    }
    for (const path of chunk) {
      const patch = diffed.get(path)
      if (patch != null) out.set(path, patch)
    }
  }
  for (const path of paths) {
    if (out.has(path)) continue
    // Untracked, in a failed batch, or a name the batch could not match: read on its own, the way a
    // single file always was. A tracked file the batch printed nothing for has no diff.
    if (!tracked.has(path) || alone.has(path) || /["\\\u0000-\u001f\u007f]/.test(path)) out.set(path, await aloneOrEmpty(worktree, path, scope))
    else out.set(path, '')
  }
  return out
}

/** The document's files, in the order asked. */
export async function localDocument(worktree: string, scope: LocalScope, files: readonly DocumentFileRequest[]): Promise<LocalDocumentFile[]> {
  if (!files.every((file) => isValidRelPath(file.path))) throw new BridgeError(400, 'bad_request', 'Invalid path.')
  const known = new Map<string, FileDocument | null>()
  const missing = new Set<string>()
  // Each file's digest, taken as it is read. Looking a known file's digest up again at the end could
  // miss it, because this request's own new entries may have pushed it out of `byStatus`.
  const keys = new Map<string, string | null>()
  for (const file of files) {
    const status = statusKey(worktree, scope, file)
    const held = byStatus.get(status)
    const doc = held === undefined ? undefined : held === null ? null : parsed.get(cacheKey(worktree, held))
    if (doc === undefined) {
      missing.add(file.path)
      continue
    }
    known.set(file.path, doc)
    keys.set(file.path, held!)
    // Used, so the files that stay unchanged are the last to be forgotten.
    bounded(byStatus, status, held!)
  }
  const patches = await patchesFor(worktree, scope, [...missing])
  for (const file of files) {
    if (!missing.has(file.path)) continue
    const patch = patches.get(file.path) ?? ''
    const patchKey = patch ? digest(patch) : null
    keys.set(file.path, patchKey)
    bounded(byStatus, statusKey(worktree, scope, file), patchKey)
    if (!patchKey) {
      known.set(file.path, null)
      continue
    }
    const doc = fileDocument(file.path, patch)
    parsed.set(cacheKey(worktree, patchKey), doc)
    known.set(file.path, doc)
  }
  return files.map((file) => {
    const doc = known.get(file.path)
    const patchKey = doc ? keys.get(file.path) ?? null : null
    bounded(latest, latestKey(worktree, scope, file.path), patchKey)
    return { path: file.path, patchKey, segments: doc?.descriptors ?? [] }
  })
}

/** A parsed file for exactly this digest, from the cache or from git now. Refused when the tree has
 *  moved on: the digest is what the request's rows were described against. */
async function documentAt(worktree: string, scope: LocalScope, path: string, patchKey: string): Promise<FileDocument> {
  if (!isValidRelPath(path)) throw new BridgeError(400, 'bad_request', 'Invalid path.')
  const current = latest.get(latestKey(worktree, scope, path))
  if (current !== undefined && current !== patchKey) throw new BridgeError(409, 'revision_conflict', 'The file changed since the diff was read.')
  const held = parsed.get(cacheKey(worktree, patchKey))
  if (held) return held
  const { patch } = await localDiff(worktree, path, scope)
  if (!patch || digest(patch) !== patchKey) throw new BridgeError(409, 'revision_conflict', 'The file changed since the diff was read.')
  const doc = fileDocument(path, patch)
  parsed.set(cacheKey(worktree, patchKey), doc)
  return doc
}

export async function localSegments(worktree: string, scope: LocalScope, requests: readonly DiffSegmentRequest[]): Promise<DiffSegmentPayload[]> {
  const out: DiffSegmentPayload[] = []
  for (const request of requests) {
    const rows = (await documentAt(worktree, scope, request.path, request.patchKey)).segments[request.ordinal]
    if (!rows) throw new BridgeError(400, 'bad_ordinal')
    out.push({ ...request, rows })
  }
  return out
}

export async function localSearch(
  worktree: string,
  scope: LocalScope,
  files: readonly { path: string; patchKey: string }[],
  request: DiffSearchRequest,
): Promise<DiffSearchPage> {
  const page = await searchDocument(files, async (file) => (await documentAt(worktree, scope, file.path, file.patchKey)).segments, request)
  if (!page) throw new BridgeError(400, 'bad_cursor')
  return page
}

/** Test seam: forget which status keys were read, so the next document diffs every file again. */
export function _resetLocalDocuments(): void {
  byStatus.clear()
  latest.clear()
}
