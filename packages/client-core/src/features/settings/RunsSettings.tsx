import { For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { coreRunsRoute, isTerminalRunStatus, type RunRow, type RunStatus } from '@acorn/protocol/runs.ts'
import { readJson } from '../../infra/node/apiClient'
import { formatRelativeTime } from '../../kit/lib/rendering/formatRelativeTime'
import { Alert, Badge, Button, EmptyState, Row, StatusDot } from '../../kit/components/primitives'
import { Text } from '../../kit/components/content/Text'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { pluginLabel } from '../../host/plugins/pluginLabel'
import './settings.css'

// Settings → Run history, per node and following the settings header's node switcher
// (@acorn/protocol/runs.ts): everything on this machine that started, is taking time, and will end —
// whoever owns it. A workflow run and an agent session are the same kind of thing to the person paying
// for them, and until now they were in two databases with no surface that could show both.
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

export default function RunsSettings(props: { nodeId: string | null }) {
  const nodeId = () => props.nodeId

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
    <SettingsSection
      id="runs"
      label="Recent runs"
      help="Workflow runs, agent sessions, and other work this node has started. To stop or change one, open it in its task."
      actions={<Button size="sm" disabled={runs.isFetching} onPress={() => void runs.refetch()}>Refresh</Button>}
    >
      {/* Which owners could not answer, so a short list reads as short rather than as complete. */}
      <Show when={runs.data?.failed.length}>
        <Alert tone="warn">
          Couldn't load runs from {runs.data!.failed.map((id) => pluginLabel(id)).join(', ')}, so some are missing.
        </Alert>
      </Show>

      <Show when={runs.error}>{(error) => <Alert>{String(error())}</Alert>}</Show>

      <Show when={rows().length} fallback={<Show when={runs.isSuccess}><EmptyState align="start" size="sm">Nothing has run on this node.</EmptyState></Show>}>
        <Show when={spend() > 0}>
          <Text emphasis="muted">{money(spend())} across these {rows().length} runs.</Text>
        </Show>
        <For each={rows()}>
          {(run) => {
            const now = Date.now()
            return (
              <Row
                variant="stacked"
                leading={<StatusDot tone={STATUS_TONE[run.status]} label={run.status} />}
                meta={<Show when={run.costUsd}>{(cost) => <Text emphasis="muted">{money(cost())}</Text>}</Show>}
              >
                <span class="settings-label">
                  {run.title} <Badge size="xs" tone="accent">{pluginLabel(run.pluginId)}</Badge>
                </span>
                <Text emphasis="muted" wrap>
                  {run.status} · started {formatRelativeTime(run.startedAt)} · {describeDuration(run, now)}
                  <Show when={run.detail}>{(detail) => <> · {detail()}</>}</Show>
                </Text>
              </Row>
            )
          }}
        </For>
      </Show>
    </SettingsSection>
  )
}
