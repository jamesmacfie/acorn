import { For, Show, type JSX } from 'solid-js'
import type { Task } from '../infra/queries'
import { paneAvailable, paneContribution, paneContributions, type PaneContribution, type PaneId } from '../registries/panes'
import { activeNodeId } from '../infra/node/activeNode'
import { nodeState } from '../infra/node/fleet'
import { freshnessOf, type Freshness } from '../infra/node/freshness'
import NodeChip from '../infra/node/NodeChip'
import { ContributionBoundary } from '../kit/components/ContributionBoundary'
// Imported for `use:paneFocus` below. Solid compiles a directive to a bare reference to this
// identifier, so without the import the first pane to render dies on "paneFocus is not defined".
// The linter cannot see that use, hence the suppression.
// eslint-disable-next-line no-unused-vars -- used by the `use:paneFocus` directive on the pane element.
import { paneFocus } from './paneFocus'
import { dispatchLayout, layoutForTask, maximizedPane } from './tasks'
import { defaultLayout, type LayoutAction } from './layout'
import { formatChord } from './paneShortcuts'
import { Button, EmptyState } from '../kit/components/primitives'
import { RailTab } from '../tabs/RailTab'
import { markersFor } from '../registries/railMarkers'
import { createSplitDrag } from '../kit/lib/split'

