import { createSignal, For, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { PluginRailItem, PluginSourceDescriptor, PluginSourceEmptyState, Task } from '@acorn/protocol/api.ts'
import PanelGrid from '../../dashboards/PanelGrid'
import { panelRegion, regionScope, sourceRegionOwner } from '../../dashboards/region'
import { activeNodeId } from '../../node/activeNode'
import { createFleetQuery } from '../../node/fanout'
import { FRESHNESS_LABELS } from '../../node/freshness'
import { Alert, Badge, Button, EmptyState, Row, SectionHeader } from '../../ui/primitives'
import Icon from '../../ui/Icon'
import { runChromeAction } from './actions'
import { chromeKey, chromeRevision, readRailItems, scopedSourceItemsPath } from './data'
import { tasksKey, tasksOptions, workspacesOptions } from '../../queries'
import { workspaceForProject } from '../../workspaces/activeWorkspace'
import { PromoteToTaskModal } from '../../integrations/PromoteToTaskModal'
import { decodeProjectSurfaceItem, projectSurfaceRegistry } from '../../registries/projectSurfaces'
import { activateTaskSignals, pathForTask } from '../../tasks/activate'

// The ONE rail list every descriptor source renders through
// (docs/plugins.md).
//
// Native by construction: `Row`, `Badge` and `Icon` are the shell's own primitives, so a third-party
// rail list is pixel-identical to a first-party one under every appearance pack, and stays that way
// when a pack changes. That is the argument for descriptors over frames at this size — not the cost of
// an iframe, but that the iframe could never look like this.

export type ChromeSourcePanelProps = { pluginId: string; descriptor: PluginSourceDescriptor }

// "Nothing here yet." is true and tells nobody anything, and its uselessness had a real cost: linear
// answered an unmapped workspace by showing the viewer's own assigned issues instead, because a wrong
// list beat a blank one (docs/third-party/linear.md § finding 1). A source can now say what empty means
// here and offer one place to go.
//
// One action, no markup, no per-facet variants. The action is optional and NOT a gap to be filled later
// by widening the verb set: linear's own empty state points at a settings page, which no context-free
// verb can reach, and shipping the message alone is the honest answer to that.
// Named SourceEmpty, not EmptyState: it is the descriptor→primitive adapter, and the primitive owns
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
  // sits under, which remounts it — the same reasoning plugins/frames/register.ts gives for reading
  // `activeNodeId()` at frame construction.
  const nodeId = activeNodeId() ?? ''

  // The fan-out rather than a bare resource, pinned to one node: it is the only reader in the codebase
  // that already has a per-node deadline, a cache fallback and the live/stale/offline vocabulary. An
  // offline node shows the list it last had, badged stale, exactly like every native surface.
  const [result] = createFleetQuery(
    () => chromeKey(props.pluginId, props.descriptor.id),
    (node, _revision, signal) => readRailItems(
      props.pluginId,
      scopedSourceItemsPath(props.descriptor.items, params.projectId),
      node,
      signal,
    ),
    chromeRevision,
    { nodeIds: [nodeId] },
  )

  const row = () => result().rows[0]
  const items = () => row()?.data ?? []
  const unavailable = () => result().unavailable[0]

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

  // The DETAIL half, for a source whose row click addresses a project-scoped surface rather than opening a
  // task pane. Master/detail exactly as every other Source browse is (plugins/github GithubBrowse.tsx),
  // which is the layout a compiled plugin's issue view used to get from a `SourceRouteContribution` and the
  // one the descriptor tier had no way to ask for.
  //
  // `onSelect` is where the binding comes from, and no second manifest field is needed for it: `navigate`
  // already names the surface, and the manifest refuses a project-scoped surface that no source navigates
  // to — so if there is one, this is where it mounts.
  const detail = () => {
    const onSelect = props.descriptor.onSelect
    return onSelect?.verb === 'navigate' ? projectSurfaceRegistry.get(onSelect.surface) : undefined
  }
  // The selection, read back out of the URL. There is no local signal shadowing it on purpose: a
  // project-scoped surface has no task layout to keep a selection in, so the address IS the state — which
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
          actions={<Show when={row() && row()!.freshness !== 'live'}><span class="muted">{FRESHNESS_LABELS[row()!.freshness]}</span></Show>}
        >
          {props.descriptor.label}
        </SectionHeader>

        {/* A node that did not answer and had nothing cached is a banner, never a failed pane. */}
        <Show when={unavailable()}>
          {(entry) => <Alert>{entry().label} unavailable — {entry().reason}</Alert>}
        </Show>

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
                meta={<Show when={item.subtitle}>{(subtitle) => <span class="muted">{subtitle()}</span>}</Show>}
                trailing={(
                  <>
                    <Show when={item.badge}>{(badge) => <Badge>{badge()}</Badge>}</Show>
                    <Show when={item.task && props.descriptor.onSelect?.verb !== 'createTask'}>
                      <button
                        type="button"
                        class="ui-btn"
                        data-size="sm"
                        aria-label={`Create or attach task for ${item.title}`}
                        onClick={(event) => promote(event, item)}
                      >
                        +TASK
                      </button>
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
      </section>
      {/* The user's own dashboard, beside this source's list (docs/future/dashboards/placements.md).
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
