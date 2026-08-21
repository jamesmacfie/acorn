import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  scheduleConfirmRoute,
  schedulesRoute,
  scheduleRoute,
  scheduleRunNowRoute,
  scheduleRunsRoute,
  scheduleTargetsRoute,
  type ToolRisk,
} from '@acorn/protocol/api.ts'
import {
  type Cadence,
  describeCadence,
  type ScheduleRow,
  type ScheduleRun,
  type ScheduleStatus,
  type SchedulesResponse,
  type ScheduleTargetOption,
  type ScheduleTargetsResponse,
} from '@acorn/protocol/schedules.ts'
import { readJson, sendJson, writeJson } from '../apiClient'
import { formatRelativeTime } from '../lib/formatRelativeTime'
import { activeNodeId } from '../node/activeNode'
import { nodes } from '../node/fleet'
import { Alert, Badge, Button, Checkbox, ConfirmButton, Input, Row, Select, StatusDot } from '../ui/primitives'
import './settings.css'

// Settings → Schedules, per node (docs/schedules.md § Settings): every piece of periodic work this
// node owns, in one list, whoever declared it. The arming confirmation for a schedule's risk tier is
// taken once at creation, drawn by the host, and cannot be talked out of asking.

const OWNER_TONE = { core: 'neutral', plugin: 'accent', user: 'add' } as const

/** What the arming strip says about each tier, in the register a person would use. The vocabulary is
 *  `ToolRisk` (docs/schedules.md § Settings), the same three the agent-tool permission surface
 *  already projects, so a person meets one scale for "how dangerous is this". */
const RISK_COPY: Record<ToolRisk, string> = {
  read: 'only reads. It will run unattended from now on.',
  write: 'changes data on this machine. It will run unattended, with nobody to confirm it.',
  execute: 'runs commands on this machine. It will run unattended, with nobody to confirm it.',
}

/** The three cadences the creation form offers, spelled as the vocabulary rather than as a parser.
 *  Retuning to anything else is the row's own cadence control; this is the set worth a first choice. */
