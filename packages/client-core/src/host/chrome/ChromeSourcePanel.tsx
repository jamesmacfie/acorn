import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { PluginRailItem, PluginSourceDescriptor, PluginSourceEmptyState, Task } from '@acorn/protocol/api.ts'
import PanelGrid from '../../features/dashboards/PanelGrid'
import { panelRegion, regionScope, sourceRegionOwner } from '../../features/dashboards/region'
import { activeNodeId } from '../../infra/node/activeNode'
import { createFleetQuery } from '../../infra/node/fanout'
import { FRESHNESS_LABELS } from '../../infra/node/freshness'
import { Alert, Badge, Button, EmptyState, Input, Row, SectionHeader, Toolbar } from '../../kit/components/primitives'
import { Inline } from '../../kit/components/layout/Inline'
import { sidebarCollapsed } from '../../kit/lib/layout/collapseState'
import { IconButton } from '../../kit/components/inputs/IconButton'
import Icon from '../../kit/components/content/Icon'
import { RowActions } from '../../kit/components/layout/RowActions'
import { contextMenuItems, registerContextMenuItems, type ItemRowTarget } from '../registries/panes/contextMenus'
import { ContextMenuItems } from '../registries/panes/contextMenuHost'
import { runChromeAction } from './actions'
import { chromeDeps, chromeKey, readRailItems, scopedSourceItemsPath } from './chromeData'
import { tasksKey, tasksOptions, workspacesOptions } from '../../infra/queries'
import { workspaceForProject } from '../../features/workspaces/activeWorkspace'
import { PromoteToTaskModal } from '../../features/integrations/PromoteToTaskModal'
import { decodeProjectSurfaceItem, projectSurfaceRegistry } from '../registries/panes/projectSurfaces'
import { taskTracksRef } from '../registries/sources/sources'
import { activateTaskSignals, pathForTask } from '../../features/tasks/activate'

const iconTone = (severity: PluginRailItem['severity']): 'accent' | 'warn' | 'danger' | undefined =>
  severity === 'info' ? 'accent' : severity

// The one rail list every descriptor source renders through. `Row`, `Badge` and `Icon` are the shell's
// own primitives, so a third-party rail list matches a first-party one under every appearance pack
// (docs/plugins.md § Descriptors for facts, trees for UI, rectangles for pixels).
//
// Two components rather than one, registered as the `regions` half of `SourceContribution`
// (../registries/sources/sources.ts). This used to be a single component drawing `<main class="panes">`
// with a `.pane pane-left` and a `.pane pane-right`, which meant Linear, Rollbar and HTTP were the
// only browse sources not on `ListDetail`: two inset cards with a gap where GitHub and Workflows had
// one surface and a divider, no resize handle, and no collapse. The comment on the detail half below
// already called this "master/detail like every other Source browse" — the markup was the thing that
// disagreed.
//
// Splitting it costs nothing, because the two halves never shared state. Which row is selected is the
// URL (`decodeProjectSurfaceItem` below), which is why a row click, a pasted link and the back button
// are one thing here. The terminal host already supplied two halves for these sources
// (apps/tui/src/plugins/SourcePanel.tsx); this is the desktop catching up.

export type ChromeSourcePanelProps = { pluginId: string; descriptor: PluginSourceDescriptor }

