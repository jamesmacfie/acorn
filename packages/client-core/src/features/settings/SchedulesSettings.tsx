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
import { readJson, sendJson, writeJson } from '../../infra/node/apiClient'
import { formatRelativeTime } from '../../kit/lib/rendering/formatRelativeTime'
import { nodes } from '../../infra/node/fleet'
import { Alert, Badge, Button, Checkbox, EmptyState, Input, Row, Select, StatusDot } from '../../kit/components/primitives'
import { Text } from '../../kit/components/content/Text'
import { Inline } from '../../kit/components/layout/Inline'
import { Stack } from '../../kit/components/layout/Stack'
import { confirmAction } from '../../host/registries/shell/willPhase'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { createSettingSave, type SettingSave } from './settingSave'
import { pluginLabel } from '../../host/plugins/pluginLabel'
import { useUnsavedChanges } from './unsavedChanges'
import './settings.css'

// Settings → Schedules, per node and following the settings header's node switcher
// (docs/schedules/user-schedules.md § Settings): every piece of periodic work this node owns, in one list, whoever
// declared it. The arming confirmation for a schedule's risk tier is taken once at creation, drawn by
// the host, and cannot be talked out of asking.

const OWNER_TONE = { core: 'neutral', plugin: 'accent', user: 'ok' } as const
/** Who declared a schedule, as a person reads it: acorn itself, a plugin by its name, or you. */
const ownerLabel = (row: ScheduleRow): string =>
  row.owner === 'plugin' && row.pluginId ? pluginLabel(row.pluginId) : row.owner === 'core' ? 'acorn' : row.owner === 'user' ? 'You' : row.owner

/** What the arming strip says about each tier, in the register a person would use. The vocabulary is
 *  `ToolRisk` (docs/schedules/user-schedules.md § Settings), the same three the agent-tool permission surface
 *  already projects, so a person meets one scale for "how dangerous is this". */
const RISK_COPY: Record<ToolRisk, string> = {
  read: 'only reads data.',
  write: 'changes data on this node.',
  execute: 'runs commands on this node.',
}

/** The three cadences the creation form offers, spelled as the vocabulary rather than as a parser.
 *  Retuning to anything else is the row's own cadence control; this is the set worth a first choice. */
const CADENCE_CHOICES = [
  { id: 'hourly', label: 'Every hour', cadence: { every: 3600 } satisfies Cadence },
  { id: 'daily', label: 'Every day at 09:00', cadence: { daily: '09:00' } satisfies Cadence },
  { id: 'weekly', label: 'Every Monday at 09:00', cadence: { weekly: { day: 1, at: '09:00' } } satisfies Cadence },
] as const
const DEFAULT_CADENCE: string = CADENCE_CHOICES[0].id
const cadenceFor = (id: string): Cadence => (CADENCE_CHOICES.find((choice) => choice.id === id) ?? CADENCE_CHOICES[0]).cadence

