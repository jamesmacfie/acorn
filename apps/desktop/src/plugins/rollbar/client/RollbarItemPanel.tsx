import { createSignal, For, Show, type JSX } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { readJson } from '../../../core/client/apiClient'
import { rollbarItemOptions } from '../../../core/client/queries'
import { rollbarItemKey, rollbarItemRoute, type RollbarItemDetail, type RollbarItemSummary, type RollbarOccurrenceDetail } from '../../../core/shared/api'
import './rollbar.css'

export type RollbarTarget = { connectionId: string; identifier: string }
const targetKey = (t: RollbarTarget) => `${t.connectionId}:${t.identifier}`
const fmtAbs = (at: number | null): string => (at ? new Date(at).toLocaleString() : '—')
// Local relative-time (avoids coupling to the github plugin). '' when unknown, so callers can Show-gate.
const relAge = (at: number | null): string => {
  if (!at) return ''
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

// One Rollbar item's normalized detail, shared by the Source detail column and the task pane
// (docs/panes.md), analogous to LinearIssuePanel. The header/triage facts render immediately from
// the list summary; the latest occurrence (privacy-normalized server-side — never raw JSON) streams
// in from rollbarItemOptions. `actions` is a caller-owned slot: the browse passes attach/open-task
// buttons, the task pane passes none. Refresh forces past the server TTL.
export default function RollbarItemPanel(props: {
  target: RollbarTarget
  summary?: RollbarItemSummary
  targets?: RollbarTarget[]
  onSelectTarget?: (target: RollbarTarget) => void
  variant?: 'pane' | 'detail'
  actions?: JSX.Element
}) {
  const qc = useQueryClient()
  const query = createQuery(() => rollbarItemOptions(props.target.connectionId, props.target.identifier, true))
  const [refreshing, setRefreshing] = createSignal(false)

  // Prefer freshly-loaded detail; fall back to the passed list summary so the header never blanks.
  const facts = (): RollbarItemSummary | undefined => query.data ?? props.summary
  const detail = (): RollbarItemDetail | undefined => query.data
  const occurrence = (): RollbarOccurrenceDetail | null | undefined => query.data?.latestOccurrence

  async function refresh() {
    if (refreshing()) return
    setRefreshing(true)
    try {
      const fresh = await readJson<RollbarItemDetail>(rollbarItemRoute(props.target.connectionId, props.target.identifier, true))
      qc.setQueryData(rollbarItemKey(props.target.connectionId, props.target.identifier), fresh)
    } catch {
      // Leave the stale detail in place; the error note below covers the failed revalidation.
    } finally {
      setRefreshing(false)
    }
  }

  const kindLabel: Record<RollbarOccurrenceDetail['kind'], string> = {
    trace: 'Exception', 'trace-chain': 'Exception chain', message: 'Message', 'crash-report': 'Crash report', unknown: 'Occurrence',
  }

  return (
    <section class="pane rollbar-panel" classList={{ 'rollbar-panel-pane': props.variant === 'pane' }}>
      <div class="section-header rollbar-panel-head">
        <span class="rollbar-panel-title-line">
          <span class="rollbar-level" data-level={facts()?.level}>✗ {facts()?.level ?? 'rollbar'}</span>
          <span class="rollbar-panel-name">{facts() ? `${facts()!.integrationLabel} · #${facts()!.identifier}` : `#${props.target.identifier}`}</span>
        </span>
        <button type="button" class="new-pr-btn" disabled={refreshing()} onClick={() => void refresh()}>{refreshing() ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      <Show when={(props.targets?.length ?? 0) > 1}>
        <div class="rollbar-chips">
          <For each={props.targets}>
            {(t) => (
              <button type="button" class="rollbar-chip" classList={{ active: targetKey(t) === targetKey(props.target) }} onClick={() => props.onSelectTarget?.(t)}>
                #{t.identifier}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="rollbar-panel-body">
        <Show when={facts()} fallback={<p class="placeholder">{query.isLoading ? 'Loading…' : 'Could not load this item.'}</p>}>
          {(f) => (
            <>
              <h2 class="rollbar-title">{f().title}</h2>
              <dl class="rollbar-facts">
                <dt>Level</dt><dd>{f().level}</dd>
                <dt>Status</dt><dd>{f().status}</dd>
                <dt>Environment</dt><dd>{f().environment}</dd>
                <dt>Occurrences</dt><dd>×{f().totalOccurrences}</dd>
                <dt>First seen</dt><dd>{fmtAbs(f().firstOccurrenceAt)}</dd>
                <dt>Last seen</dt><dd>{fmtAbs(f().lastOccurrenceAt)}</dd>
                <Show when={detail()?.resolvedInVersion}>{(v) => (<><dt>Resolved in</dt><dd>{v()}</dd></>)}</Show>
                <Show when={detail()?.assignedTo}>{(a) => (<><dt>Assigned</dt><dd>{a()}</dd></>)}</Show>
              </dl>

              <Show when={query.isError && !detail()}>
                <p class="action-error" role="alert">Couldn't load the latest occurrence (auth, rate limit, or upstream error).</p>
              </Show>
              <Show when={query.isError && detail()}>
                <p class="muted" role="status">Showing cached detail — latest refresh failed.</p>
              </Show>

              <Show when={detail()} fallback={<Show when={!query.isError}><p class="muted">Loading latest occurrence…</p></Show>}>
                <Show when={occurrence()} fallback={<p class="muted">No occurrence detail available for this item.</p>}>
                  {(occ) => (
                    <>
                      <h3 class="rollbar-section-head">
                        Latest occurrence · {kindLabel[occ().kind]}
                        <Show when={relAge(occ().occurredAt)}>{(age) => <span class="muted"> · {age()}</span>}</Show>
                      </h3>
                      <Show when={occ().exceptionClass || occ().message}>
                        <p class="rollbar-exception">
                          <Show when={occ().exceptionClass}>{(cls) => <span class="rollbar-exception-class">{cls()}: </span>}</Show>
                          {occ().message}
                        </p>
                      </Show>

                      <Show when={occ().frames.length}>
                        <ul class="rollbar-frames">
                          <For each={occ().frames}>
                            {(frame) => (
                              <li class="rollbar-frame" classList={{ 'rollbar-frame-app': frame.inProject === true }}>
                                <div class="rollbar-frame-loc">
                                  <span class="rollbar-frame-file">{frame.filename}</span>
                                  <Show when={frame.line != null}><span class="muted">:{frame.line}{frame.column != null ? `:${frame.column}` : ''}</span></Show>
                                  <Show when={frame.method}>{(m) => <span class="rollbar-frame-method"> {m()}</span>}</Show>
                                </div>
                                <Show when={frame.code.length}>
                                  <pre class="rollbar-frame-code"><For each={frame.code}>{(c) => <div classList={{ 'rollbar-code-anchor': c.line === frame.line }}><span class="rollbar-code-ln">{c.line}</span>{c.text}</div>}</For></pre>
                                </Show>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>

                      <dl class="rollbar-facts rollbar-context">
                        <Show when={occ().request}>{(r) => (<><dt>Request</dt><dd>{[r().method, r().url].filter(Boolean).join(' ') || '—'}</dd></>)}</Show>
                        <Show when={occ().context}>{(ctx) => (<><dt>Context</dt><dd>{ctx()}</dd></>)}</Show>
                        <Show when={occ().codeVersion}>{(v) => (<><dt>Version</dt><dd>{v()}</dd></>)}</Show>
                        <Show when={occ().language || occ().platform || occ().framework}>
                          <dt>Runtime</dt><dd>{[occ().language, occ().platform, occ().framework].filter(Boolean).join(' · ')}</dd>
                        </Show>
                        <Show when={occ().server}>{(s) => (<Show when={s().host || s().branch}><dt>Server</dt><dd>{[s().host, s().branch].filter(Boolean).join(' · ')}</dd></Show>)}</Show>
                        <Show when={occ().person}>{(p) => (<Show when={p().id || p().username || p().email}><dt>Person</dt><dd>{p().username || p().id || p().email}</dd></Show>)}</Show>
                        <Show when={occ().notifier}>{(n) => (<Show when={n().name}><dt>Notifier</dt><dd>{[n().name, n().version].filter(Boolean).join(' ')}</dd></Show>)}</Show>
                      </dl>

                      <Show when={occ().truncated}>
                        <p class="muted rollbar-truncated">Some occurrence data was omitted by Acorn's size/privacy caps.</p>
                      </Show>
                    </>
                  )}
                </Show>
              </Show>

              <Show when={props.actions}>
                <div class="rollbar-actions">{props.actions}</div>
              </Show>
            </>
          )}
        </Show>
      </div>
    </section>
  )
}