// A source's `emptyState` replaces the host's fixed "Nothing to show." See docs/plugins.md on
// `emptyState` for why it is fetch-success-only and bounded to a sentence and one action. This adapter
// contributes the plugin's message and its action, and shared CSS owns the geometry.
function SourceEmpty(props: { pluginId: string; nodeId: string; empty?: PluginSourceEmptyState }) {
  return (
    <Show when={props.empty} fallback={<EmptyState align="start" size="sm">Nothing to show.</EmptyState>}>
      {(empty) => (
        <EmptyState
          align="start"
          size="sm"
          action={
            <Show when={empty().action}>
              {(action) => (
                <Button onPress={() => void runChromeAction(action(), { pluginId: props.pluginId, nodeId: props.nodeId })}>
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

/** The list half: the source's rows, its filter, and its refresh. */
export function ChromeSourceList(props: ChromeSourcePanelProps) {
  const navigate = useNavigate()
  const params = useParams()
  const queryClient = useQueryClient()
  // Captured at creation, not read per render. A node switch swaps the QueryClient provider this panel
  // sits under, which remounts it. Same reasoning as plugins/frames/register.ts.
  const nodeId = activeNodeId() ?? ''
  const collapsed = sidebarCollapsed(props.descriptor.id)

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
      scopedSourceItemsPath(props.descriptor.items!, projectId),
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
  const query = () => collapsed() ? '' : filter().trim().toLowerCase()
  const items = createMemo(() => {
    if (!query()) return allItems()
    return allItems().filter((item) => item.title.toLowerCase().includes(query()))
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

  // The active task that already tracks this row, through `taskTracksRef` rather than a link check
  // written here (docs/plugins.md § Context menus). First match, the ceiling RefPanelTaskLink states.
  const trackingTask = (item: PluginRailItem): Task | undefined => {
    const link = item.task?.link
    if (!link) return undefined
    const ref = { providerId: props.descriptor.providerId, displayId: link.identifier, connectionId: link.connectionId }
    return (tasks.data ?? []).find((task) => task.status === 'active' && taskTracksRef(task, ref))
  }
  const openTask = (task: Task): void => {
    activateTaskSignals(task)
    navigate(pathForTask(task))
  }

  // What a row's menu is about. `item` is the row itself, handed back untouched to whoever
  // contributed the action; only `providerId` and `projectId` are facts a `when` may name
  // (docs/plugins.md § Context menus).
  const rowTarget = (item: PluginRailItem): ItemRowTarget => ({
    location: 'item.row',
    id: item.id,
    title: item.title,
    providerId: props.descriptor.id,
    projectId: params.projectId ?? '',
    ...(item.task?.body ? { body: item.task.body } : {}),
    ...(item.task?.link?.ref?.url ? { link: item.task.link.ref.url } : {}),
    item,
  })

  onMount(() => {
    // Core's own row actions, registered rather than written inline, so this list and github's cannot
    // offer different things (docs/plugins.md § Context menus). Two items with opposite `when`s, the
    // pair github's pull list registers: a row that already has a task opens it rather than offering a
    // second. One registration per mounted panel and one panel on screen at a time: `Dynamic`
    // disposes the source it is leaving before it creates the one it is going to.
    //
    // A row with no `task` block has no promotion seed, and a source whose click already creates a
    // task does not need the menu offering it twice.
    const promotable = (target: ItemRowTarget) =>
      !!(target.item as PluginRailItem).task && props.descriptor.onSelect?.verb !== 'createTask'
    const rows = registerContextMenuItems([
      {
        id: 'item.create-task',
        location: 'item.row',
        label: 'Create task…',
        icon: 'square-plus',
        order: 10,
        when: (target) => promotable(target) && !trackingTask(target.item as PluginRailItem),
        run: (target) => setPromoteItem(target.item as PluginRailItem),
      },
      {
        id: 'item.open-task',
        location: 'item.row',
        label: 'Open task',
        icon: 'list-checks',
        order: 10,
        when: (target) => promotable(target) && !!trackingTask(target.item as PluginRailItem),
        run: (target) => {
          const task = trackingTask(target.item as PluginRailItem)
          if (task) openTask(task)
        },
      },
    ])
    onCleanup(() => rows.dispose())
  })

  const select = (item: PluginRailItem): void => {
    // Discarded on purpose: a rail row has already had any refusal as a toast, and only the palette
    // reads the answer back (./actions.ts).
    if (props.descriptor.onSelect) void runChromeAction(props.descriptor.onSelect, {
      pluginId: props.pluginId,
      nodeId,
      item,
      promote: setPromoteItem,
      // Only the `navigate` verb reads these two, and a rail panel is the one caller that has them.
      ...(params.projectId ? { projectId: params.projectId } : {}),
      navigate,
    })
  }

  // The selection, read back out of the URL rather than held here. A project-scoped surface has no
  // task layout to keep a selection in, so the address is the state, which makes a row click, a pasted
  // deep link and the back button the same thing. The detail half reads the same two lines.
  const detailItem = () => {
    const onSelect = props.descriptor.onSelect
    const surface = onSelect?.verb === 'navigate' ? projectSurfaceRegistry.get(onSelect.surface) : undefined
    return surface ? decodeProjectSurfaceItem(params[surface.item]) : undefined
  }

  const afterPromote = (task: Task): void => {
    setPromoteItem(null)
    void queryClient.invalidateQueries({ queryKey: tasksKey })
    openTask(task)
  }

  // Collapsed, the row is its severity glyph over its identifier. A source that sends neither an
  // icon nor a `short` gets a dot, so the rail is still a column of reachable stops rather than a
  // column of blanks.
  const railMark = (item: PluginRailItem) => (
    <>
      <Show when={item.icon} fallback={<Icon name="circle" tone={iconTone(item.severity)} />}>
        {(name) => <Icon name={name()} tone={iconTone(item.severity)} />}
      </Show>
      <Show when={item.short}>{(short) => <span class="ui-row-field">{short()}</span>}</Show>
    </>
  )

  return (
    <>
      <Show when={!collapsed()}>
        {/* No count until the list answers: a 0 while loading claims an empty list. */}
        <SectionHeader
          count={row() ? items().length : undefined}
          actions={(
            <>
              <Show when={row() && row()!.freshness !== 'live'}><span class="muted">{FRESHNESS_LABELS[row()!.freshness]}</span></Show>
              <IconButton
                icon="refresh-cw"
                tip={`Refresh ${props.descriptor.label}`}
                label={`Refresh ${props.descriptor.label}`}
                busy={refreshing()}
                onPress={() => void refresh()}
              />
            </>
          )}
        >
          {props.descriptor.label}
        </SectionHeader>

        <Toolbar size="sm" ariaLabel={`${props.descriptor.label} filter`}>
          <Input
            kind="filter"
            size="sm"
            placeholder={`Filter ${props.descriptor.label}…`}
            label={`Filter ${props.descriptor.label} by title`}
            value={filter()}
            onInput={(value) => setFilter(value)}
          />
        </Toolbar>
      </Show>

      {/* A node that did not answer and had nothing cached is a banner, never a failed pane. Collapsed,
          the banner becomes the one mark it has room for: a sentence in a 48px column wraps to a
          letter a line and says nothing. The reason stays reachable as the mark's tooltip, and
          expanding gives it back in full. */}
      <Show when={unavailable()}>
        {(entry) => (
          <Show
            when={!collapsed()}
            fallback={(
              <Inline>
                <Icon name="triangle-alert" tone="warn" title={`Couldn't reach ${entry().label}. ${entry().reason}`} />
              </Inline>
            )}
          >
            <Alert variant="banner" tone="warn">Couldn't reach {entry().label}. {entry().reason}</Alert>
          </Show>
        )}
      </Show>

      {/* `ListColumn` is an overflow:hidden flex column, so the list needs its own scroller or it is
          clipped at the column edge. Same shape as the kit's `.ui-rows-scroll` and docker's
          `.docker-list`. */}
      <div class="scroll">
          <Show
            when={row()}
            fallback={(
              <Show when={!collapsed()}>
                <EmptyState align="start" busy={!unavailable()}>{unavailable() ? 'No cached items.' : 'Loading…'}</EmptyState>
              </Show>
            )}
          >
            {/* The authored empty state, or the fixed string for a source that declares none. Renders
                only under `row()`, meaning the plugin's route answered with nothing. An unreachable node
                is the banner above, because "nothing is assigned to you" is a claim the host cannot make
                on a failed fetch. A filter that hides every row says so instead, because the source's
                sentence would claim there is nothing at all. */}
            <For
              each={items()}
              fallback={(
                <Show when={!collapsed()}>
                  <Show
                    when={query() && allItems().length}
                    fallback={<SourceEmpty pluginId={props.pluginId} nodeId={nodeId} empty={props.descriptor.emptyState} />}
                  >
                    <EmptyState align="start" size="sm">Nothing matches that filter.</EmptyState>
                  </Show>
                </Show>
              )}
            >
              {(item) => (
                <Row
                  onPress={props.descriptor.onSelect ? () => select(item) : undefined}
                  selected={item.id === detailItem()}
                  collapsed={collapsed() ? railMark(item) : undefined}
                  leading={<Show when={item.icon}>{(name) => <Icon name={name()} tone={iconTone(item.severity)} />}</Show>}
                  meta={(
                    <Show
                      when={item.fields?.length}
                      fallback={<Show when={item.subtitle}>{(subtitle) => <span class="muted">{subtitle()}</span>}</Show>}
                    >
                      <For each={item.fields}>{(field) => <span class="ui-row-field muted">{field}</span>}</For>
                    </Show>
                  )}
                  metaFields={item.fields?.length}
                  metaFirst={item.fieldsFirst}
                  trailing={(
                    <>
                      <Show when={item.badge}>{(badge) => <Badge>{badge()}</Badge>}</Show>
                      {/* Row-level actions behind the shared overflow menu, drawn from the
                          context-menu registry: core's "Create task…" above, the workflows plugin's
                          "Start workflow…" beside it, and a loaded plugin's `item.row` row after
                          those. No menu at all when nothing offers a row. */}
                      <Show when={contextMenuItems('item.row', rowTarget(item)).length}>
                        <RowActions ariaLabel={`Actions for ${item.title}`}>
                          {(menu) => <ContextMenuItems context={menu} location="item.row" target={rowTarget(item)} />}
                        </RowActions>
                      </Show>
                    </>
                  )}
                  title={item.title}
                  tip={item.title}
                  label={item.title}
                >
                  {item.title}
                </Row>
              )}
            </For>
          </Show>
        </div>
      <Show when={promoteItem()}>
        {(item) => (
          <PromoteToTaskModal
            providerId={props.descriptor.id}
            item={item()}
            headerLabel="Create task"
            itemTitle={item().title}
            attachTasks={attachTasks()}
            existingBranches={(tasks.data ?? []).flatMap((task) => task.branch ? [task.branch] : [])}
            onClose={() => setPromoteItem(null)}
            onCreated={afterPromote}
            onAttached={afterPromote}
          />
        )}
      </Show>
    </>
  )
}

/** The detail half: the surface a row click navigates to, or the dashboard this source reserved.
 *
 *  It shares no state with the list. Which row is selected is the URL, which is what makes a row
 *  click, a pasted deep link and the back button the same thing, so both halves read it rather than
 *  one telling the other. */
export function ChromeSourceDetail(props: ChromeSourcePanelProps) {
  const params = useParams()
  const surface = () => {
    const onSelect = props.descriptor.onSelect
    return onSelect?.verb === 'navigate' ? projectSurfaceRegistry.get(onSelect.surface) : undefined
  }

  return (
    <Show when={props.descriptor.panels} fallback={(
      <Show when={surface()}>
        {(found) => (
          <Dynamic
            component={found().component}
            projectId={params.projectId ?? ''}
            item={decodeProjectSurfaceItem(params[found().item])}
          />
        )}
      </Show>
    )}
    >
      {/* The user's own dashboard, beside this source's list (docs/dashboards.md § Placements). Only
          one of the two can be present: the manifest refuses a source that both reserves a region and
          navigates to a project surface.

          Scoped by plugin and source, never by project, because definitions are per-user-per-node and
          surface-free. Too narrow for twelve cells collapses, and the stored geometry returns when it
          is widened. */}
      {(declared) => (
        <PanelGrid
          scope={regionScope(sourceRegionOwner(props.pluginId, props.descriptor.id))}
          region={panelRegion(props.pluginId, declared())}
        />
      )}
    </Show>
  )
}
