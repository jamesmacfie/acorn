import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import type { AuditEntry } from '@acorn/protocol/api.ts'
import { nodeAuditPage } from '../../infra/node/nodeSecurity'
import { Alert, Button, EmptyState } from '../../kit/components/primitives'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import './settings.css'

// Settings → Audit log (docs/security.md § Audit): the security-relevant actions one node recorded,
// newest first. Split out of Security and backup, whose other half is about the disk and the archive.
//
// Per node, following the settings header's node switcher. Rolling two nodes' trails into one list
// would put two independent `at` sequences in one column and imply an ordering nothing guarantees.
//
// Read-only, with no "clear the log" button: an append-only table with a 90-day prune is the design, and
// a control that could empty it would make the trail worth less than the prune already makes it.

const PAGE = 50

// Core's actions are a closed set on the node (server/audit.ts). Rendering the raw dotted verb would be
// honest but unreadable; a lookup with a passthrough default is both, and a new action added on the node
// shows up as itself rather than disappearing.
//
// A plugin's verbs are not here. They are qualified `<pluginId>:<action>` and arrive with the page as
// `vocabulary`, because they come from parsed manifests and a shell built before the plugin existed
// cannot have a label for them. Same passthrough rule: an unknown verb draws as itself, which is what a
// row written by a plugin that has since been removed should look like.
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
}

// A device is named by what it was called when it paired, which `device.paired` records in its
// details. A device whose pairing is not in the rows read so far is "a device": its raw id told the
// owner nothing. Naming a revoked device whose pairing has aged out needs the node to keep its name.
type DeviceNames = ReadonlyMap<string, string>

const deviceName = (names: DeviceNames, id: string | null | undefined): string => (id && names.get(id)) || 'a device'

const describeActor = (entry: AuditEntry, names: DeviceNames): string => {
  if (entry.actor === 'device') return deviceName(names, entry.actorId)
  if (entry.actor === 'internal') return 'an agent'
  return 'this node'
}

const describeSubject = (entry: AuditEntry, names: DeviceNames): string | undefined => {
  if (!entry.subject) return undefined
  return entry.action.startsWith('device.') ? deviceName(names, entry.subject) : entry.subject
}

// The name a pairing recorded is already the row's subject, so it is not repeated here.
const describeDetails = (entry: AuditEntry): string =>
  Object.entries(entry.details ?? {})
    .filter(([key]) => !(entry.action === 'device.paired' && key === 'name'))
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ')

export default function AuditLogSettings(props: { nodeId: string | null }) {
  // Accumulated across pages rather than replaced, so "Load older" appends. Reset by the resource below
  // whenever the node changes, because a trail from the previous machine under the new one's heading
  // would be exactly the lie this page exists to prevent.
  const [older, setOlder] = createSignal<AuditEntry[]>([])
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [error, setError] = createSignal('')

  // What the running plugins call their own verbs, read off the first page. Held apart from the rows so
  // switching nodes re-reads it: two nodes can have different plugins installed, and labelling one
  // node's rows with another's vocabulary is the kind of small lie this page exists to prevent.
  const [pluginLabels, setPluginLabels] = createSignal<Record<string, string>>({})

  const [firstPage, { refetch }] = createResource<AuditEntry[], string>(
    () => props.nodeId ?? '',
    async (id) => {
      setOlder([])
      setPluginLabels({})
      if (!id) return []
      setError('')
      // Caught into the page's error rather than thrown, because a resource that failed throws again
      // wherever it is read, and an offline node would take the whole page down with it.
      try {
        const page = await nodeAuditPage({ nodeId: id, limit: PAGE })
        setPluginLabels(Object.fromEntries((page.vocabulary ?? []).map((entry) => [entry.action, entry.label])))
        return page.entries
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
        return []
      }
    },
    { initialValue: [] },
  )

  const label = (action: string): string => ACTION_LABELS[action] ?? pluginLabels()[action] ?? action

  const rows = () => [...firstPage(), ...older()]
  const deviceNames = createMemo((): DeviceNames => new Map(rows().flatMap((entry) =>
    entry.action === 'device.paired' && entry.subject && typeof entry.details?.name === 'string' ? [[entry.subject, entry.details.name] as const] : [])))

  const loadOlder = async () => {
    const last = rows().at(-1)
    if (!last) return
    setError('')
    setLoadingMore(true)
    try {
      const page = await nodeAuditPage({ nodeId: props.nodeId ?? undefined, before: last.at, limit: PAGE })
      setOlder((prev) => [...prev, ...page.entries])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <SettingsSection
      id="trail"
      label="Recent activity"
      help="Pairings, revoked devices, credential changes, trusted repo settings, and plugin changes on this node. Entries are kept for 90 days."
      actions={<Button size="sm" disabled={firstPage.loading} onPress={() => void refetch()}>Refresh</Button>}
    >
      <Show when={error()}><Alert>{error()}</Alert></Show>
      <Show when={firstPage.loading && !rows().length}><EmptyState busy align="start" size="sm">Loading…</EmptyState></Show>
      {/* An empty trail is a real state on a fresh node, and saying so beats rendering nothing — which
          reads as a page that failed to load. */}
      <Show when={!firstPage.loading && !rows().length && !error()}>
        <EmptyState align="start" size="sm">Nothing recorded on this node.</EmptyState>
      </Show>

      <ul class="audit-list">
        <For each={rows()}>
          {(entry) => (
            <li class="audit-row">
              <span class="audit-action">{label(entry.action)}</span>
              <span class="audit-meta">
                {new Date(entry.at).toLocaleString()} · by {describeActor(entry, deviceNames())}
                <Show when={describeSubject(entry, deviceNames())}>{(subject) => <> · {subject()}</>}</Show>
                <Show when={describeDetails(entry)}>{(details) => <> · {details()}</>}</Show>
              </span>
            </li>
          )}
        </For>
      </ul>

      {/* Only when a full page came back: a short page IS the end of the trail, and offering "load
          older" there would be a button that does nothing. */}
      <Show when={rows().length >= PAGE}>
        <div class="settings-actions">
          <Button size="sm" disabled={loadingMore()} onPress={() => void loadOlder()}>Load older</Button>
        </div>
      </Show>
    </SettingsSection>
  )
}
