import { createResource, createSignal, For, Show } from 'solid-js'
import { readJson } from '../../apiClient'
import { rollbarItemRoute, type RollbarItem, type Task, type TaskLink } from '../../../shared/api'

const fmt = (at: number | null): string => (at ? new Date(at).toLocaleString() : '—')

// The Rollbar provider pane (docs/next 10 P2 / 03 §providers): the task's linked errors, resolved
// task_links → the /api/rollbar detail route (which serves the `issues` cache). A chip strip
// switches between several linked items, mirroring the Linear panel's shape.
export default function RollbarPane(props: { task: Task }) {
  const links = () => props.task.links.filter((l) => l.provider === 'rollbar')
  const [picked, setPicked] = createSignal<string | null>(null)
  const current = (): TaskLink | undefined => links().find((l) => l.identifier === picked()) ?? links()[0]

  const [item] = createResource(
    () => {
      const link = current()
      return link ? `${link.integrationId}:${link.identifier}` : null
    },
    async () => {
      const link = current()
      if (!link) return null
      return readJson<RollbarItem>(rollbarItemRoute(link.integrationId, link.identifier)).catch(() => null)
    },
  )

  return (
    <section class="pane rollbar-pane">
      <div class="section-header">Rollbar</div>
      <Show when={links().length} fallback={<p class="placeholder">No Rollbar errors linked to this task.</p>}>
        <Show when={links().length > 1}>
          <div class="rollbar-chips">
            <For each={links()}>
              {(l) => (
                <button type="button" class="rollbar-chip" classList={{ active: current()?.identifier === l.identifier }} onClick={() => setPicked(l.identifier)}>
                  #{l.identifier}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={item()} fallback={<p class="placeholder">{item.loading ? 'Loading…' : 'Could not load this item (connection removed?).'}</p>}>
          {(it) => (
            <div class="rollbar-detail">
              <h3 class="rollbar-title">
                <span class="rollbar-level" data-level={it().level}>✗ {it().level}</span> {it().title}
              </h3>
              <dl class="rollbar-facts">
                <dt>Item</dt>
                <dd>#{it().identifier}</dd>
                <dt>Status</dt>
                <dd>{it().status}</dd>
                <dt>Environment</dt>
                <dd>{it().environment}</dd>
                <dt>Occurrences</dt>
                <dd>×{it().totalOccurrences}</dd>
                <dt>First seen</dt>
                <dd>{fmt(it().firstOccurrenceAt)}</dd>
                <dt>Last seen</dt>
                <dd>{fmt(it().lastOccurrenceAt)}</dd>
              </dl>
              <p class="muted">Open a terminal/agent to fix it — the link rides the assembled context (11).</p>
            </div>
          )}
        </Show>
      </Show>
    </section>
  )
}
