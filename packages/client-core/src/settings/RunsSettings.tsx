import { createSignal, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { coreRunsRoute, isTerminalRunStatus, type RunRow, type RunStatus } from '@acorn/protocol/runs.ts'
import { readJson } from '../apiClient'
import { formatRelativeTime } from '../lib/formatRelativeTime'
import { activeNodeId } from '../node/activeNode'
import { nodes } from '../node/fleet'
import { Alert, Badge, Button, Row, Select, StatusDot } from '../ui/primitives'
import './settings.css'

// Settings → Runs, per node (@acorn/protocol/runs.ts): everything on this machine that started, is
// taking time, and will end — whoever owns it. A workflow run and an agent session are the same kind
// of thing to the person paying for them, and until now they were in two databases with no surface
// that could show both.
//
// There is no table behind this. Each plugin declares a route that lists its own runs and core merges
// the answers, so this page adds no migration and no ownership: a plugin that goes away takes its rows
// off the list, and nothing here knows which plugins there are.

type RunsResponse = { runs: RunRow[]; failed: string[] }

const STATUS_TONE: Record<RunStatus, 'ok' | 'danger' | 'warn' | 'muted'> = {
  running: 'ok',
  waiting: 'warn',
  done: 'muted',
  failed: 'danger',
  cancelled: 'muted',
}

/** How long it took, or how long it has been going. One string, because "started 20 minutes ago" and
 *  "took 20 minutes" are the same question asked of a live and a finished run. */
function describeDuration(run: RunRow, now: number): string {
  const end = run.endedAt ?? now
  const ms = Math.max(0, end - run.startedAt)
  const minutes = Math.round(ms / 60_000)
  const span = ms < 60_000 ? `${Math.round(ms / 1000)}s` : minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`
  return isTerminalRunStatus(run.status) ? `took ${span}` : `running for ${span}`
}

const money = (usd: number): string => (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`)

export default function RunsSettings() {
  const [target, setTarget] = createSignal<string | null>(null)
  const nodeId = () => target() ?? activeNodeId()
  const node = () => nodes().find((candidate) => candidate.nodeId === nodeId()) ?? null

  const runs = createQuery(() => ({
    queryKey: ['runs', nodeId()],
    queryFn: () => readJson<RunsResponse>(coreRunsRoute, { nodeId: nodeId() ?? undefined }),
    // A live list. Ten seconds is fast enough that a run appearing feels immediate and slow enough
    // that the merge, which fans out to every owning plugin, is not a background load.
    refetchInterval: 10_000,
  }))

  const rows = () => runs.data?.runs ?? []
  const spend = () => rows().reduce((total, run) => total + (run.costUsd ?? 0), 0)

  return (
    <div class="settings-section">
      <Show when={nodes().length > 1}>
        <label class="settings-field">
          <span>Node</span>
          <Select value={nodeId() ?? ''} onChange={(value) => setTarget(value || null)} options={[...nodes().map((candidate) => ({ value: candidate.nodeId, label: candidate.label }))]} />
        </label>
      </Show>

      <p class="muted">
        Work <strong>{node()?.label ?? 'this node'}</strong> has started, from every plugin that owns
        any: workflow runs, agent sessions, and whatever else is installed. To act on one, open it
        where it lives.
      </p>

      {/* Which owners could not answer, so a short list reads as short rather than as complete. */}
      <Show when={runs.data?.failed.length}>
        <Alert tone="warn">
          Could not read runs from: {runs.data!.failed.join(', ')}. The list below is missing whatever
          they own.
        </Alert>
      </Show>

      <Show when={runs.error}>{(error) => <Alert>{String(error())}</Alert>}</Show>

      <Show when={rows().length} fallback={<p class="muted">Nothing has run on this node yet.</p>}>
        <Show when={spend() > 0}>
          <p class="muted">{money(spend())} across {rows().length} runs on this page.</p>
        </Show>
        <For each={rows()}>
          {(run) => {
            const now = Date.now()
            return (
              <Row
                variant="stacked"
                leading={<StatusDot tone={STATUS_TONE[run.status]} label={run.status} />}
                meta={<Show when={run.costUsd}>{(cost) => <span class="muted">{money(cost())}</span>}</Show>}
              >
                <span class="settings-label">
                  {run.title} <Badge size="xs" tone="accent">{run.pluginId}</Badge>
                </span>
                <span class="muted">
                  {run.status} · started {formatRelativeTime(run.startedAt)} · {describeDuration(run, now)}
                  <Show when={run.detail}>{(detail) => <> · {detail()}</>}</Show>
                </span>
              </Row>
            )
          }}
        </For>
      </Show>

      <div class="settings-actions">
        <Button size="sm" disabled={runs.isFetching} onPress={() => void runs.refetch()}>Refresh</Button>
      </div>
    </div>
  )
}
