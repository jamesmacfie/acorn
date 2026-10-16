import { documentCache } from './cache.ts'
import { DIFF_DOCUMENT_VERSION } from './model.ts'
import type {
  DiffDocumentFile,
  DiffDocumentTopology,
  DiffSearchPage,
  DiffSearchRequest,
  DiffSegmentDescriptor,
  DiffSegmentPayload,
  DiffSegmentRequest,
} from './model.ts'
import { searchDocument } from './search.ts'
import { documentTopology, fileDocument, type FileDocument } from './segment.ts'

// A code host's diffs as documents, over a blob store the caller passes in
// (docs/github-integration/mirror.md § Diff documents). Everything here is keyed by the patch's own
// digest, the same `sha256:<hex>` its body is stored under, so it serves a pull request and a compare
// preview alike and can never hand one revision's rows to another.
//
// A patch is cut into segments once, when it is mirrored, and its segment descriptors are stored
// beside it as a small blob. A topology read then reads those and parses nothing. The segments'
// rows are cut again from the patch body when they are asked for, which is cheap because a request
// names a few segments and a parsed file stays in the cache below for the next batch.

/** Parsed patches held in this node process, by digest. Enough for the few large files a reader is
 *  moving through; a miss parses the patch body again. */
const parsed = documentCache(64 * 1024 * 1024)

/** Topology reads fan out over every file, a few at a time. */
const READ_CONCURRENCY = 16

/** The blob cache a Node half holds. The host's `BLOBS` binding is one. */
export type PatchBlobStore = {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

// The cache's keys (docs/caching.md § Immutable blob cache):
//   patch:<digest>  - a file's unified-diff patch body, keyed by a digest of the patch text itself
//                     (`sha256:<hex>`). Not the head blob sha: one new file has a different patch
//                     against a different base.
//   diffdoc:v<version>:<digest>
//                   - the segment descriptors a patch cuts into, for one diff-document version
//                     (written beside the patch, so a topology read parses nothing)
export const patchBlobKey = (digest: string) => `patch:${digest}`
const diffDocumentBlobKey = (version: number, digest: string) => `diffdoc:v${version}:${digest}`

/** One changed file as a mirror stores it: its patch's digest when the host sent a patch. */
export type StoredPatchFile = Pick<DiffDocumentFile, 'path' | 'status' | 'additions' | 'deletions' | 'sha'> & {
  viewed?: boolean
  patchState: 'available' | 'unavailable'
  patchKey: string | null
}

/** Cut a patch and store its descriptors beside its body. Called where the body is written. A patch
 *  already cut is skipped: its key is its digest, and a refresh every 45 seconds would otherwise cut
 *  every file of an unchanged pull request again on the node's own thread. */
export async function writePatchDocument(
  blobs: PatchBlobStore,
  patchKey: string,
  path: string,
  patch: string,
): Promise<void> {
  const key = diffDocumentBlobKey(DIFF_DOCUMENT_VERSION, patchKey)
  if ((await blobs.get(key)) != null) return
  const doc = fileDocument(path, patch)
  await blobs.put(key, JSON.stringify(doc.descriptors))
}

/** The parsed patch, or null when its body is not in the blob cache. */
async function patchDocument(blobs: PatchBlobStore, patchKey: string, path: string): Promise<FileDocument | null> {
  const held = parsed.get(patchKey)
  if (held) return held
  const patch = await blobs.get(patchBlobKey(patchKey))
  if (patch == null) return null
  const doc = fileDocument(path, patch)
  parsed.set(patchKey, doc)
  return doc
}

/** A patch's segment descriptors: from their blob, or cut from the body and stored for next time,
 *  which is how a mirror written before documents existed catches up. Null when the body is missing. */
async function descriptorsFor(
  blobs: PatchBlobStore,
  patchKey: string,
  path: string,
): Promise<DiffSegmentDescriptor[] | null> {
  const key = diffDocumentBlobKey(DIFF_DOCUMENT_VERSION, patchKey)
  const stored = await blobs.get(key)
  if (stored != null) return JSON.parse(stored) as DiffSegmentDescriptor[]
  const doc = await patchDocument(blobs, patchKey, path)
  if (!doc) return null
  await blobs.put(key, JSON.stringify(doc.descriptors))
  return doc.descriptors
}

export type TopologyResult = { ok: true; document: DiffDocumentTopology } | { ok: false; missing: number }

/** The document over files already in provider order. A missing patch body is an integrity failure,
 *  the same one `readFiles` reports, and the caller repairs it with a refresh. */
export async function topologyOf(blobs: PatchBlobStore, files: readonly StoredPatchFile[]): Promise<TopologyResult> {
  let missing = 0
  const read = async (file: StoredPatchFile): Promise<DiffDocumentFile> => {
    const available = file.patchState === 'available' && file.patchKey != null
    const segments = available ? await descriptorsFor(blobs, file.patchKey!, file.path) : []
    if (available && !segments) missing++
    return {
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      sha: file.sha,
      viewed: file.viewed ?? false,
      patchKey: available && segments ? file.patchKey : null,
      segments: segments ?? [],
    }
  }
  const out: DiffDocumentFile[] = []
  for (let start = 0; start < files.length; start += READ_CONCURRENCY)
    out.push(...(await Promise.all(files.slice(start, start + READ_CONCURRENCY).map(read))))
  return missing ? { ok: false, missing } : { ok: true, document: documentTopology(out) }
}

export type SegmentsResult =
  | { ok: true; segments: DiffSegmentPayload[] }
  | { ok: false; status: 404 | 400; error: string }

/** The rows of the segments asked for, in request order. A body that is gone, or an ordinal the
 *  patch does not have, fails the request rather than answering rows from something else. */
export async function segmentsOf(
  blobs: PatchBlobStore,
  requests: readonly DiffSegmentRequest[],
): Promise<SegmentsResult> {
  const out: DiffSegmentPayload[] = []
  for (const request of requests) {
    const doc = await patchDocument(blobs, request.patchKey, request.path)
    if (!doc) return { ok: false, status: 404, error: 'segment_not_found' }
    const rows = doc.segments[request.ordinal]
    if (!rows) return { ok: false, status: 400, error: 'bad_ordinal' }
    out.push({ ...request, rows })
  }
  return { ok: true, segments: out }
}

/** One page of matches over these files' patches. Null for a cursor this node did not write. */
export async function searchPatches(
  blobs: PatchBlobStore,
  files: readonly { path: string; patchKey: string | null }[],
  request: DiffSearchRequest,
): Promise<DiffSearchPage | null> {
  return searchDocument(
    files,
    async (file) => (await patchDocument(blobs, file.patchKey, file.path))?.segments ?? [],
    request,
  )
}
