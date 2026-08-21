import { createMemo, createSignal, For, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { PluginRailItem, PluginSourceDescriptor, PluginSourceEmptyState, Task } from '@acorn/protocol/api.ts'
import PanelGrid from '../../dashboards/PanelGrid'
import { panelRegion, regionScope, sourceRegionOwner } from '../../dashboards/region'
import { activeNodeId } from '../../node/activeNode'
import { createFleetQuery } from '../../node/fanout'
import { FRESHNESS_LABELS } from '../../node/freshness'
import { Alert, Badge, Button, EmptyState, Input, Row, SectionHeader, Toolbar } from '../../ui/primitives'
import Icon from '../../ui/Icon'
import { runChromeAction } from './actions'
import { chromeKey, chromeRevision, readRailItems, scopedSourceItemsPath } from './data'
import { tasksKey, tasksOptions, workspacesOptions } from '../../queries'
import { workspaceForProject } from '../../workspaces/activeWorkspace'
import { PromoteToTaskModal } from '../../integrations/PromoteToTaskModal'
import { decodeProjectSurfaceItem, projectSurfaceRegistry } from '../../registries/projectSurfaces'
import { activateTaskSignals, pathForTask } from '../../tasks/activate'

// The one rail list every descriptor source renders through. Native by construction: `Row`, `Badge`
// and `Icon` are the shell's own primitives, so a third-party rail list is pixel-identical to a
// first-party one under every appearance pack (docs/plugins.md § Descriptors for chrome, frames for
// rectangles).

export type ChromeSourcePanelProps = { pluginId: string; descriptor: PluginSourceDescriptor }

// A source's `emptyState` replaces the host's fixed "Nothing here yet." (docs/plugins.md, the
// paragraph on `emptyState`, for why it's fetch-success-only and bounded to a sentence and one action).
//
// Named SourceEmpty, not EmptyState: it is the descriptor-to-primitive adapter, and the primitive owns
// the name. It contributes the plugin's message and its one action; the geometry comes from shared CSS.
function SourceEmpty(props: { pluginId: string; nodeId: string; empty?: PluginSourceEmptyState }) {
  return (
    <Show when={props.empty} fallback={<EmptyState align="start">Nothing here yet.</EmptyState>}>
      {(empty) => (
        <EmptyState
          align="start"
          action={
            <Show when={empty().action}>
              {(action) => (
                <Button onClick={() => runChromeAction(action(), { pluginId: props.pluginId, nodeId: props.nodeId })}>
                  {empty().actionLabel ?? 'Open'}
                </Button>
              )}
            </Show>
          }
        >
          {empty().message}
        </EmptyState>
      )}
    </Show>
  )
}

export default function ChromeSourcePanel(props: ChromeSourcePanelProps) {
  const navigate = useNavigate()
  const params = useParams()
  const queryClient = useQueryClient()
  // Captured at creation, not read per render. A node switch swaps the QueryClient provider this panel
  // sits under, which remounts it, the same reasoning plugins/frames/register.ts gives for reading
  // `activeNodeId()` at frame construction.
  const nodeId = activeNodeId() ?? ''

  // The fan-out rather than a bare resource, pinned to one node: it is the only reader in the codebase
  // that already has a per-node deadline, a cache fallback and the live/stale/offline vocabulary. An
  // offline node shows the list it last had, badged stale, exactly like every native surface.
  //
  // The project rides in the dependency rather than being read from `params` inside the fetch, so it
  // reaches the cache key as well as the path. Both halves of the pair have to agree on scope now that
  // the fan-out serves its last answer on mount.
  const scope = () => ({ revision: chromeRevision(), projectId: params.projectId })
  const [result, { refetch }] = createFleetQuery(
    ({ projectId }) => chromeKey(props.pluginId, props.descriptor.id, projectId),
    (node, { projectId }, signal) => readRailItems(
      props.pluginId,
      scopedSourceItemsPath(props.descriptor.items, projectId),
      node,
      signal,
    ),
    scope,
    { nodeIds: [nodeId] },
  )

  const row = () => result().rows[0]
  const allItems = () => row()?.data ?? []
  const unavailable = () => result().unavailable[0]

  // Client-side title filter over the loaded list, the same bargain github's PR filter strikes
  // (plugins/github pullList/model.ts): it narrows what the source already returned rather than
  // asking the plugin to search, so no descriptor field and no plugin route change is involved.
  const [filter, setFilter] = createSignal('')
  const items = createMemo(() => {
    const query = filter().trim().toLowerCase()
    if (!query) return allItems()
    return allItems().filter((item) => item.title.toLowerCase().includes(query))
  })

  const [refreshing, setRefreshing] = createSignal(false)
  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await refetch()
    } finally {
      setRefreshing(false)
    }
  }

  const tasks = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const workspace = () => workspaceForProject(workspaces.data, params.projectId)
  const attachTasks = () => {
    const projectIds = new Set(workspace()?.projects.map((project) => project.id) ?? [])
    return (tasks.data ?? []).filter((task) => task.status === 'active' && (projectIds.size === 0 || projectIds.has(task.projectId)))
  }
  const [promoteItem, setPromoteItem] = createSignal<PluginRailItem | null>(null)

  const promote = (event: MouseEvent, item: PluginRailItem): void => {
    event.stopPropagation()
    setPromoteItem(item)
  }

  const select = (item: PluginRailItem): void => {
    if (props.descriptor.onSelect) runChromeAction(props.descriptor.onSelect, {
      pluginId: props.pluginId,
      nodeId,
      item,
      promote: setPromoteItem,
      // Only the `navigate` verb reads these two, and this is the one caller that has them: a rail panel
      // renders under the project route and holds the shell's navigator.
      ...(params.projectId ? { projectId: params.projectId } : {}),
      navigate,
    })
  }

  // The detail half, for a source whose row click addresses a project-scoped surface rather than opening a
  // task pane. Master/detail exactly as every other Source browse is (plugins/github GithubBrowse.tsx),
  // which is the layout a compiled plugin's issue view used to get from a `SourceRouteContribution` and the
  // one the descriptor tier had no way to ask for.
  //
  // `onSelect` is where the binding comes from, and no second manifest field is needed for it: `navigate`
  // already names the surface, and the manifest refuses a project-scoped surface that no source navigates
  // to, so if there is one, this is where it mounts.
  const detail = () => {
    const onSelect = props.descriptor.onSelect
    return onSelect?.verb === 'navigate' ? projectSurfaceRegistry.get(onSelect.surface) : undefined
  }
  // The selection, read back out of the URL. There is no local signal shadowing it on purpose: a
  // project-scoped surface has no task layout to keep a selection in, so the address is the state, which
  // is what makes the row click, a pasted deep link and the back button all the same thing.
  const detailItem = () => {
    const surface = detail()
    return surface ? decodeProjectSurfaceItem(params[surface.item]) : undefined
  }

  const afterPromote = (task: Task): void => {
    setPromoteItem(null)
    void queryClient.invalidateQueries({ queryKey: tasksKey })
    activateTaskSignals(task)
    navigate(pathForTask(task))
  }

  return (
    <main class="panes">
      <section class="pane pane-left">
        <SectionHeader
          count={items().length}
          actions={(
            <>
              <Show when={row() && row()!.freshness !== 'live'}><span class="muted">{FRESHNESS_LABELS[row()!.freshness]}</span></Show>
              <Button
                variant="bare"
                iconOnly
                data-tip={`Refresh ${props.descriptor.label}`}
                aria-label={`Refresh ${props.descriptor.label}`}
                busy={refreshing()}
                onClick={() => void refresh()}
              >
                ↻
              </Button>
            </>
          )}
        >
          {props.descriptor.label}
        </SectionHeader>

        <Toolbar size="sm" ariaLabel={`${props.descriptor.label} filter`}>
          <Input
            kind="filter"
            size="sm"
            placeholder="Filter…"
            aria-label={`Filter ${props.descriptor.label} by title`}
            value={filter()}
            onInput={(event) => setFilter(event.currentTarget.value)}
          />
        </Toolbar>

        {/* A node that did not answer and had nothing cached is a banner, never a failed pane. */}
        <Show when={unavailable()}>
          {(entry) => <Alert>{entry().label} unavailable — {entry().reason}</Alert>}
        </Show>

        {/* `.pane-left` is an overflow:hidden flex column, so the list needs its own scroller or it
            is simply clipped at the pane edge — the shape github's `.pr-list-scroll` and docker's
            `.docker-list` each already have. Every integration browse renders through here, so this
            one wrapper is the Linear, Rollbar and Chrome lists all at once. */}
        <div class="scroll">
          <Show
            when={row()}
            fallback={<EmptyState align="start" busy={!unavailable()}>{unavailable() ? 'No cached items.' : 'Loading…'}</EmptyState>}
          >
            {/* The authored empty state, or the fixed string for a source that declares none. It renders
                only under `row()` — i.e. the plugin's own route ANSWERED, with nothing — because an
                unreachable node is the banner above and "nothing is assigned to you" would be a claim the
                host has no business making on a failed fetch. */}
            <For each={items()} fallback={<SourceEmpty pluginId={props.pluginId} nodeId={nodeId} empty={props.descriptor.emptyState} />}>
              {(item) => (
                <Row
                  onActivate={props.descriptor.onSelect ? () => select(item) : undefined}
                  selected={item.id === detailItem()}
                  leading={<Show when={item.icon}>{(name) => <Icon name={name()} />}</Show>}
                  meta={(
                    <Show
                      when={item.fields?.length}
                      fallback={<Show when={item.subtitle}>{(subtitle) => <span class="muted">{subtitle()}</span>}</Show>}
                    >
                      <For each={item.fields}>{(field) => <span class="ui-row-field muted">{field}</span>}</For>
                    </Show>
                  )}
                  metaFields={item.fields?.length}
                  trailing={(
                    <>
                      <Show when={item.badge}>{(badge) => <Badge>{badge()}</Badge>}</Show>
                      <Show when={item.task && props.descriptor.onSelect?.verb !== 'createTask'}>
                        <Button
                          size="xs"
                          aria-label={`Create or attach task for ${item.title}`}
                          onClick={(event) => promote(event, item)}
                        >
                          +TASK
                        </Button>
                      </Show>
                    </>
                  )}
                  title={item.title}
                >
                  {item.title}
                </Row>
              )}
            </For>
          </Show>
        </div>
      </section>
      {/* The user's own dashboard, beside this source's list (docs/dashboards.md § Placements).
          The easy sibling of a pane's aside, because this section is already the HOST's markup — no
          frame boundary is involved anywhere, so there is nothing here but a scope and a container.

          The same two grid columns the detail half takes, and they cannot both be here: the manifest
          refuses a source that reserves a region AND navigates to a project surface, so this is an
          alternative to the block below rather than a competitor for the rectangle.

          Scoped by (plugin, source), never by project: definitions are per-user-per-node and
          surface-free, so the same board renders beside this source in every project. Too narrow for
          twelve cells is simply always collapsed, and the stored geometry returns when it is widened. */}
      <Show when={props.descriptor.panels}>
        {(declared) => (
          <section class="pane pane-right" style={{ 'grid-column': '2 / -1' }}>
            <PanelGrid
              scope={regionScope(sourceRegionOwner(props.pluginId, props.descriptor.id))}
              region={panelRegion(props.pluginId, declared())}
            />
          </section>
        )}
      </Show>
      {/* Spans the remaining two grid columns: the frame draws its own header and layout, so splitting it
          across mid and right would give it two boxes it cannot lay out across. `pane-right` is what drops
          the trailing border and makes the section a flex column, so the iframe's `height: 100%` resolves
          against the grid row instead of collapsing. */}
      <Show when={detail()}>
        {(surface) => (
          <section class="pane pane-right" style={{ 'grid-column': '2 / -1' }}>
            <Dynamic
              component={surface().component}
              projectId={params.projectId ?? ''}
              item={detailItem()}
            />
          </section>
        )}
      </Show>
      <Show when={promoteItem()}>
        {(item) => (
          <PromoteToTaskModal
            providerId={props.descriptor.id}
            item={item()}
            headerLabel={`+TASK — ${item().id}`}
            itemTitle={item().title}
            attachTasks={attachTasks()}
            existingBranches={(tasks.data ?? []).flatMap((task) => task.branch ? [task.branch] : [])}
            onClose={() => setPromoteItem(null)}
            onCreated={afterPromote}
            onAttached={afterPromote}
          />
        )}
      </Show>
    </main>
  )
}
