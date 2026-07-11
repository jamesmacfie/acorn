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
  const occurrences = createQuery(() => rollbarOccurrencesOptions(
    props.target.connectionId,
    props.target.identifier,
    tab() === 'occurrences',
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

  function onTabKeyDown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const current = TABS.findIndex((candidate) => candidate.id === tab())
    const offset = event.key === 'ArrowRight' ? 1 : -1
    const next = TABS[(current + offset + TABS.length) % TABS.length]
    setTab(next.id)
    document.getElementById(`rollbar-tab-${next.id}`)?.focus()
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

      <div class="rollbar-tabs" role="tablist" aria-label="Rollbar item sections" onKeyDown={onTabKeyDown}>
        <For each={TABS}>{(candidate) => (
          <button
            id={`rollbar-tab-${candidate.id}`}
            type="button"
            role="tab"
            aria-selected={tab() === candidate.id}
            aria-controls={`rollbar-panel-${candidate.id}`}
            tabindex={tab() === candidate.id ? 0 : -1}
            class="rollbar-tab"
            classList={{ active: tab() === candidate.id }}
            onClick={() => setTab(candidate.id)}
          >
            {candidate.label}
            <Show when={candidate.id === 'occurrences' && facts()}>{(item) => <span class="rollbar-tab-count">{item().totalOccurrences}</span>}</Show>
          </button>
        )}</For>
      </div>
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
                    <span>{item().status}</span>
                    <span>{item().environment || 'No environment'}</span>
                  </div>
                  <dl class="rollbar-summary-stats">
                    <div><dt>Occurrences</dt><dd>{item().totalOccurrences.toLocaleString()}</dd></div>
                    <div><dt>First seen</dt><dd>{fmtAbs(item().firstOccurrenceAt)}</dd></div>
                    <div><dt>Last seen</dt><dd>{fmtAbs(item().lastOccurrenceAt)}</dd></div>
                  </dl>
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
                  {(data) => <RollbarOccurrenceView occurrence={data()} />}
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
