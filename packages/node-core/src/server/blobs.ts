// Keys for the on-disk blob cache (docs/caching.md § Immutable blob cache).
//   patch:<sha>    - a PR file's unified-diff patch body (written by prMirror.mirrorFiles)
//   filebody:<sha> - a full file body at a blob sha (written by pullBlob for context expansion)
export const patchBlobKey = (sha: string) => `patch:${sha}`
export const fileBodyBlobKey = (sha: string) => `filebody:${sha}`
