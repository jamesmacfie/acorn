// Keys for the on-disk blob cache (docs/caching.md § Immutable blob cache).
//   patch:<digest>  - a PR file's unified-diff patch body, keyed by a digest of the patch text itself
//                     (`sha256:<hex>`, written by the github plugin's prMirror.mirrorFiles). Not the
//                     head blob sha: one new file has a different patch against a different base.
//   filebody:<sha>  - a full file body at a blob sha (written by pullBlob for context expansion)
//   diffdoc:v<version>:<digest>
//                   - the segment descriptors a patch cuts into, for one diff-document version
//                     (written beside the patch by the github plugin, so a topology read parses nothing)
export const patchBlobKey = (digest: string) => `patch:${digest}`
export const fileBodyBlobKey = (sha: string) => `filebody:${sha}`
export const diffDocumentBlobKey = (version: number, digest: string) => `diffdoc:v${version}:${digest}`
