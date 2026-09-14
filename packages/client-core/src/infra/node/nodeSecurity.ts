import type { QueryClient } from '@tanstack/solid-query'
import {
  coreAuditRoute,
  coreBackupRoute,
  coreOnePasswordRoute,
  coreSecurityRoute,
  type AuditPage,
  type BackupResult,
  type BackupSuggestion,
  type NodeSecurityPosture,
  type OnePasswordStatus,
} from '@acorn/protocol/api.ts'
import { readJson, writeJson } from './apiClient'
import { pushNotice } from '../../features/notifications/notifications'
import { readDevicePrefs } from '../persistence/devicePrefs'
import { PrefKeys } from '../persistence/prefKeys'
import { savePref } from '../../features/settings/savePref'

// Settings → Security's reads, addressed at a named node (docs/security.md § Audit, § Filesystem and
// backup). The audit trail and the disk-encryption answer are facts about one machine, so a fleet-wide
// roll-up would mislead.
//
// Plain functions rather than query-options factories, because neither answer is cached anywhere else.
// Adding them to the shared QueryClient would put a per-node value under a key the fan-out rules
// govern (docs/caching.md § Fan-out cache safety), for no reader.

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

// --- 1Password (docs/security.md § Credential handling) ---
//
// Whether `op` is runnable is a fact about one machine, like the disk-encryption answer above, so it
// is addressed at a node and asked for rather than cached. Whether to *use* it, and for how long to
// keep a value, are preferences and go through /prefs like every other one.

export function onePasswordStatus(nodeId?: string): Promise<OnePasswordStatus> {
  return readJson<OnePasswordStatus>(coreOnePasswordRoute, nodeId ? { nodeId } : {})
}

export function forgetOnePasswordCache(nodeId?: string): Promise<{ ok: boolean }> {
  return writeJson<{ ok: boolean }>(
    `${coreOnePasswordRoute}/refresh`,
    { method: 'POST', ...(nodeId ? { nodeId } : {}) },
    (res) => `1password refresh ${res.status}`,
  )
}

// --- Backup (docs/data-layer.md § Backup and import) ---

// Where the node suggests writing the archive. Asked rather than composed here, because the path is on
// the node's filesystem and a client cannot know its home directory. A native save dialog would pick a
// path on the wrong machine for any node but the local one.
export function suggestedBackupPath(nodeId?: string): Promise<BackupSuggestion> {
  return readJson<BackupSuggestion>(coreBackupRoute, nodeId ? { nodeId } : {})
}

// Errors propagate. This is an action with a button behind it, so a failure has to be shown, the same
// rule `saveDisabledNodePlugins` follows.
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

// --- The one-time disk-encryption warning (docs/data-layer.md § Backup and import) ---

const ackedNodes = (): string[] => {
  try {
    const parsed = JSON.parse(readDevicePrefs()[PrefKeys.diskWarningAcked] ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return [] // a corrupt value means "not acknowledged", which errs towards showing the warning again
  }
}

// Pure, and exported for its own test. The decision maps three values onto a boolean, and getting it
// backwards means nagging forever or never warning.
export function shouldWarnAboutDisk(posture: NodeSecurityPosture, nodeId: string, acked: readonly string[]): boolean {
  // `null` means "this node cannot tell" and must not warn. Off macOS that is the honest answer for a
  // well encrypted LUKS volume, and a warning nobody can act on is one they learn to dismiss.
  if (posture.diskEncrypted !== false) return false
  return !acked.includes(nodeId)
}

// Warn once per device and node. A notice rather than a modal, because nothing is blocked by an
// unencrypted disk and docs/ui-design.md § Interaction rules reserves modal chrome for destructive
// confirmations, secret entry and agent approvals.
//
// Best-effort throughout. A node that cannot answer, or a device with no localStorage, does not warn.
// This must never fail a settings page or a boot.
export async function warnOnceAboutDisk(qc: QueryClient, nodeId: string, label: string): Promise<boolean> {
  let posture: NodeSecurityPosture
  try {
    posture = await nodeSecurityPosture(nodeId)
  } catch {
    return false
  }
  if (!shouldWarnAboutDisk(posture, nodeId, ackedNodes())) return false
  // Recorded before the notice, so a render that throws downstream cannot turn "once" into "every
  // boot".
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
