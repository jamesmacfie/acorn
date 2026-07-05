import { createResource, createSignal, For, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { useQueryClient } from '@tanstack/solid-query'
import { readJson } from '../../apiClient'
import { rollbarItemsRoute, type RollbarItem, type RollbarItemsResponse } from '../../../shared/api'
import { dedupeBranch, slugifyBranch } from '../../../shared/branch'
import { tasksKey, tasksOptions } from '../../queries'
import { createQuery } from '@tanstack/solid-query'
import { addTaskLink, createTask } from '../../mutations'
import { activeTaskId } from './tasks'
import { activateTaskSignals } from './activate'

const relTime = (at: number | null): string => {
  if (!at) return ''
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

// The Rollbar Source browse (docs/integrations.md): recent error items across connected projects. An
// error has no inherent repo/branch, so promotion prompts for both (branch defaults to a slug of
// the title, docs/terminal-and-agents.md); with a task active, a row can instead attach to it (11 §A link growth).
export default function RollbarBrowse() {
  const navigate = useNavigate()
  const params = useParams()
  const qc = useQueryClient()
  const tasks = createQuery(() => tasksOptions(true))

  const [items, { refetch }] = createResource(async () => {
    const res = await readJson<RollbarItemsResponse>(rollbarItemsRoute).catch(() => ({ items: [] }))
    return res.items
  })

  // Promotion overlay: pick repo + branch (error → new task).
  const [promoting, setPromoting] = createSignal<RollbarItem | null>(null)
  const [repoPick, setRepoPick] = createSignal('')
  const [branch, setBranch] = createSignal('')

  function openPromote(item: RollbarItem) {
    setPromoting(item)
    setRepoPick(params.owner && params.repo ? `${params.owner}/${params.repo}` : '')
    const slug = slugifyBranch(`fix ${item.title}`.slice(0, 50))
    setBranch(dedupeBranch(slug || `fix-rollbar-${item.identifier}`, (tasks.data ?? []).map((t) => t.branch)))
  }

  async function promote() {
    const item = promoting()
    const [owner, repo] = repoPick().split('/')
    if (!item || !owner || !repo || !branch().trim()) return
    const w = await createTask({
      origin: 'rollbar',
      repoOwner: owner,
      repoName: repo,
      branch: slugifyBranch(branch()),
      title: item.title.slice(0, 120),
      links: [{ integrationId: item.integrationId, provider: 'rollbar', identifier: item.identifier }],
    })
    await qc.invalidateQueries({ queryKey: tasksKey })
    setPromoting(null)
    activateTaskSignals(w, { pane: 'rollbar' }) // a promoted error lands on its Rollbar pane
    navigate(`/${owner}/${repo}`)
  }

  // Rollbar's most common flow (docs/integrations.md): the error belongs to the task you're already on.
  async function attach(item: RollbarItem) {
    const taskId = activeTaskId()
    if (!taskId) return window.alert('No active task — open one first, or use “open as task”.')
    await addTaskLink(taskId, { integrationId: item.integrationId, provider: 'rollbar', identifier: item.identifier })
    await qc.invalidateQueries({ queryKey: tasksKey })
    window.alert('Attached to the current task.')
  }

  return (
    <main class="panes panes-empty">
      <section class="pane linear-browse">
        <div class="section-header">
          Rollbar — recent errors
          <button type="button" class="new-pr-btn" onClick={() => void refetch()}>Refresh</button>
        </div>
        <Show when={!items.loading} fallback={<p class="placeholder">Loading…</p>}>
          <Show when={(items() ?? []).length} fallback={<p class="placeholder">No active items (or the connection failed).</p>}>
            <ul class="linear-browse-list">
              <For each={items() ?? []}>
                {(item) => (
                  <li class="rollbar-row-wrap">
                    <button type="button" class="linear-browse-row" title="Open as task" onClick={() => openPromote(item)}>
                      <span class="linear-browse-id rollbar-level" data-level={item.level}>✗ {item.level}</span>
                      <span class="linear-browse-title">{item.title}</span>
                      <span class="linear-browse-state">×{item.totalOccurrences} · {item.environment} · {relTime(item.lastOccurrenceAt)}</span>
                    </button>
                    <button type="button" class="rollbar-attach" title="Attach to the current task" onClick={() => void attach(item)}>＋task</button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
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
                <input
                  class="integration-key-input"
                  type="text"
                  placeholder="owner/repo"
                  value={repoPick()}
                  onInput={(e) => setRepoPick(e.currentTarget.value)}
                />
                <input
                  class="integration-key-input"
                  type="text"
                  placeholder="branch"
                  value={branch()}
                  onInput={(e) => setBranch(e.currentTarget.value)}
                />
                <div class="close-actions">
                  <button type="button" class="overlay-btn" onClick={() => setPromoting(null)}>Cancel</button>
                  <button type="button" class="overlay-btn" disabled={!repoPick().includes('/') || !branch().trim()} onClick={() => void promote()}>
                    Create task
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Show>
    </main>
  )
}
