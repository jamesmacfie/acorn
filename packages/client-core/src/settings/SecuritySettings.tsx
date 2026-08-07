import { createResource, createSignal, For, Show } from 'solid-js'
import type { AuditEntry, NodeSecurityPosture } from '@acorn/protocol/api.ts'
import { activeNodeId } from '../node/activeNode'
import { nodes } from '../node/fleet'
import { nodeAuditPage, nodeSecurityPosture } from '../node/nodeSecurity'
import { Button, Select } from '../ui/primitives'
import './settings.css'

// Settings → Security (docs/vNext/security.md § Audit: "Owner-readable in Settings"; § On-disk: "the app
// warns once if the disk isn't encrypted").
//
// Per NODE, with the same picker as Settings → Plugins and for the same reason: both answers are facts
// about one machine. "Is the disk encrypted" is not a property a fleet has, and rolling the two nodes'
// audit trails into one list would put two independent `at` sequences in one column and imply an ordering
// across machines that nothing guarantees.
//
// Read-only. There is deliberately no "clear the log" button: an append-only table with a 90-day prune is
// the design, and a control that could empty it would make the trail worth less than the prune already
// makes it.

const PAGE = 50

// Actions are a closed set on the node (server/audit.ts). Rendering the raw dotted verb would be honest
// but unreadable; a lookup with a passthrough default is honest AND readable, and a new action added on
// the node shows up as itself rather than disappearing.
const ACTION_LABELS: Record<string, string> = {
  'pairing.window.opened': 'Pairing window opened',
  'pairing.window.closed': 'Pairing window closed',
  'device.paired': 'Device paired',
  'device.revoked': 'Device revoked',
  'secret.created': 'Credential connected',
  'secret.replaced': 'Credential replaced',
  'secret.deleted': 'Credential removed',
  'config.trusted': 'Repo config trusted',
  'plugins.disabled.changed': 'Plugins changed',
  'backup.created': 'Backup created',
  'import.v1': 'Imported V1 configuration',
}

const describeActor = (entry: AuditEntry): string => {
  if (entry.actor === 'device') return entry.actorId ? `device ${entry.actorId.slice(0, 8)}` : 'a device'
  if (entry.actor === 'internal') return `an agent (${entry.actorId ?? 'internal'})`
  return 'this node'
}

const describeDetails = (entry: AuditEntry): string =>
  Object.entries(entry.details ?? {})
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ')

export default function SecuritySettings() {
  const [target, setTarget] = createSignal<string | null>(null)
  const nodeId = () => target() ?? activeNodeId()
  const node = () => nodes().find((candidate) => candidate.nodeId === nodeId()) ?? null
  // Accumulated across pages rather than replaced, so "Load older" appends. Reset by the resource below
  // whenever the node changes — a trail from the previous machine under the new one's heading would be a
  // lie of exactly the kind this page exists to prevent.
  const [older, setOlder] = createSignal<AuditEntry[]>([])
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [error, setError] = createSignal('')

  const [posture] = createResource<NodeSecurityPosture | null, string>(
    () => nodeId() ?? '',
    async (id) => (id ? await nodeSecurityPosture(id).catch(() => null) : null),
  )

  const [firstPage, { refetch }] = createResource<AuditEntry[], string>(
    () => nodeId() ?? '',
    async (id) => {
      setOlder([])
      if (!id) return []
      const page = await nodeAuditPage({ nodeId: id, limit: PAGE })
      return page.entries
    },
    { initialValue: [] },
  )

  const rows = () => [...firstPage(), ...older()]

  const loadOlder = async () => {
    const last = rows().at(-1)
    if (!last) return
    setError('')
    setLoadingMore(true)
    try {
      const page = await nodeAuditPage({ nodeId: nodeId() ?? undefined, before: last.at, limit: PAGE })
      setOlder((prev) => [...prev, ...page.entries])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div class="settings-section">
      <Show when={nodes().length > 1}>
        <label class="settings-field">
          <span>Node</span>
          <Select value={nodeId() ?? ''} onChange={(event) => setTarget(event.currentTarget.value || null)}>
            <For each={nodes()}>{(candidate) => <option value={candidate.nodeId}>{candidate.label}</option>}</For>
          </Select>
        </label>
      </Show>

      {/* Three states, not two. `null` means the node cannot tell — the honest answer off macOS, where a
          perfectly well encrypted LUKS volume is indistinguishable from an unencrypted one without
          guessing. Rendering that as "not encrypted" would be a confident wrong answer. */}
      <Show when={posture()}>
        {(current) => (
          <>
            <Show when={current().diskEncrypted === false}>
              <div class="settings-notice" role="alert">
                <span>
                  <strong>{node()?.label ?? 'This node'}</strong> does not have full-disk encryption turned
                  on. Acorn encrypts credentials and backup archives only — worktrees, caches, scrollback
                  and agent transcripts rely on the operating system.
                </span>
              </div>
            </Show>
            <p class="muted">
              Disk encryption:{' '}
              {current().diskEncrypted === true
                ? 'on'
                : current().diskEncrypted === false
                  ? 'off'
                  : `not detectable on ${current().platform}`}
            </p>
          </>
        )}
      </Show>

      <p class="muted">
        Security-relevant actions on <strong>{node()?.label ?? 'this node'}</strong>: pairing, device
        revocation, credential changes, repo-config trust and plugin changes. Kept for 90 days.
      </p>

      <Show when={error()}><div class="action-error" role="alert">{error()}</div></Show>
      <Show when={firstPage.loading && !rows().length}><p class="muted">Reading the audit trail…</p></Show>
      {/* An empty trail is a real state on a fresh node, and saying so beats rendering nothing — which
          reads as a page that failed to load. */}
      <Show when={!firstPage.loading && !rows().length}>
        <p class="muted">Nothing recorded yet on this node.</p>
      </Show>

      <ul class="audit-list">
        <For each={rows()}>
          {(entry) => (
            <li class="audit-row">
              <span class="audit-action">{ACTION_LABELS[entry.action] ?? entry.action}</span>
              <span class="audit-meta muted">
                {new Date(entry.at).toLocaleString()} · by {describeActor(entry)}
                <Show when={entry.subject}>{(subject) => <> · {subject()}</>}</Show>
                <Show when={describeDetails(entry)}>{(details) => <> · {details()}</>}</Show>
              </span>
            </li>
          )}
        </For>
      </ul>

      <div class="settings-actions">
        <Button size="sm" disabled={firstPage.loading} onClick={() => void refetch()}>Refresh</Button>
        {/* Only when a full page came back: a short page IS the end of the trail, and offering "load
            older" there would be a button that does nothing. */}
        <Show when={rows().length >= PAGE}>
          <Button size="sm" disabled={loadingMore()} onClick={() => void loadOlder()}>Load older</Button>
        </Show>
      </div>
    </div>
  )
}
