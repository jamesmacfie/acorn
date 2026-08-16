import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { schedulesRoute, scheduleRoute, scheduleRunNowRoute, scheduleRunsRoute } from '@acorn/protocol/api.ts'
import {
  describeCadence,
  type ScheduleRow,
  type ScheduleRun,
  type ScheduleStatus,
  type SchedulesResponse,
} from '@acorn/protocol/schedules.ts'
import { readJson, sendJson, writeJson } from '../apiClient'
import { formatRelativeTime } from '../lib/formatRelativeTime'
import { activeNodeId } from '../node/activeNode'
import { nodes } from '../node/fleet'
import { Alert, Badge, Button, Checkbox, ConfirmButton, Row, Select, StatusDot } from '../ui/primitives'
import './settings.css'

// Settings → Schedules (docs/schedules.md): every piece of periodic work this node owns, in one list,
// whoever declared it.
//
// Per NODE, with the same picker as Settings → Plugins and Security, and for the same reason: a
// schedule is a promise one machine makes. Rolling two nodes' schedules into one list would imply a
// fleet-wide scheduler, which is exactly the thing the design refuses.
//
// Three verbs and no wizard. There is deliberately no "new schedule" form yet: nothing on this node can
// run a user-created target, so a form here would be a create button that always fails. It arrives with
// the targets (docs/schedules.md § Targets), and the list already renders a user row inert if one
// exists — a row written by a newer version says so rather than disappearing.

const OWNER_TONE = { core: 'neutral', plugin: 'accent', user: 'add' } as const

const STATUS_TONE: Record<ScheduleStatus, 'ok' | 'bad' | 'warn' | 'muted'> = {
  ok: 'ok',
  error: 'bad',
  timeout: 'bad',
  skipped: 'muted',
}

/** The forward-looking half of formatRelativeTime, which only speaks about the past. Kept local: one
 *  call site, and "in 3h" is not a vocabulary the rest of the app has asked for. */
function formatWhen(at: number | undefined, now: number): string {
  if (at === undefined) return '—'
  const delta = at - now
  if (delta <= 0) return 'due now'
  if (delta < 60_000) return 'in under a minute'
  if (delta < 60 * 60_000) return `in ${Math.round(delta / 60_000)}m`
  if (delta < 24 * 60 * 60_000) return `in ${Math.round(delta / (60 * 60_000))}h`
  return `in ${Math.round(delta / (24 * 60 * 60_000))}d`
}

