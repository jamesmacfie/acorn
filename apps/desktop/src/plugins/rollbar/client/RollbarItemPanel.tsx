import { createEffect, createSignal, For, on, Show, type JSX } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { readJson } from '../../../core/client/apiClient'
import {
  rollbarItemMetadataOptions,
  rollbarOccurrenceOptions,
  rollbarOccurrencesOptions,
} from '../../../core/client/queries'
import {
  rollbarItemMetadataKey,
  rollbarItemMetadataRoute,
  rollbarOccurrenceKey,
  rollbarOccurrenceRoute,
  rollbarOccurrencesKey,
  rollbarOccurrencesRoute,
  type RollbarItemMetadata,
  type RollbarItemSummary,
  type RollbarOccurrenceDetail,
  type RollbarOccurrencesResponse,
} from '../../../core/shared/api'
import RollbarOccurrenceView from './RollbarOccurrenceView'
import { isRegressed, rollbarImpact } from './model'
import { Tabs } from '../../../core/client/ui/Tabs'
import './rollbar.css'

export type RollbarTarget = { connectionId: string; identifier: string }
type RollbarPanelTab = 'summary' | 'details' | 'occurrences'

const TABS: Array<{ id: RollbarPanelTab; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'details', label: 'Details' },
  { id: 'occurrences', label: 'Occurrences' },
]
const targetKey = (target: RollbarTarget) => `${target.connectionId}:${target.identifier}`
const fmtAbs = (at: number | null): string => (at ? new Date(at).toLocaleString() : '—')

