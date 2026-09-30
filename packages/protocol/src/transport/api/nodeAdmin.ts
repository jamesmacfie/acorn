import type { NodeAttachment } from '../../device/node.ts'

export const prefsRoute = '/v1/core/prefs'

// Every client paired with a node, and the revoke for one of them. Device-only, like the plugin list:
// this is node administration.
export const corePairStartRoute = '/v1/core/pair/start'
export const corePairRoute = '/v1/core/pair'
export const coreDevicesRoute = '/v1/core/devices'
export const coreDeviceRoute = (deviceId: string) => `/v1/core/devices/${encodeURIComponent(deviceId)}`

// Settings → Security and backup, and Settings → Audit log (docs/security.md § Audit, § Filesystem and backup).
//
// `diskEncrypted` is three-valued. `null` means "this node can't tell", the honest answer off macOS,
// where LUKS, dm-crypt, ZFS native encryption and a dozen NAS arrangements all count. A security
// warning that cries wolf is worse than no warning.
export type NodeSecurityPosture = { diskEncrypted: boolean | null; platform: string }
export const coreSecurityRoute = '/v1/core/security'

// Settings > Storage and memory (docs/data-layer.md § What the node reports). Device-only, like
// security: sizes and memory describe the machine. `rssBytes` is the node process's own resident
// memory. Each database counts its `-wal` and `-shm` files. Disk sizes are measured at most every 30
// seconds. Worktrees are left out, because walking them costs more than the answer is worth.
export type NodeStorageReport = {
  rssBytes: number
  coreDatabaseBytes: number
  pluginDatabases: { plugin: string; bytes: number }[]
  blobCacheBytes: number
}
export const coreStorageRoute = '/v1/core/storage'

// Settings → Nodes: who this node is attached to, and the button that drops it
// (docs/node-enrollment.md § Detaching). Device-only, like devices and plugins: an attachment is
// node administration, and detaching revokes a credential.
//
// `attachment` is null on every node that never enrolled, which is the default and the majority.
// `error` is the last failed enrollment, kept so a provisioned node that could not reach its control
// plane says so instead of looking ordinary.
export type NodeAttachmentState = {
  attachment: NodeAttachment | null
  error: { at: number; reason: string } | null
}
export const coreAttachmentRoute = '/v1/core/attachment'

// Nodes this node's plugins know about (docs/plugins.md § Node providers). The client fans this out
// over every reachable node and unions the answers, so a provider running on one node is visible from
// a client sitting at another.
//
// `enrollment.deviceToken` is deliberately absent from this projection. The adopt route below is the
// only way to get one, it answers the host rather than the renderer, and that keeps "a device token
// never reaches the renderer" true for the second door as well as the first.
export const coreNodeProvidersRoute = '/v1/core/nodes'
export const coreNodeAdoptRoute = '/v1/core/nodes/adopt'
export const coreNodeLifecycleRoute = (verb: 'create' | 'destroy' | 'start' | 'stop') => `/v1/core/nodes/${verb}`

// The append-only audit trail. `details` is an allowlisted bag of scalars chosen per action: never a
// request body, a credential, or a file's contents.
export type AuditEntry = {
  id: string
  at: number
  actor: string
  actorId: string | null
  action: string
  subject: string | null
  details: Record<string, unknown> | null
}
// One plugin-declared verb, qualified `<pluginId>:<actionId>` by the node. Core's own verbs are a
// closed union the client already knows; this is the half that arrives from parsed manifests, which is
// what keeps the vocabulary enumerable now that a plugin can write to the trail.
export type AuditVocabularyEntry = { action: string; label: string }
// `nextBefore` is a timestamp cursor, not an offset. Rows are only appended and pruned from the far
// end, so an offset would skip or repeat entries whenever the 90-day prune ran under a paging reader.
//
// `vocabulary` rides on every page rather than taking a route of its own: its only reader is the list
// beside it, the two are always fetched together, and it is a few dozen short strings. Optional on the
// wire because an older node's page will not carry it.
export type AuditPage = { entries: AuditEntry[]; nextBefore: number | null; vocabulary?: AuditVocabularyEntry[] }
export const coreAuditRoute = '/v1/core/audit'

// `POST /v1/core/backup` (docs/data-layer.md § Backup). `destPath` is a path on the node's filesystem,
// which is why the client offers a native save dialog only for the local node. `excluded` is echoed
// back and written into the archive's manifest, so "why is my GitHub token gone" is answered for
// whoever restores it a year later.
export type BackupResult = { path: string; bytes: number; files: string[]; excluded: string[] }
export type BackupSuggestion = { suggestedPath: string }
export const coreBackupRoute = '/v1/core/backup'

export const prefsKey = ['prefs'] as const