const STATUS_TONE: Record<ScheduleStatus, 'ok' | 'danger' | 'warn' | 'muted'> = {
  ok: 'ok',
  error: 'danger',
  timeout: 'danger',
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

export default function SchedulesSettings(props: { nodeId: string | null }) {
  const qc = useQueryClient()
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal('')
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const nodeId = () => props.nodeId
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
  const options = () => targets.data?.targets ?? []
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

  // The two switches save on change, so a failure is said beside the switch that failed rather than
  // in the page's alert. Each resolves once the list has been read again, so the switch then shows
  // what the node holds.
  const pause = createSettingSave()
  const setPaused = (next: boolean) =>
    pause.run(async () => {
      await writeJson(schedulesRoute, { method: 'PATCH', body: JSON.stringify({ paused: next }), headers: { 'content-type': 'application/json' }, nodeId: nodeId() ?? undefined })
      await invalidate()
    })

  // Keyed by schedule rather than held by the row, because the list is read again every 30 seconds
  // and a row drawn from the new read would forget the error the old one was showing.
  const toggles = new Map<string, SettingSave>()
  const toggleFor = (key: string): SettingSave => {
    let save = toggles.get(key)
    if (!save) toggles.set(key, save = createSettingSave())
    return save
  }
  const setEnabled = (row: ScheduleRow, enabled: boolean) =>
    toggleFor(row.key).run(async () => {
      await writeJson(scheduleRoute(row.key), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
        nodeId: nodeId() ?? undefined,
      })
      await invalidate()
    })

  const runNow = (row: ScheduleRow) =>
    act(row.key, () => sendJson(scheduleRunNowRoute(row.key), { method: 'POST', nodeId: nodeId() ?? undefined }))

  // Through the shell's one confirmation, which says the run history goes too: the node deletes it with
  // the schedule (node-core/server/schedules/scheduler.ts § remove).
  const remove = async (row: ScheduleRow) => {
    const confirmed = await confirmAction({
      title: `Delete ${row.name}`,
      actionLabel: 'Delete schedule',
      goes: `${row.name} and its run history are removed from ${node()?.label ?? 'this node'}.`,
      stays: 'Anything its runs already made stays where it is. Every other schedule keeps running.',
      danger: true,
    })
    if (confirmed) await act(row.key, () => sendJson(scheduleRoute(row.key), { method: 'DELETE', nodeId: nodeId() ?? undefined }))
  }

  // Re-take consent after a tier rise. No tier is sent: the node re-stamps from its own registry, so
  // what the owner accepts is always the tier the strip above just showed them.
  const reconfirm = (row: ScheduleRow) =>
    act(row.key, () => sendJson(scheduleConfirmRoute(row.key), { method: 'POST', nodeId: nodeId() ?? undefined }))

  return (
    <>
      <Show when={error()}><Alert>{error()}</Alert></Show>
      {/* Said, rather than drawn as an empty list and a pause switch at Off, which would both be guesses. */}
      <Show when={schedules.isError}><Alert>{`Could not read this node's schedules. ${schedules.error?.message ?? ''}`.trim()}</Alert></Show>

      <SettingsSection
        id="schedules"
        label="Schedules"
        help="Jobs this node runs on a timer, even with no window open. They come from acorn, its plugins, or you. You can pause any of them and delete the ones you made."
      >
        {/* The kill switch. Deliberately above the list and phrased as what it does, because the moment
            you want it is the moment you do not want to read about it. */}
        <SettingRow
          label="Pause every schedule on this node"
          description="Nothing runs until you turn this off. Each schedule keeps its settings."
          error={pause.error()}
        >
          <Checkbox
            switch
            ariaLabel="Pause every schedule on this node"
            checked={paused()}
            disabled={!schedules.isSuccess}
            onChange={(checked) => setPaused(checked)}
          />
        </SettingRow>

        <Show when={schedules.isSuccess && rows().length === 0}>
          <EmptyState align="start" size="sm">This node has no schedules.</EmptyState>
        </Show>

        <For each={rows()}>
          {(row) => {
            const now = Date.now()
            return (
              <>
                <Row
                  variant="stacked"
                  leading={<StatusDot tone={row.enabled && row.registered ? STATUS_TONE[row.lastStatus ?? 'ok'] : 'muted'} label={row.lastStatus ?? 'never run'} />}
                  trailing={
                    <>
                      <Button size="sm" disabled={busy() === row.key || !row.registered} onPress={() => void runNow(row)}>
                        Run now
                      </Button>
                      <Checkbox
                        switch
                        size="sm"
                        ariaLabel={`Run ${row.name} on its schedule`}
                        title={row.enabled ? 'On. Turn off to pause this schedule.' : 'Paused. Turn on to resume this schedule.'}
                        checked={row.enabled}
                        disabled={busy() === row.key}
                        onChange={(checked) => setEnabled(row, checked)}
                      />
                      <Show when={row.owner === 'user'}>
                        <Button size="sm" tone="danger" disabled={busy() === row.key} onPress={() => void remove(row)}>
                          Delete…
                        </Button>
                      </Show>
                    </>
                  }
                >
                  <span class="settings-label">
                    {row.name}{' '}
                    <Badge size="xs" tone={OWNER_TONE[row.owner]}>{ownerLabel(row)}</Badge>
                    {/* The consent taken at creation stays visible for the schedule's whole life. */}
                    <Show when={row.risk}>{(risk) => <> <Badge size="xs" tone="warn">{risk()}</Badge></>}</Show>
                  </span>
                  <Inline gap="row" wrap>
                    <Text emphasis="muted" wrap>
                      {describeCadence(row.cadence)}
                      <Show when={row.declaredCadence}>{(declared) => <> · default {describeCadence(declared())}</>}</Show>
                      {' · '}
                      {row.enabled ? `next ${formatWhen(row.nextRunAt, now)}` : 'paused'}
                      <Show when={row.lastRunAt}>{(last) => <> · last run {formatRelativeTime(last(), now)}</>}</Show>
                    </Text>
                    <Button variant="ghost" size="xs" expanded={expanded() === row.key} onPress={() => setExpanded(expanded() === row.key ? null : row.key)}>
                      {expanded() === row.key ? 'Hide history' : 'History'}
                    </Button>
                  </Inline>
                  <Show when={toggleFor(row.key).error()}>{(message) => <span role="alert"><Text tone="danger" wrap>{message()}</Text></span>}</Show>
                  {/* Honest about the two ways a row can be listed but unrunnable, because both look like
                      "it just stopped working" from the outside. */}
                  <Show when={!row.registered}>
                    <Text emphasis="muted" wrap>
                      {row.owner === 'user'
                        ? "This version of acorn can't run this schedule. Its settings and history are kept."
                        : "Its plugin is off or removed, so it can't run. Its settings and history are kept."}
                    </Text>
                  </Show>
                  <Show when={row.lastError}>{(message) => <Text tone="danger" wrap>{message()}</Text>}</Show>
                  {/* The re-arm. A schedule whose target now declares MORE than the tier stamped on it
                      fails closed on every run, and stays that way until someone agrees to the new one —
                      which is the same act as creating it, so it gets the same host-drawn strip. */}
                  <Show when={row.owner === 'user' && row.lastStatus === 'skipped' && row.lastError?.startsWith('risk changed')}>
                    <Row
                      variant="stacked"
                      trailing={
                        <Button size="sm" disabled={busy() === row.key} onPress={() => void reconfirm(row)}>
                          Accept the new tier
                        </Button>
                      }
                    >
                      <Text emphasis="muted" wrap>
                        You agreed to <Badge size="xs" tone="warn">{row.risk}</Badge> when you made this. It now
                        asks for more, so nothing has run since.
                      </Text>
                    </Row>
                  </Show>
                  <Show when={row.backoffUntil !== undefined && row.backoffUntil > now ? row.backoffUntil : undefined}>
                    {(until) => <Text emphasis="muted" wrap>Failed several times in a row. Trying again {formatWhen(until(), now)}.</Text>}
                  </Show>
                </Row>
                <Show when={expanded() === row.key}>
                  <Stack gap="inline">
                    <Show when={(runs.data ?? []).length > 0} fallback={<Text emphasis="muted">No runs recorded.</Text>}>
                      <For each={runs.data ?? []}>
                        {(run) => (
                          <Text emphasis="muted" wrap>
                            {formatRelativeTime(run.startedAt, now)} · {run.status}
                            <Show when={run.detail}>{(detail) => <> · {detail()}</>}</Show>
                          </Text>
                        )}
                      </For>
                    </Show>
                  </Stack>
                </Show>
              </>
            )
          }}
        </For>
      </SettingsSection>

      <SettingsSection id="new" label="New schedule">
        {/* Only drawn when there is something to offer. An empty picker is a create button that always
            fails, and saying "nothing here can be scheduled" is the more useful sentence. */}
        <Show
          when={targets.isSuccess && options().length > 0}
          fallback={<Show when={targets.isSuccess}><EmptyState align="start" size="sm">Nothing on this node can be scheduled.</EmptyState></Show>}
        >
          <NewScheduleForm nodeId={nodeId()} options={options()} onCreated={invalidate} />
        </Show>
      </SettingsSection>
    </>
  )
}

