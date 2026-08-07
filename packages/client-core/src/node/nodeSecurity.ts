import type { QueryClient } from '@tanstack/solid-query'
import {
  coreAuditRoute,
  coreBackupRoute,
  coreSecurityRoute,
  type AuditPage,
  type BackupResult,
  type BackupSuggestion,
  type NodeSecurityPosture,
} from '@acorn/protocol/api.ts'
import { readJson, writeJson } from '../apiClient'
import { pushNotice } from '../notifications/notifications'
import { readDevicePrefs } from '../persistence/devicePrefs'
import { PrefKeys } from '../persistence/prefKeys'
import { savePref } from '../settings/savePref'

// Settings → Security's reads, addressed at a named node (docs/security.md § Audit, § On-disk).
//
// Node-addressed like Settings → Plugins, and for the same reason: the audit trail and the disk-encryption
// answer are facts about ONE machine. A fleet-wide roll-up would be actively misleading — "the disk is
// encrypted" is not a property a fleet has.
//
// Plain functions over a `createResource`, not query-options factories, because neither answer is cached
// anywhere else and both belong to a page that is open or not. Adding them to the shared QueryClient
// would put a per-node value under a key the fan-out rules govern (client-core/node/fanout.ts § the one
// rule that matters), for no reader.

export function nodeSecurityPosture(nodeId?: string): Promise<NodeSecurityPosture> {
  return readJson<NodeSecurityPosture>(coreSecurityRoute, nodeId ? { nodeId } : {})
}

export function nodeAuditPage(options: { nodeId?: string; before?: number; limit?: number } = {}): Promise<AuditPage> {
  const params = new URLSearchParams()
  if (options.before !== undefined) params.set('before', String(options.before))
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  const query = params.toString()
  return readJson<AuditPage>(`${coreAuditRoute}${query ? `?${query}` : ''}`, options.nodeId ? { nodeId: options.nodeId } : {})
}

// --- Backup (docs/data-layer.md § Backup) ---

// Where the NODE suggests writing the archive. Asked rather than composed on this side, because the
// path is on the node's filesystem and a client cannot know its home directory — that is also why there
// is no native save dialog: it would pick a path on the wrong machine for any node but the local one.
export function suggestedBackupPath(nodeId?: string): Promise<BackupSuggestion> {
  return readJson<BackupSuggestion>(coreBackupRoute, nodeId ? { nodeId } : {})
}

// Errors propagate. This is a deliberate action with a button behind it, so a failure has to be shown —
// the same rule `saveDisabledNodePlugins` follows and `refreshNodePlugins` deliberately does not.
export function createNodeBackup(destPath: string, nodeId?: string): Promise<BackupResult> {
  return writeJson<BackupResult>(
    coreBackupRoute,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destPath }),
      ...(nodeId ? { nodeId } : {}),
    },
    (res) => `backup ${res.status}`,
  )
}

// --- The one-time disk-encryption warning (docs/data-layer.md § Backup) ---

const ackedNodes = (): string[] => {
  try {
    const parsed = JSON.parse(readDevicePrefs()[PrefKeys.diskWarningAcked] ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return [] // a corrupt value means "not acknowledged", which errs towards showing the warning again
  }
}

// Pure, and exported for its own test: the decision is three-valued input to a boolean, and getting it
// backwards means either nagging forever or never warning at all.
export function shouldWarnAboutDisk(posture: NodeSecurityPosture, nodeId: string, acked: readonly string[]): boolean {
  // `null` — "this node cannot tell" — must NOT warn. Off macOS that is the honest answer for a
  // perfectly well encrypted LUKS volume, and a warning nobody can act on is one they learn to dismiss.
  if (posture.diskEncrypted !== false) return false
  return !acked.includes(nodeId)
}

// Warn once per (device, node). Pushed as a notice rather than a modal because it is information, not a
// decision: nothing is blocked by an unencrypted disk, and docs/ui-design.md § Prompts and notifications reserves
// modal chrome for destructive confirmations, secret entry and agent approvals.
//
// Best-effort throughout. A node that cannot answer, or a device with no localStorage, simply does not
// warn — this must never be the thing that fails a settings page or a boot.
export async function warnOnceAboutDisk(qc: QueryClient, nodeId: string, label: string): Promise<boolean> {
  let posture: NodeSecurityPosture
  try {
    posture = await nodeSecurityPosture(nodeId)
  } catch {
    return false
  }
  if (!shouldWarnAboutDisk(posture, nodeId, ackedNodes())) return false
  // Recorded BEFORE the notice, so a render that throws downstream cannot turn "once" into "every boot".
  await savePref(qc, PrefKeys.diskWarningAcked, JSON.stringify([...ackedNodes(), nodeId]), { surfaceFailure: false })
  pushNotice({
    taskId: '',
    kind: 'disk-unencrypted',
    title: `${label}: full-disk encryption is off`,
    detail:
      'Worktrees, caches and agent transcripts on that machine are stored unencrypted. Acorn encrypts credentials and backups only — everything else relies on the operating system.',
    at: Date.now(),
    nodeId,
  })
  return true
}
