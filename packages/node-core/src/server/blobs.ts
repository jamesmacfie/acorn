// Keys for the on-disk BLOBS cache (docs/caching.md). Both formats key immutable content by its
// git sha, so entries never need invalidation — a sha's body can't change, only stop being
// referenced. The cache is unbounded by design (single-user machine; see docs/caching.md).
//   patch:<sha>    — a PR file's unified-diff patch body (written by prMirror.mirrorFiles)
//   filebody:<sha> — a full file body at a blob sha (written by pullBlob for context expansion)
export const patchBlobKey = (sha: string) => `patch:${sha}`
export const fileBodyBlobKey = (sha: string) => `filebody:${sha}`