export default function RollbarItemPanel(props: {
  target: RollbarTarget
  summary?: RollbarItemSummary
  targets?: RollbarTarget[]
  onSelectTarget?: (target: RollbarTarget) => void
  variant?: 'pane' | 'detail'
  actions?: JSX.Element
  taskId?: string // enables frame → editor links; only the task pane has a worktree to open into
}) {
  const qc = useQueryClient()
  const [tab, setTab] = createSignal<RollbarPanelTab>('summary')
  const [selectedOccurrenceId, setSelectedOccurrenceId] = createSignal<string | null>(null)
  const [refreshing, setRefreshing] = createSignal(false)
  const [refreshError, setRefreshError] = createSignal('')

  createEffect(on(() => targetKey(props.target), () => {
    setTab('summary')
    setSelectedOccurrenceId(null)
  }, { defer: true }))

  // Browse supplies a list summary, so selection is instant. A task-pane target has no summary in
  // its task link; only that case activates metadata for the default Summary tab.
  const metadata = createQuery(() => rollbarItemMetadataOptions(
    props.target.connectionId,
    props.target.identifier,
    tab() === 'details' || (tab() === 'summary' && !props.summary),
  ))
  // Summary also loads the occurrence sample: its Impact rollup is a local reduce over the same
  // serve-then-revalidate resource the Occurrences tab uses (no new API surface).
  const occurrences = createQuery(() => rollbarOccurrencesOptions(
    props.target.connectionId,
    props.target.identifier,
    tab() === 'occurrences' || tab() === 'summary',
  ))
  const occurrence = createQuery(() => rollbarOccurrenceOptions(
    props.target.connectionId,
    props.target.identifier,
    selectedOccurrenceId() ?? '',
    tab() === 'occurrences' && selectedOccurrenceId() !== null,
  ))

  const facts = (): RollbarItemSummary | undefined => metadata.data ?? props.summary

  async function refreshActiveTab() {
    if (refreshing()) return
    setRefreshing(true)
    setRefreshError('')
    try {
      if (tab() === 'occurrences' && selectedOccurrenceId()) {
        const id = selectedOccurrenceId()!
        const fresh = await readJson<RollbarOccurrenceDetail>(rollbarOccurrenceRoute(props.target.connectionId, props.target.identifier, id, true))
        qc.setQueryData(rollbarOccurrenceKey(props.target.connectionId, props.target.identifier, id), fresh)
      } else if (tab() === 'occurrences') {
        const fresh = await readJson<RollbarOccurrencesResponse>(rollbarOccurrencesRoute(props.target.connectionId, props.target.identifier, true))
        qc.setQueryData(rollbarOccurrencesKey(props.target.connectionId, props.target.identifier), fresh)
      } else {
        const fresh = await readJson<RollbarItemMetadata>(rollbarItemMetadataRoute(props.target.connectionId, props.target.identifier, true))
        qc.setQueryData(rollbarItemMetadataKey(props.target.connectionId, props.target.identifier), fresh)
      }
    } catch {
      setRefreshError('Could not refresh this tab. Showing the last cached result when available.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section class="pane rollbar-panel" classList={{ 'rollbar-panel-pane': props.variant === 'pane' }}>
      <div class="section-header rollbar-panel-head">
        <span class="rollbar-panel-title-line">
          <span class="rollbar-level" data-level={facts()?.level}>✗ {facts()?.level ?? 'rollbar'}</span>
          <span class="rollbar-panel-name">
            <Show when={facts()} fallback={`#${props.target.identifier}`}>
              {(item) => (
                <>{item().integrationLabel} · <Show when={item().url} fallback={`#${item().identifier}`}>
                  {(url) => <a class="rollbar-external-id" href={url()} target="_blank" rel="noreferrer">#{item().identifier}</a>}
                </Show></>
              )}
            </Show>
          </span>
        </span>
        <button type="button" class="new-pr-btn" disabled={refreshing()} onClick={() => void refreshActiveTab()}>{refreshing() ? 'Refreshing…' : 'Refresh tab'}</button>
      </div>

      <Show when={(props.targets?.length ?? 0) > 1}>
        <div class="rollbar-chips">
          <For each={props.targets}>{(target) => (
            <button type="button" class="rollbar-chip" classList={{ active: targetKey(target) === targetKey(props.target) }} onClick={() => props.onSelectTarget?.(target)}>
              #{target.identifier}
            </button>
          )}</For>
        </div>
      </Show>

      <Tabs
        tabs={TABS.map((candidate) => (candidate.id === 'occurrences' && facts() ? { ...candidate, count: facts()!.totalOccurrences } : candidate))}
        active={tab()}
        onChange={(id) => setTab(id as RollbarPanelTab)}
        idPrefix="rollbar"
        ariaLabel="Rollbar item sections"
      />
      <Show when={refreshError()}><div class="action-error rollbar-refresh-error" role="alert">{refreshError()}</div></Show>

      <div class="rollbar-panel-body">
        <Show when={tab() === 'summary'}>
          <div id="rollbar-panel-summary" role="tabpanel" aria-labelledby="rollbar-tab-summary" class="rollbar-tab-panel">
            <Show when={facts()} fallback={<p class="placeholder">{metadata.isLoading ? 'Loading summary…' : 'Could not load this item.'}</p>}>
              {(item) => (
                <>
                  <h2 class="rollbar-title">{item().title}</h2>
                  <div class="rollbar-summary-line">
                    <span class="rollbar-level" data-level={item().level}>{item().level}</span>
                    <Show when={isRegressed(item())}><span class="rollbar-regressed-chip" title="Resolved and came back">regressed</span></Show>
                    <span>{item().status}</span>
                    <span>{item().environment || 'No environment'}</span>
                  </div>
                  <dl class="rollbar-summary-stats">
                    <div><dt>Occurrences</dt><dd>{item().totalOccurrences.toLocaleString()}</dd></div>
                    <Show when={item().uniqueOccurrences != null}>
                      <div><dt>Unique IPs</dt><dd>{item().uniqueOccurrences!.toLocaleString()}</dd></div>
                    </Show>
                    <div><dt>First seen</dt><dd>{fmtAbs(item().firstOccurrenceAt)}</dd></div>
                    <div><dt>Last seen</dt><dd>{fmtAbs(item().lastOccurrenceAt)}</dd></div>
                  </dl>
                  <Show when={isRegressed(item())}>
                    <p class="rollbar-regressed-note">Reactivated {fmtAbs(item().lastActivatedAt ?? null)} — this error was resolved and came back.</p>
                  </Show>
                  <Show when={occurrences.data?.occurrences.length}>
                    {(_) => {
                      const impact = () => rollbarImpact(occurrences.data!.occurrences, Date.now())
                      const spread = (values: Array<{ name: string; count: number }>) =>
                        values.slice(0, 3).map((v) => `${v.name} ×${v.count}`).join(' · ') || '—'
                      return (
                        <>
                          <h3 class="rollbar-section-head">Impact — of the last {impact().sample} occurrences</h3>
                          <dl class="rollbar-facts">
                            <dt>Users</dt><dd>{impact().users || '—'}</dd>
                            <dt>Last 24h</dt><dd>{impact().last24h}</dd>
                            <dt>Environments</dt><dd>{spread(impact().environments)}</dd>
                            <dt>Versions</dt><dd>{spread(impact().versions)}</dd>
                          </dl>
                        </>
                      )
                    }}
                  </Show>
                  <Show when={metadata.isError}><p class="action-error" role="alert">Could not refresh this item’s summary.</p></Show>
                </>
              )}
            </Show>
          </div>
        </Show>

        <Show when={tab() === 'details'}>
          <div id="rollbar-panel-details" role="tabpanel" aria-labelledby="rollbar-tab-details" class="rollbar-tab-panel">
            <Show when={metadata.data} fallback={<p class="placeholder">{metadata.isError ? 'Could not load item details.' : 'Loading item details…'}</p>}>
              {(item) => (
                <>
                  <h2 class="rollbar-title">{item().title}</h2>
                  <dl class="rollbar-facts rollbar-detail-facts">
                    <dt>Project</dt><dd>{item().integrationLabel}</dd>
                    <dt>Counter</dt><dd>#{item().identifier}</dd>
                    <dt>Item ID</dt><dd>{item().itemId}</dd>
                    <dt>Level</dt><dd>{item().level}</dd>
                    <dt>Status</dt><dd>{item().status}</dd>
                    <dt>Environment</dt><dd>{item().environment || '—'}</dd>
                    <dt>Framework</dt><dd>{item().framework ?? '—'}</dd>
                    <dt>Resolved in</dt><dd>{item().resolvedInVersion ?? '—'}</dd>
                    <dt>Assigned</dt><dd>{item().assignedTo ?? '—'}</dd>
                    <dt>First seen</dt><dd>{fmtAbs(item().firstOccurrenceAt)}</dd>
                    <dt>Last seen</dt><dd>{fmtAbs(item().lastOccurrenceAt)}</dd>
                  </dl>
                </>
              )}
            </Show>
          </div>
        </Show>

        <Show when={tab() === 'occurrences'}>
          <div id="rollbar-panel-occurrences" role="tabpanel" aria-labelledby="rollbar-tab-occurrences" class="rollbar-tab-panel rollbar-occurrences-workbench">
            <div class="rollbar-occurrence-list">
              <Show when={occurrences.data} fallback={<p class="placeholder">{occurrences.isError ? 'Could not load occurrences.' : 'Loading occurrences…'}</p>}>
                {(result) => (
                  <>
                    <For each={result().occurrences} fallback={<p class="placeholder">No occurrences are available.</p>}>
                      {(item) => (
                        <button
                          type="button"
                          class="rollbar-occurrence-row"
                          classList={{ active: selectedOccurrenceId() === item.id }}
                          aria-pressed={selectedOccurrenceId() === item.id}
                          onClick={() => setSelectedOccurrenceId(item.id)}
                        >
                          <span class="rollbar-occurrence-time">{fmtAbs(item.occurredAt)}</span>
                          <span class="muted">#{item.id}</span>
                          <span class="rollbar-occurrence-message">{item.exceptionClass || item.message || item.kind}</span>
                          <Show when={item.environment || item.codeVersion || item.personUsername || item.request?.url}>
                            <span class="rollbar-occurrence-facts muted">
                              {[item.environment, item.codeVersion, item.personUsername, [item.request?.method, item.request?.url].filter(Boolean).join(' ') || null]
                                .filter(Boolean).join(' · ')}
                            </span>
                          </Show>
                        </button>
                      )}
                    </For>
                    <Show when={result().capped}><p class="rollbar-capped">Showing the 50 most recent occurrences.</p></Show>
                  </>
                )}
              </Show>
            </div>
            <div class="rollbar-occurrence-view">
              <Show when={selectedOccurrenceId()} fallback={<div class="pane-empty"><p class="placeholder">Select an occurrence to load its diagnostic detail.</p></div>}>
                <Show when={occurrence.data} fallback={<p class="placeholder">{occurrence.isError ? 'Could not load this occurrence.' : 'Loading occurrence detail…'}</p>}>
                  {(data) => <RollbarOccurrenceView occurrence={data()} item={facts()} taskId={props.taskId} />}
                </Show>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      <Show when={props.actions}><div class="rollbar-actions">{props.actions}</div></Show>
    </section>
  )
}
