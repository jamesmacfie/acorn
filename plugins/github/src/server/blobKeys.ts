// The blob cache key this plugin writes on its own (docs/caching.md § Immutable blob cache). Patch
// bodies and their segment descriptors use the diff document store's keys (`patchBlobKey`).
//   filebody:<sha>  - a full file body at a blob sha (written by pullBlob for context expansion)
export const fileBodyBlobKey = (sha: string) => `filebody:${sha}`