export default function SchedulesSettings() {
  const qc = useQueryClient()
  const [target, setTarget] = createSignal<string | null>(null)
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal('')
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const nodeId = () => target() ?? activeNodeId()
  const node = () => nodes().find((candidate) => candidate.nodeId === nodeId()) ?? null

  const schedules = createQuery(() => ({
    queryKey: ['schedules', nodeId()],
    queryFn: () => readJson<SchedulesResponse>(schedulesRoute, { nodeId: nodeId() ?? undefined }),
    // The list is a clock face: next-run times drift out of date just by sitting there.
    refetchInterval: 30_000,
  }))

  const runs = createQuery(() => ({
    queryKey: ['schedule-runs', nodeId(), expanded()],
    enabled: expanded() !== null,
    queryFn: () => readJson<ScheduleRun[]>(scheduleRunsRoute(expanded()!), { nodeId: nodeId() ?? undefined }),
  }))

  const rows = createMemo(() => schedules.data?.schedules ?? [])
  const paused = () => schedules.data?.paused ?? false
  const invalidate = () => qc.invalidateQueries({ queryKey: ['schedules', nodeId()] })

  // Every verb is the same three steps — name what is busy, do it, refresh — so they share one wrapper
  // rather than each growing its own try/catch and its own spinner flag.
  const act = async (label: string, work: () => Promise<unknown>): Promise<void> => {
    setError('')
    setBusy(label)
    try {
      await work()
      await invalidate()
      await qc.invalidateQueries({ queryKey: ['schedule-runs', nodeId()] })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy('')
    }
  }

  const setPaused = (next: boolean) =>
    act('pause', () => writeJson(schedulesRoute, { method: 'PATCH', body: JSON.stringify({ paused: next }), headers: { 'content-type': 'application/json' }, nodeId: nodeId() ?? undefined }))

  const setEnabled = (row: ScheduleRow, enabled: boolean) =>
    act(row.key, () =>
      writeJson(scheduleRoute(row.key), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
        nodeId: nodeId() ?? undefined,
      }),
    )

  const runNow = (row: ScheduleRow) =>
    act(row.key, () => sendJson(scheduleRunNowRoute(row.key), { method: 'POST', nodeId: nodeId() ?? undefined }))

  const remove = (row: ScheduleRow) =>
    act(row.key, () => sendJson(scheduleRoute(row.key), { method: 'DELETE', nodeId: nodeId() ?? undefined }))

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

      <p class="muted">
        Work <strong>{node()?.label ?? 'this node'}</strong> does on its own, whether or not anyone is
        looking. Acorn, a plugin, or you can declare a schedule; only ones you created can be deleted —
        pause the rest.
      </p>

      <Show when={error()}><Alert>{error()}</Alert></Show>

      {/* The kill switch. Deliberately above the list and phrased as what it does, because the moment
          you want it is the moment you do not want to read about it. */}
      <Checkbox
        class="settings-field-row"
        switch
        label="Pause every schedule on this node"
        hint="Stops the loop without changing any schedule. Nothing runs until you turn this off."
        checked={paused()}
        disabled={busy() === 'pause'}
        onChange={(event) => void setPaused(event.currentTarget.checked)}
      />

      <Show when={schedules.isSuccess && rows().length === 0}>
        <p class="muted">This node has no schedules.</p>
      </Show>

      <For each={rows()}>
        {(row) => {
          const now = Date.now()
          return (
            <>
              <Row
                variant="stacked"
                reveal
                leading={<StatusDot tone={row.enabled && row.registered ? STATUS_TONE[row.lastStatus ?? 'ok'] : 'muted'} label={row.lastStatus ?? 'never run'} />}
                trailing={
                  <>
                    <Button size="sm" disabled={busy() === row.key || !row.registered} onClick={() => void runNow(row)}>
                      Run now
                    </Button>
                    <Button size="sm" disabled={busy() === row.key} onClick={() => void setEnabled(row, !row.enabled)}>
                      {row.enabled ? 'Pause' : 'Resume'}
                    </Button>
                    <Show when={row.owner === 'user'}>
                      <ConfirmButton size="sm" tone="danger" disabled={busy() === row.key} onConfirm={() => void remove(row)}>
                        Delete
                      </ConfirmButton>
                    </Show>
                  </>
                }
              >
                <span class="settings-label">
                  {row.name}{' '}
                  <Badge size="xs" tone={OWNER_TONE[row.owner]}>{row.owner === 'plugin' ? row.pluginId : row.owner}</Badge>
                  {/* The consent taken at creation stays visible for the schedule's whole life. */}
                  <Show when={row.risk}>{(risk) => <Badge size="xs" tone="warn">{risk()}</Badge>}</Show>
                </span>
                <span class="muted">
                  {describeCadence(row.cadence)}
                  <Show when={row.declaredCadence}>{(declared) => <> · declared {describeCadence(declared())}</>}</Show>
                  {' · '}
                  {row.enabled ? `next ${formatWhen(row.nextRunAt, now)}` : 'paused'}
                  <Show when={row.lastRunAt}>{(last) => <> · last run {formatRelativeTime(last(), now)}</>}</Show>
                  {' · '}
                  <button type="button" class="shortcut-reset" onClick={() => setExpanded(expanded() === row.key ? null : row.key)}>
                    {expanded() === row.key ? 'hide runs' : 'runs'}
                  </button>
                </span>
                {/* Honest about the two ways a row can be listed but unrunnable, because both look like
                    "it just stopped working" from the outside. */}
                <Show when={!row.registered}>
                  <span class="muted">
                    {row.owner === 'user'
                      ? 'This version of acorn cannot run this schedule. Its settings and history are kept.'
                      : 'Nothing declares this schedule right now — its plugin is disabled or gone. Its settings and history are kept.'}
                  </span>
                </Show>
                <Show when={row.lastError}>{(message) => <span class="settings-error">{message()}</span>}</Show>
                <Show when={row.backoffUntil !== undefined && row.backoffUntil > now ? row.backoffUntil : undefined}>
                  {(until) => <span class="muted">Backed off after repeated failures — next attempt {formatWhen(until(), now)}.</span>}
                </Show>
              </Row>
              <Show when={expanded() === row.key}>
                <div class="settings-field" style={{ 'padding-left': 'var(--space-8)' }}>
                  <Show when={(runs.data ?? []).length > 0} fallback={<span class="muted">No runs recorded yet.</span>}>
                    <For each={runs.data ?? []}>
                      {(run) => (
                        <span class="muted">
                          {formatRelativeTime(run.startedAt, now)} · {run.status}
                          <Show when={run.detail}>{(detail) => <> · {detail()}</>}</Show>
                        </span>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
            </>
          )
        }}
      </For>
    </div>
  )
}
