import { createEffect, createSignal, For, on, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { rollbarItemsOptions, tasksKey, tasksOptions } from '../../../core/client/queries'
import type { RollbarItemSummary, Task } from '../../../core/shared/api'
import { dedupeBranch, slugifyBranch } from '../../../core/shared/branch'
import { sourceRegistry, type SourceContribution } from '../../../core/client/registries/sources'
import { activeTaskId } from '../../../core/client/tasks/tasks'
import { activateTaskSignals, pathForTask } from '../../../core/client/tasks/activate'
import { emptyRollbarFilter, filterRollbarItems, rollbarFacets, sortRollbarItems, type RollbarFilter } from './model'
import RollbarItemPanel, { type RollbarTarget } from './RollbarItemPanel'
import './rollbar.css'

const relTime = (at: number | null): string => {
  if (!at) return ''
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

const itemKey = (i: { integrationId: string; identifier: string }) => `${i.integrationId}:${i.identifier}`

// The Rollbar Source browse (docs/integrations.md): a two-column master/detail. The left column lists
// active items across connected projects; selecting one opens its normalized detail on the right.
// Row click only selects — task promotion (+ ws) and attach-to-task are distinct, explicit actions.
export default function RollbarBrowse() {
  const navigate = useNavigate()
  const params = useParams()
  const qc = useQueryClient()
  const tasks = createQuery(() => tasksOptions(true))
  const items = createQuery(() => rollbarItemsOptions(true))

  const rows = () => items.data?.items ?? []
  const facets = () => rollbarFacets(rows())
  const [filter, setFilter] = createSignal<RollbarFilter>(emptyRollbarFilter)
  const patch = (part: Partial<RollbarFilter>) => setFilter((f) => ({ ...f, ...part }))
  const visible = () => sortRollbarItems(filterRollbarItems(rows(), filter()))

  const [selected, setSelected] = createSignal<RollbarTarget | null>(null)
  const isSelected = (i: RollbarItemSummary) => selected() !== null && targetKeyEq(selected()!, i)
  const selectedSummary = () => rows().find((i) => selected() !== null && targetKeyEq(selected()!, i))
  // Selection is session-only and scoped to the routed repo; reset it on repo change (matches Linear).
  createEffect(on(() => `${params.owner ?? ''}/${params.repo ?? ''}`, () => setSelected(null), { defer: true }))

  // Promotion overlay: an error has no repo/branch of its own, so ask where the fix lives.
  const [promoting, setPromoting] = createSignal<RollbarItemSummary | null>(null)
  const [repoPick, setRepoPick] = createSignal('')
  const [branch, setBranch] = createSignal('')
  const [attachMessage, setAttachMessage] = createSignal('')

  async function promote(item: RollbarItemSummary) {
    // Focus an existing active task for the same (connection, counter) instead of duplicating it.
    const existing = (await qc.ensureQueryData(tasksOptions(true)).catch(() => [] as Task[]))
      .find((t) => t.status === 'active' && t.links.some((l) => l.providerId === 'rollbar' && l.connectionId === item.integrationId && l.identifier === item.identifier))
    if (existing) {
      activateTaskSignals(existing, { pane: 'rollbar' })
      return navigate(pathForTask(existing))
    }
    setPromoting(item)
    setRepoPick(params.owner && params.repo ? `${params.owner}/${params.repo}` : '')
    const slug = slugifyBranch(`fix ${item.title}`.slice(0, 50))
    setBranch(dedupeBranch(slug || `fix-rollbar-${item.identifier}`, (tasks.data ?? []).map((t) => t.branch)))
  }

  async function confirmPromote() {
    const item = promoting()
    const [owner, repo] = repoPick().split('/')
    if (!item || !owner || !repo || !branch().trim()) return
    const promotion = (sourceRegistry.get('rollbar') as SourceContribution<RollbarItemSummary>).promotion
    const context = { owner, repo, branch: branch(), existingBranches: (tasks.data ?? []).map((t) => t.branch) }
    if (!promotion.canPromote(item, context)) return
    const w = await promotion.create(await promotion.prepare(item, context))
    await promotion.afterCreate?.(w, item, context)
    await qc.invalidateQueries({ queryKey: tasksKey })
    setPromoting(null)
    activateTaskSignals(w, { pane: 'rollbar' })
    navigate(`/${owner}/${repo}`)
  }

  // Rollbar's most common flow: the error belongs to the task you're already on.
  async function attach() {
    const item = selectedSummary()
    const taskId = activeTaskId()
    if (!item) return
    setAttachMessage('')
    if (!taskId) return setAttachMessage('No active task — open one first, or use “Open as task”.')
    const promotion = (sourceRegistry.get('rollbar') as SourceContribution<RollbarItemSummary>).promotion
    if (!promotion.attachToCurrentTask) return
    await promotion.attachToCurrentTask(taskId, item)
    await qc.invalidateQueries({ queryKey: tasksKey })
    setAttachMessage('Attached to the current task.')
  }

  const hasActiveTask = () => activeTaskId() != null

  return (
    <main class="panes rollbar-browse-panes">
      <section class="pane pane-left rollbar-browse">
        <div class="section-header">
          Rollbar · active
          <button type="button" class="new-pr-btn" disabled={items.isFetching} onClick={() => void items.refetch()}>
            {items.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div class="rollbar-filters">
          <input class="rollbar-search" type="text" placeholder="Search title / #counter" value={filter().search} onInput={(e) => patch({ search: e.currentTarget.value })} />
          <Show when={facets().connections.length > 1}>
            <select value={filter().connectionId} onChange={(e) => patch({ connectionId: e.currentTarget.value })}>
              <option value="">All projects</option>
              <For each={facets().connections}>{(c) => <option value={c.id}>{c.label}</option>}</For>
            </select>
          </Show>
          <select value={filter().level} onChange={(e) => patch({ level: e.currentTarget.value })}>
            <option value="">All levels</option>
            <For each={facets().levels}>{(l) => <option value={l}>{l}</option>}</For>
          </select>
          <select value={filter().environment} onChange={(e) => patch({ environment: e.currentTarget.value })}>
            <option value="">All envs</option>
            <For each={facets().environments}>{(env) => <option value={env}>{env}</option>}</For>
          </select>
        </div>

        <Show when={(items.data?.failures ?? []).length}>
          <div class="action-error" role="alert">{items.data!.failures.length} Rollbar connection(s) failed; showing what loaded.</div>
        </Show>
        <Show when={(items.data?.cappedIntegrationIds ?? []).length}>
          <div class="rollbar-capped" role="status">Showing the 300 most recent active items per capped project.</div>
        </Show>

        <Show when={!items.isPending} fallback={<p class="placeholder">Loading…</p>}>
          <Show when={rows().length} fallback={<p class="placeholder">{items.isError ? 'Could not load Rollbar items.' : 'No active items.'}</p>}>
            <Show when={visible().length} fallback={<p class="placeholder">No items match the current filters.</p>}>
              <ul class="rollbar-list">
                <For each={visible()}>
                  {(item) => (
                    <li>
                      <div
                        class="rollbar-row"
                        classList={{ active: isSelected(item) }}
                        role="button"
                        tabindex="0"
                        aria-pressed={isSelected(item)}
                        onClick={() => setSelected({ connectionId: item.integrationId, identifier: item.identifier })}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                          event.preventDefault()
                          setSelected({ connectionId: item.integrationId, identifier: item.identifier })
                        }}
                      >
                        <span class="rollbar-level" data-level={item.level}>✗ {item.level}</span>
                        <span class="rollbar-row-title">{item.title}</span>
                        <Show when={facets().connections.length > 1}><span class="rollbar-row-conn muted">{item.integrationLabel}</span></Show>
                        <span class="rollbar-row-meta muted">×{item.totalOccurrences} · {item.environment} · {relTime(item.lastOccurrenceAt)}</span>
                        <button
                          type="button"
                          class="rollbar-ws-btn"
                          title="Open as task"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            void promote(item)
                          }}
                        >
                          + ws
                        </button>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </Show>
      </section>

      <section class="pane pane-right rollbar-browse-detail">
        <Show when={selected()} fallback={<div class="pane-empty"><p class="placeholder">Select an item.</p></div>}>
          {(target) => (
            <RollbarItemPanel
              variant="detail"
              target={target()}
              summary={selectedSummary()}
              actions={
                <>
                  <button
                    type="button"
                    class="overlay-btn"
                    disabled={!hasActiveTask()}
                    title={hasActiveTask() ? 'Attach this item to the active task' : 'No active task — open one first'}
                    onClick={() => void attach()}
                  >
                    Attach to current task
                  </button>
                  <Show when={selectedSummary()}>{(item) => <button type="button" class="overlay-btn" onClick={() => void promote(item())}>Open as task</button>}</Show>
                  <Show when={attachMessage()}><span class="muted" role="status">{attachMessage()}</span></Show>
                </>
              }
            />
          )}
        </Show>
      </section>

      <Show when={promoting()}>
        {(item) => (
          <div class="overlay-backdrop" onClick={() => setPromoting(null)}>
            <div class="overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div class="overlay-title">Open as task — #{item().identifier}</div>
              <div class="overlay-body">
                <p class="muted">{item().title}</p>
                <p class="muted">An error has no repo/branch of its own — pick where the fix lives.</p>
                <input class="integration-key-input" type="text" placeholder="owner/repo" value={repoPick()} onInput={(e) => setRepoPick(e.currentTarget.value)} />
                <input class="integration-key-input" type="text" placeholder="branch" value={branch()} onInput={(e) => setBranch(e.currentTarget.value)} />
                <div class="close-actions">
                  <button type="button" class="overlay-btn" onClick={() => setPromoting(null)}>Cancel</button>
                  <button type="button" class="overlay-btn" disabled={!repoPick().includes('/') || !branch().trim()} onClick={() => void confirmPromote()}>Create task</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Show>
    </main>
  )
}

const targetKeyEq = (t: RollbarTarget, i: { integrationId: string; identifier: string }) => targetKey(t) === itemKey(i)
const targetKey = (t: RollbarTarget) => `${t.connectionId}:${t.identifier}`
