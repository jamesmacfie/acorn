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
import { Menu } from '../../ui/Menu'
import { RowActions } from '../../ui/RowActions'
import { runChromeAction } from './actions'
import { chromeDeps, chromeKey, readRailItems, scopedSourceItemsPath } from './data'
import { tasksKey, tasksOptions, workspacesOptions } from '../../queries'
import { workspaceForProject } from '../../workspaces/activeWorkspace'
import { PromoteToTaskModal } from '../../integrations/PromoteToTaskModal'
import { decodeProjectSurfaceItem, projectSurfaceRegistry } from '../../registries/projectSurfaces'
import { activateTaskSignals, pathForTask } from '../../tasks/activate'

// The one rail list every descriptor source renders through. `Row`, `Badge` and `Icon` are the shell's
// own primitives, so a third-party rail list matches a first-party one under every appearance pack
// (docs/plugins.md § Descriptors for facts, trees for UI, rectangles for pixels).

export type ChromeSourcePanelProps = { pluginId: string; descriptor: PluginSourceDescriptor }

// A source's `emptyState` replaces the host's fixed "Nothing here yet." See docs/plugins.md on
// `emptyState` for why it is fetch-success-only and bounded to a sentence and one action. This adapter
// contributes the plugin's message and its action, and shared CSS owns the geometry.
function SourceEmpty(props: { pluginId: string; nodeId: string; empty?: PluginSourceEmptyState }) {
  return (
    <Show when={props.empty} fallback={<EmptyState align="start">Nothing here yet.</EmptyState>}>
      {(empty) => (
        <EmptyState
          align="start"
          action={
            <Show when={empty().action}>
              {(action) => (
                <Button onPress={() => runChromeAction(action(), { pluginId: props.pluginId, nodeId: props.nodeId })}>
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
  // sits under, which remounts it. Same reasoning as plugins/frames/register.ts.
  const nodeId = activeNodeId() ?? ''

  // The fan-out rather than a bare resource, pinned to one node: it is the only reader with a per-node
  // deadline, a cache fallback and the live/stale/offline vocabulary. An offline node shows the list it
  // last had, badged stale, like every native surface.
  //
  // The project rides in the dependency rather than being read from `params` inside the fetch, so it
  // reaches the cache key as well as the path. The fan-out serves its last answer on mount, so both
  // halves have to agree on scope.
  //
  // A source that didn't declare `projectScoped` drops out of both. Its rows are the same rows in every
  // project, so carrying the project would split one cache entry into one per project and refetch the
  // identical list on every project switch. The `navigate` verb below still gets the project, because
  // that addresses a surface at `/p/:projectId/x/…` whether or not the rail cares.
  const scope = () => ({
    revision: chromeDeps(props.pluginId),
    projectId: props.descriptor.projectScoped ? params.projectId : undefined,
  })
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
  // (plugins/github pullList/model.ts). It narrows what the source returned rather than asking the
  // plugin to search, so no descriptor field and no plugin route is involved.
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


  const select = (item: PluginRailItem): void => {
    if (props.descriptor.onSelect) runChromeAction(props.descriptor.onSelect, {
      pluginId: props.pluginId,
      nodeId,
      item,
      promote: setPromoteItem,
      // Only the `navigate` verb reads these two, and a rail panel is the one caller that has them.
      ...(params.projectId ? { projectId: params.projectId } : {}),
      navigate,
    })
  }

  // The detail half, for a source whose row click addresses a project-scoped surface rather than opening
  // a task pane. Master/detail like every other Source browse (plugins/github GithubBrowse.tsx).
  //
  // The binding comes from `onSelect`, with no second manifest field: `navigate` names the surface, and
  // the manifest refuses a project-scoped surface that no source navigates to.
  const detail = () => {
    const onSelect = props.descriptor.onSelect
    return onSelect?.verb === 'navigate' ? projectSurfaceRegistry.get(onSelect.surface) : undefined
  }
  // The selection, read back out of the URL. A project-scoped surface has no task layout to hold a
  // selection, so the address is the state, which makes a row click, a pasted deep link and the back
  // button the same thing.
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
                tip={`Refresh ${props.descriptor.label}`}
                label={`Refresh ${props.descriptor.label}`}
                busy={refreshing()}
                onPress={() => void refresh()}
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
            label={`Filter ${props.descriptor.label} by title`}
            value={filter()}
            onInput={(value) => setFilter(value)}
          />
        </Toolbar>

        {/* A node that did not answer and had nothing cached is a banner, never a failed pane. */}
        <Show when={unavailable()}>
          {(entry) => <Alert>{entry().label} unavailable — {entry().reason}</Alert>}
        </Show>

        {/* `.pane-left` is an overflow:hidden flex column, so the list needs its own scroller or it is
            clipped at the pane edge. Same shape as the kit's `.ui-rows-scroll` and docker's
            `.docker-list`. */}
        <div class="scroll">
          <Show
            when={row()}
            fallback={<EmptyState align="start" busy={!unavailable()}>{unavailable() ? 'No cached items.' : 'Loading…'}</EmptyState>}
          >
            {/* The authored empty state, or the fixed string for a source that declares none. Renders
                only under `row()`, meaning the plugin's route answered with nothing. An unreachable node
                is the banner above, because "nothing is assigned to you" is a claim the host cannot make
                on a failed fetch. */}
            <For each={items()} fallback={<SourceEmpty pluginId={props.pluginId} nodeId={nodeId} empty={props.descriptor.emptyState} />}>
              {(item) => (
                <Row
                  onPress={props.descriptor.onSelect ? () => select(item) : undefined}
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
                      {/* Row-level actions behind the shared overflow menu. Creating a task is the
                          only one today; task, workflow and agent verbs land here next, which is why
                          this is a menu rather than the button it replaced. */}
                      <Show when={item.task && props.descriptor.onSelect?.verb !== 'createTask'}>
                        <RowActions ariaLabel={`Actions for ${item.title}`}>
                          {(menu) => (
                            <Menu.Item context={menu} onSelect={() => setPromoteItem(item)}>
                              Create task…
                            </Menu.Item>
                          )}
                        </RowActions>
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
      {/* The user's own dashboard, beside this source's list (docs/dashboards.md § Placements). This
          section is the host's own markup, so there is nothing here but a scope and a container.

          It takes the same two grid columns as the detail half below, and only one can be present: the
          manifest refuses a source that both reserves a region and navigates to a project surface.

          Scoped by plugin and source, never by project, because definitions are per-user-per-node and
          surface-free. Too narrow for twelve cells collapses, and the stored geometry returns when it
          is widened. */}
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
      {/* Spans the remaining two grid columns, because the frame draws its own header and layout and
          cannot lay out across two boxes. `pane-right` drops the trailing border and makes the section a
          flex column, so the iframe's `height: 100%` resolves against the grid row. */}
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
            headerLabel={`Create task — ${item().id}`}
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