export default function TaskPaneHost(props: {
  task: Task
  extraButtons?: JSX.Element
  onCloseTask: () => void
  closing?: boolean // archive/teardown in flight → the close button shows a spinner
  shortcutFor?: (id: string) => string | null | undefined
}) {
  const layout = () => layoutForTask(props.task.id) ?? defaultLayout()
  const dispatch = (action: LayoutAction) => dispatchLayout(props.task.id, action)
  const switcherPanes = () => paneContributions().filter((pane) => paneAvailable(pane, props.task))
  const registeredLayoutPanes = () => {
    const chosen = layout().panes.flatMap((id) => {
      const pane = paneContribution(id)
      return pane && paneAvailable(pane, props.task) ? [pane] : []
    })
    // A layout can name a pane this task cannot show: DEFAULT_PANE is the PR pane, and a task on a
    // project with no GitHub remote has no PR. Fall back to the first pane the task does offer, so
    // the empty state below means what it says.
    return chosen.length ? chosen : switcherPanes().slice(0, 1)
  }
  const visiblePanes = () => {
    const panes = registeredLayoutPanes()
    const maximized = maximizedPane(props.task.id)
    return maximized ? panes.filter((pane) => pane.id === maximized) : panes
  }
  const showsPane = (id: PaneId) => layout().panes.includes(id)
  const isPinned = (id: PaneId) => layout().pinned?.includes(id) ?? false
  const onSwitch = (pane: PaneId, event: MouseEvent) =>
    dispatch(event.metaKey || event.ctrlKey ? { type: 'add', pane } : { type: 'show', pane })

  // Hidden while everything is fine, so a healthy node adds no noise to a pane header. One value
  // for the whole task view, because it reports the node's state rather than a per-pane query
  // (registries/panes.ts).
  const nodeFreshness = (): Freshness => freshnessOf(nodeState(activeNodeId() ?? ''))

  const weightFor = (pane: PaneId) => layout().weights?.[pane] ?? 1
  const minWidthFor = (pane: PaneContribution) => pane.minWidth ?? 240

  const slotRefs = new Map<PaneId, HTMLDivElement>()

  // Pointer capture, rAF coalescing, selection suppression, and the arrow/Home/End keys come from
  // createSplitDrag; the weight model stays here. Widths are snapshotted at pointer-down, because
  // the reducer works from the sizes the drag started at and re-measuring compounds the delta.
  const paneDrag = (pane: PaneContribution, adjacent: () => PaneContribution | undefined) => {
    let paneWidth = 0
    let adjacentWidth = 0
    const measure = () => {
      const next = adjacent()
      paneWidth = (next && slotRefs.get(pane.id)?.getBoundingClientRect().width) ?? 0
      adjacentWidth = (next && slotRefs.get(next.id)?.getBoundingClientRect().width) ?? 0
    }
    return createSplitDrag({
      axis: 'x',
      label: `Resize ${pane.label} and ${adjacent()?.label ?? 'next pane'}`,
      onStart: measure,
      onDelta: (deltaPx) => {
        const next = adjacent()
        // A keyboard nudge never fired onStart, so it has no snapshot of its own.
        if (!next) return
        if (!paneWidth) measure()
        if (!paneWidth) return
        dispatch({
          type: 'resize', pane: pane.id, adjacent: next.id, deltaPx,
          paneWidth, adjacentWidth,
          paneMinWidth: minWidthFor(pane), adjacentMinWidth: minWidthFor(next),
        })
      },
      onReset: () => dispatch({ type: 'equalize' }),
    })
  }

  return (
    <>
      <div class="task-pane-row" classList={{ maximized: !!maximizedPane(props.task.id) }}>
        <For
          each={visiblePanes()}
          fallback={
            <section class="pane pane-empty workspace-empty contribution-unavailable">
              <EmptyState title="No panes available here">
                This layout's panes are all unavailable in the current environment. Choose another
                from the pane switcher.
              </EmptyState>
            </section>
          }
        >
          {(pane, index) => (
            <>
              <div
                ref={(element) => slotRefs.set(pane.id, element)}
                use:paneFocus={{ taskId: props.task.id, paneId: pane.id }}
                class="task-slot"
                classList={{ 'task-slot-pr': pane.id === 'pr', 'task-slot-pinned': isPinned(pane.id) }}
                style={{ 'flex-grow': weightFor(pane.id), 'min-width': `${minWidthFor(pane)}px` }}
                tabindex="0"
                data-pane-id={pane.id}
              >
                <div class="pane-slot-actions">
                  {/* docs/ui-design.md § Connection and staleness vocabulary asks for offline and
                      stale rendering on every node-backed surface. `.pane-slot-actions` is the one
                      piece of chrome every pane has, so this is one edit rather than thirteen. It
                      reports the node's state; see registries/panes.ts for why there is no per-pane
                      query hook. */}
                  <Show when={nodeFreshness() !== 'live'}>
                    <NodeChip nodeId={activeNodeId() ?? ''} compact />
                  </Show>
                  <Button
                    variant="bare"
                    tip={isPinned(pane.id) ? 'Unpin pane' : 'Pin pane'}
                    label={isPinned(pane.id) ? `Unpin ${pane.label}` : `Pin ${pane.label}`}
                    pressed={isPinned(pane.id)}
                    onPress={() => dispatch({ type: 'pin', pane: pane.id })}
                  >
                    {isPinned(pane.id) ? '◆' : '◇'}
                  </Button>
                  <Show when={layout().panes.length > 1 || isPinned(pane.id)}>
                    <Button
                      variant="bare"
                      tip={isPinned(pane.id) ? 'Unpin pane before closing' : 'Close pane'}
                      label={isPinned(pane.id) ? `Unpin ${pane.label}` : `Close ${pane.label}`}
                      onPress={() => dispatch({ type: 'close', pane: pane.id })}
                    >✕</Button>
                  </Show>
                </div>
                <ContributionBoundary contributionId={pane.id}>
                  <pane.component task={props.task} />
                </ContributionBoundary>
              </div>
              <Show when={!maximizedPane(props.task.id) && index() < visiblePanes().length - 1}>
                {(() => {
                  const adjacent = () => visiblePanes()[index() + 1]
                  return (
                    <div
                      {...paneDrag(pane, adjacent).handleProps}
                      class="pane-divider ui-split-handle"
                      data-axis="x"
                    />
                  )
                })()}
              </Show>
            </>
          )}
        </For>
      </div>

      <nav class="pane-switcher" aria-label="Task panes">
        <For each={switcherPanes()}>
          {(pane) => (
            <RailTab
              label={pane.label}
              glyph={pane.glyph}
              active={showsPane(pane.id)}
              markers={markersFor({ kind: 'pane', id: pane.id, taskId: props.task.id })}
              data-tip-key={props.shortcutFor?.(`pane.show.${pane.id}`) ? formatChord(props.shortcutFor(`pane.show.${pane.id}`)!) : pane.defaultChord ? formatChord(pane.defaultChord) : undefined}
              data-tip-sub={`${pane.description ?? pane.label} · ⌘-click to open beside`}
              aria-pressed={showsPane(pane.id)}
              onClick={(event) => onSwitch(pane.id, event)}
            />
          )}
        </For>
        {props.extraButtons}
        {/* Whole-control busy rather than a marker: while the teardown runs there is no close
            action left to offer, so the glyph itself becomes the spinner. RailTab keeps it hoverable
            and focusable, because a disabled button swallows the mouseover the tooltip needs. */}
        <RailTab
          class="tabrail-bottom"
          label="Close task"
          glyph="x"
          tone="danger"
          busy={props.closing}
          busyLabel="Removing…"
          onClick={props.onCloseTask}
        />
      </nav>
    </>
  )
}
