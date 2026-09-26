import {
  DIFF_DOCUMENT_VERSION, documentCache, documentTopology, fileDocument, searchDocument,
  type DiffDocumentFile, type DiffDocumentTopology, type DiffSearchPage, type DiffSearchRequest, type DiffSegmentDescriptor,
  type DiffSegmentPayload, type DiffSegmentRequest, type FileDocument,
} from '@acorn/diff-document/document'
import { diffDocumentBlobKey, patchBlobKey } from '@acorn/plugin-api/node'
import type { PullFile } from '../../../shared/api'
import { mapLimited } from '../../mapLimited'
import type { PatchBlobStore } from './prMirror'

// GitHub's diffs as documents (docs/github-integration.md § Diff documents). Everything here is keyed
// by the patch's own digest, the same `sha256:<hex>` its body is stored under, so it serves a pull
// request and a compare preview alike and can never hand one revision's rows to another.
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

/** Cut a patch and store its descriptors beside its body. Called where the body is written. A patch
 *  already cut is skipped: its key is its digest, and a refresh every 45 seconds would otherwise cut
 *  every file of an unchanged pull request again on the node's own thread. */
export async function writePatchDocument(blobs: PatchBlobStore, patchKey: string, path: string, patch: string): Promise<void> {
  const key = diffDocumentBlobKey(DIFF_DOCUMENT_VERSION, patchKey)
  if (await blobs.get(key) != null) return
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
async function descriptorsFor(blobs: PatchBlobStore, patchKey: string, path: string): Promise<DiffSegmentDescriptor[] | null> {
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
export async function topologyOf(blobs: PatchBlobStore, files: readonly PullFile[]): Promise<TopologyResult> {
  let missing = 0
  const out = await mapLimited([...files], READ_CONCURRENCY, async (file): Promise<DiffDocumentFile> => {
    const available = file.patchState === 'available' && file.patchKey != null
    const segments = available ? await descriptorsFor(blobs, file.patchKey!, file.path) : []
    if (available && !segments) missing++
    return {
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      sha: file.sha,
      viewed: file.viewed,
      patchKey: available && segments ? file.patchKey : null,
      segments: segments ?? [],
    }
  })
  return missing ? { ok: false, missing } : { ok: true, document: documentTopology(out) }
}

export type SegmentsResult = { ok: true; segments: DiffSegmentPayload[] } | { ok: false; status: 404 | 400; error: string }

/** The rows of the segments asked for, in request order. A body that is gone, or an ordinal the
 *  patch does not have, fails the request rather than answering rows from something else. */
export async function segmentsOf(blobs: PatchBlobStore, requests: readonly DiffSegmentRequest[]): Promise<SegmentsResult> {
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
  return searchDocument(files, async (file) => (await patchDocument(blobs, file.patchKey, file.path))?.segments ?? [], request)
}