const CADENCE_CHOICES = [
  { id: 'hourly', label: 'Every hour', cadence: { every: 3600 } satisfies Cadence },
  { id: 'daily', label: 'Every day at 09:00', cadence: { daily: '09:00' } satisfies Cadence },
  { id: 'weekly', label: 'Every Monday at 09:00', cadence: { weekly: { day: 1, at: '09:00' } } satisfies Cadence },
] as const

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

  // What this node can run, for the picker. Separate from the list because it answers a different
  // question, "what could be scheduled" rather than "what is", and because it changes only when a
  // plugin comes or goes, so it has no business on the list's 30-second clock.
  const targets = createQuery(() => ({
    queryKey: ['schedule-targets', nodeId()],
    queryFn: () => readJson<ScheduleTargetsResponse>(scheduleTargetsRoute, { nodeId: nodeId() ?? undefined }),
  }))

  const runs = createQuery(() => ({
    queryKey: ['schedule-runs', nodeId(), expanded()],
    enabled: expanded() !== null,
    queryFn: () => readJson<ScheduleRun[]>(scheduleRunsRoute(expanded()!), { nodeId: nodeId() ?? undefined }),
  }))

  const rows = createMemo(() => schedules.data?.schedules ?? [])
  const paused = () => schedules.data?.paused ?? false
  const invalidate = () => qc.invalidateQueries({ queryKey: ['schedules', nodeId()] })

  // Every verb is the same three steps: name what is busy, do it, refresh. So they share one wrapper
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

  // Re-take consent after a tier rise. No tier is sent: the node re-stamps from its own registry, so
  // what the owner accepts is always the tier the strip above just showed them.
  const reconfirm = (row: ScheduleRow) =>
    act(row.key, () => sendJson(scheduleConfirmRoute(row.key), { method: 'POST', nodeId: nodeId() ?? undefined }))

  // ── The creation form ─────────────────────────────────────────────────────────────────────────
  const [chosen, setChosen] = createSignal('')
  const [newName, setNewName] = createSignal('')
  const [cadenceId, setCadenceId] = createSignal<string>(CADENCE_CHOICES[0].id)
  const options = () => targets.data?.targets ?? []
  const optionKey = (option: ScheduleTargetOption) => `${option.pluginId}:${option.actionId}`
  const selected = () => options().find((option) => optionKey(option) === chosen())

  const create = async (): Promise<void> => {
    const option = selected()
    if (!option) return
    await act('create', () =>
      sendJson(schedulesRoute, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: newName().trim() || option.name,
          kind: option.kind,
          target: { pluginId: option.pluginId, actionId: option.actionId },
          cadence: (CADENCE_CHOICES.find((choice) => choice.id === cadenceId()) ?? CADENCE_CHOICES[0]).cadence,
        }),
        nodeId: nodeId() ?? undefined,
      }),
    )
    setChosen('')
    setNewName('')
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

      {/* Only rendered when there is something to offer. An empty picker is a create button that
          always fails, and saying "nothing here can be scheduled" is the more useful sentence. */}
      <h3 class="settings-heading">New schedule</h3>
      <Show
        when={targets.isSuccess && options().length > 0}
        fallback={<Show when={targets.isSuccess}><p class="muted">Nothing installed on this node offers an action you can put on a schedule.</p></Show>}
      >
        <label class="settings-field">
          <span>Action</span>
          <Select value={chosen()} onChange={(event) => setChosen(event.currentTarget.value)}>
            <option value="">Pick something to run…</option>
            <For each={options()}>
              {(option) => <option value={optionKey(option)}>{option.name} · {option.pluginId}</option>}
            </For>
          </Select>
        </label>

        {/* The arming strip. Host-drawn from the node's declared tier, shown BEFORE the create button
            exists, and impossible to skip — accepting it is what the create posts. */}
        <Show when={selected()}>
          {(option) => (
            <>
              <Alert tone="warn">
                <strong>{option().pluginId}</strong>’s “{option().name}” {RISK_COPY[option().risk]}{' '}
                You are agreeing to this once, now — a scheduled run never asks again.
              </Alert>
              <label class="settings-field">
                <span>Name</span>
                <Input
                  value={newName()}
                  placeholder={option().name}
                  onInput={(event) => setNewName(event.currentTarget.value)}
                />
              </label>
              <label class="settings-field">
                <span>When</span>
                <Select value={cadenceId()} onChange={(event) => setCadenceId(event.currentTarget.value)}>
                  <For each={CADENCE_CHOICES}>{(choice) => <option value={choice.id}>{choice.label}</option>}</For>
                </Select>
              </label>
              <Row
                variant="stacked"
                trailing={
                  <Button size="sm" disabled={busy() === 'create'} onClick={() => void create()}>
                    Accept and schedule
                  </Button>
                }
              >
                <span class="muted">
                  Runs {describeCadence((CADENCE_CHOICES.find((choice) => choice.id === cadenceId()) ?? CADENCE_CHOICES[0]).cadence)},
                  at the <Badge size="xs" tone="warn">{option().risk}</Badge> tier.
                </span>
              </Row>
            </>
          )}
        </Show>
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
                  <Show when={row.risk}>{(risk) => <> <Badge size="xs" tone="warn">{risk()}</Badge></>}</Show>
                </span>
                <span class="muted">
                  {describeCadence(row.cadence)}
                  <Show when={row.declaredCadence}>{(declared) => <> · declared {describeCadence(declared())}</>}</Show>
                  {' · '}
                  {row.enabled ? `next ${formatWhen(row.nextRunAt, now)}` : 'paused'}
                  <Show when={row.lastRunAt}>{(last) => <> · last run {formatRelativeTime(last(), now)}</>}</Show>
                  {' · '}
                  <Button variant="bare" class="schedule-runs" onClick={() => setExpanded(expanded() === row.key ? null : row.key)}>
                    {expanded() === row.key ? 'hide runs' : 'runs'}
                  </Button>
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
                {/* The re-arm. A schedule whose target now declares MORE than the tier stamped on it
                    fails closed on every run, and stays that way until someone agrees to the new one —
                    which is the same act as creating it, so it gets the same host-drawn strip. */}
                <Show when={row.owner === 'user' && row.lastStatus === 'skipped' && row.lastError?.startsWith('risk changed')}>
                  <Row
                    variant="stacked"
                    trailing={
                      <Button size="sm" disabled={busy() === row.key} onClick={() => void reconfirm(row)}>
                        Accept the new tier
                      </Button>
                    }
                  >
                    <span class="muted">
                      You agreed to <Badge size="xs" tone="warn">{row.risk}</Badge> when you made this. It now
                      asks for more, so nothing has run since.
                    </span>
                  </Row>
                </Show>
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