// The creation form. Its fields only make sense together, so it is the one part of this page that
// does not save as it changes: it has Accept and schedule, which is its Save, and Cancel, and it tells
// settings when it holds a choice nobody has scheduled yet.
function NewScheduleForm(props: { nodeId: string | null; options: ScheduleTargetOption[]; onCreated: () => Promise<unknown> }) {
  const [chosen, setChosen] = createSignal('')
  const [newName, setNewName] = createSignal('')
  const [cadenceId, setCadenceId] = createSignal(DEFAULT_CADENCE)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const optionKey = (option: ScheduleTargetOption) => option.kind === 'dataset-capture' ? `dataset:${option.datasetId}` : `${option.pluginId}:${option.actionId}`
  const selected = () => props.options.find((option) => optionKey(option) === chosen())
  const providerLabel = (option: ScheduleTargetOption) => option.kind === 'dataset-capture' ? 'acorn' : pluginLabel(option.pluginId)

  const dirty = () => chosen() !== '' || newName() !== '' || cadenceId() !== DEFAULT_CADENCE
  useUnsavedChanges(dirty)

  const cancel = () => {
    setChosen('')
    setNewName('')
    setCadenceId(DEFAULT_CADENCE)
    setError('')
  }

  // A failed create keeps every field as it was, so the person can fix what the node refused and try
  // again without picking it all a second time.
  const create = async (): Promise<void> => {
    const option = selected()
    if (!option) return
    setError('')
    setBusy(true)
    try {
      await sendJson(schedulesRoute, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: newName().trim() || option.name,
          kind: option.kind,
          target: option.kind === 'dataset-capture' ? { datasetId: option.datasetId } : { pluginId: option.pluginId, actionId: option.actionId },
          cadence: cadenceFor(cadenceId()),
        }),
        nodeId: props.nodeId ?? undefined,
      })
      cancel()
      await props.onCreated()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingRow label="Action">
        <Select
          label="Action"
          value={chosen()}
          options={[
            { value: '', label: 'Pick something to run…' },
            ...props.options.map((option) => ({ value: optionKey(option), label: `${option.name} · ${option.kind === 'dataset-capture' ? 'acorn' : pluginLabel(option.pluginId)}` })),
          ]}
          onChange={(value) => setChosen(value)}
        />
      </SettingRow>

      {/* The arming strip. Host-drawn from the node's declared tier, shown BEFORE the create button
          exists, and impossible to skip — accepting it is what the create posts. */}
      <Show when={selected()}>
        {(option) => (
          <>
            <Alert tone="warn">
              <Text emphasis="strong">{providerLabel(option())}</Text>’s “{option().name}” {RISK_COPY[option().risk]}{' '}
              Once you schedule it, it runs on its own and never asks again.
            </Alert>
            <SettingRow label="Name">
              <Input label="Name" value={newName()} placeholder={option().name} onInput={(value) => setNewName(value)} />
            </SettingRow>
            <SettingRow label="When">
              <Select label="When" value={cadenceId()} onChange={(value) => setCadenceId(value)} options={[...CADENCE_CHOICES.map((choice) => ({ value: choice.id, label: choice.label }))]} />
            </SettingRow>
          </>
        )}
      </Show>

      <Show when={error()}><Alert>{error()}</Alert></Show>

      {/* Shown whenever something has been changed, not only once an action is picked, so a name typed
          before the action was cleared can still be thrown away. */}
      <Show when={dirty()}>
        <Row
          variant="stacked"
          trailing={
            <>
              <Button size="sm" disabled={busy() || !selected()} onPress={() => void create()}>
                Accept and schedule
              </Button>
              <Button size="sm" variant="ghost" disabled={busy()} onPress={cancel}>
                Cancel
              </Button>
            </>
          }
        >
          <Show when={selected()} fallback={<Text emphasis="muted">Pick an action to schedule.</Text>}>
            {(option) => (
              <Text emphasis="muted" wrap>
                Runs {describeCadence(cadenceFor(cadenceId()))}. Access: <Badge size="xs" tone="warn">{option().risk}</Badge>
              </Text>
            )}
          </Show>
        </Row>
      </Show>
    </>
  )
}
