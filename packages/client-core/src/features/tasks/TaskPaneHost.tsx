import { createEffect, createSignal, createUniqueId, For, onCleanup, Show, type JSX } from 'solid-js'
import type { PaneSwitcherProps } from '@acorn/protocol/paneSwitcher.ts'
import type { Task } from '../../infra/queries'
import { paneAvailable, paneContribution, paneContributions, paneRegistry, type PaneContribution, type PaneId } from '../../host/registries/panes/panes'
import { activeNodeId } from '../../infra/node/activeNode'
import { nodeState } from '../../infra/node/fleet'
import { freshnessOf, type Freshness } from '../../infra/node/freshness'
import NodeChip from '../fleet/NodeChip'
import { ContributionBoundary } from '../../kit/components/content/ContributionBoundary'
// Imported for `use:paneFocus` below. Solid compiles a directive to a bare reference to this
// identifier, so without the import the first pane to render dies on "paneFocus is not defined".
// The linter cannot see that use, hence the suppression.
// eslint-disable-next-line no-unused-vars -- used by the `use:paneFocus` directive on the pane element.
import { paneFocus } from './paneFocus'
import { dispatchLayout, layoutForTask, maximizedPane, setMaximizedPane } from './tasks'
import { applyLayoutAction, defaultLayout, type LayoutAction, type TaskLayout } from './taskLayout'
import { formatChord } from './paneShortcuts'
import { EmptyState } from '../../kit/components/primitives'
import { IconButton } from '../../kit/components/inputs/IconButton'
import { RailTab } from '../tabs/RailTab'
import { createSplitDrag } from '../../kit/lib/layout/split'
import PaneSwitcher from './PaneSwitcher'
import ExclusiveSlotHost from '../../host/plugins/ExclusiveSlotHost'
import { registerCoreExclusiveSlot } from '../../host/registries/extensionPoints/exclusiveSlots'
import { registerContextMenuItems, type RailPaneTarget } from '../../host/registries/panes/contextMenus'
import { ContextMenuHost, type ContextMenuOpening } from '../../host/registries/panes/contextMenuHost'

registerCoreExclusiveSlot('pane.switcher', (props) => <PaneSwitcher {...(props.value as PaneSwitcherProps)} />)

export default function TaskPaneHost(props: {
  task: Task
  extraButtons?: JSX.Element
  // Absent for an archived task's preview, which has nothing left to close (features/archive).
  onCloseTask?: () => void
  closing?: boolean // archive/teardown in flight → the close button shows a spinner
  shortcutFor?: (id: string) => string | null | undefined
}) {
  const menuId = createUniqueId()
  const [paneMenu, setPaneMenu] = createSignal<ContextMenuOpening | null>(null)
  let paneMenuReturnFocus: HTMLElement | undefined
  let openedPane: unknown
  const stored = () => layoutForTask(props.task.id) ?? defaultLayout()
  const switcherPanes = () => paneContributions().filter((pane) => pane.showInSwitcher !== false && paneAvailable(pane, props.task))
  const chosenPanes = () => stored().panes.flatMap((id) => {
    const pane = paneContribution(id)
    return pane && paneAvailable(pane, props.task) ? [pane] : []
  })
  // A layout can name only panes this task cannot show: DEFAULT_PANE is the PR pane, and a task on a
  // project with no GitHub remote has no PR. Then the task draws the first pane it does offer, and
  // `layout()` is the layout as drawn, so the switcher marks that pane and add, close, and pin act on
  // it. The repair is written only when the person acts (`dispatch`), never from render, because a
  // render can run before the saved layouts have loaded and would overwrite them.
  const fallbackPane = () => (chosenPanes().length ? undefined : switcherPanes()[0])
  const layout = (): TaskLayout => {
    const fallback = fallbackPane()
    return fallback ? { ...stored(), panes: [fallback.id] } : stored()
  }
  const dispatch = (action: LayoutAction) => dispatchLayout(
    props.task.id,
    fallbackPane() ? { type: 'replace', layout: applyLayoutAction(layout(), action) } : action,
  )
  const registeredLayoutPanes = () => {
    const fallback = fallbackPane()
    return fallback ? [fallback] : chosenPanes()
  }
  const visiblePanes = () => {
    const panes = registeredLayoutPanes()
    const maximized = maximizedPane(props.task.id)
    return maximized ? panes.filter((pane) => pane.id === maximized) : panes
  }
  const isPinned = (id: PaneId) => layout().pinned?.includes(id) ?? false
  const paneMenuTarget = (id: string): RailPaneTarget | null => {
    const pane = switcherPanes().find((entry) => entry.id === id)
    const nodeId = activeNodeId()
    if (!pane || !nodeId) return null
    return {
      location: 'rail.pane', id, title: pane.label, nodeId,
      taskId: props.task.id, projectId: props.task.projectId,
      pinned: isPinned(id), shown: registeredLayoutPanes().some((entry) => entry.id === id),
    }
  }
  const openPaneMenu = (id: string, at: { x: number; y: number }) => {
    const target = paneMenuTarget(id)
    if (!target) return
    paneMenuReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    openedPane = paneRegistry.get(id)
    setPaneMenu({ at, target })
  }
  const paneAction = registerContextMenuItems<'rail.pane'>([
    { id: `${menuId}:open`, location: 'rail.pane', label: 'Open', order: 100,
      when: (target) => target.taskId === props.task.id,
      run: (target) => { if (paneMenuTarget(target.id)?.taskId === target.taskId && target.nodeId === activeNodeId()) dispatch({ type: 'show', pane: target.id }) } },
    { id: `${menuId}:add`, location: 'rail.pane', label: 'Open beside', order: 110,
      when: (target) => target.taskId === props.task.id,
      run: (target) => { if (paneMenuTarget(target.id)?.taskId === target.taskId && target.nodeId === activeNodeId()) dispatch({ type: 'add', pane: target.id }) } },
    { id: `${menuId}:pin`, location: 'rail.pane', label: 'Pin', order: 120,
      when: (target) => target.taskId === props.task.id && target.shown && !target.pinned,
      run: (target) => { if (paneMenuTarget(target.id)?.shown && target.nodeId === activeNodeId()) dispatch({ type: 'pin', pane: target.id, pinned: true }) } },
    { id: `${menuId}:unpin`, location: 'rail.pane', label: 'Unpin', order: 120,
      when: (target) => target.taskId === props.task.id && target.shown && target.pinned,
      run: (target) => { if (paneMenuTarget(target.id)?.pinned && target.nodeId === activeNodeId()) dispatch({ type: 'pin', pane: target.id, pinned: false }) } },
    { id: `${menuId}:close`, location: 'rail.pane', label: 'Close', order: 1000, tone: 'danger',
      when: (target) => target.taskId === props.task.id && target.shown && !target.pinned && registeredLayoutPanes().length > 1,
      run: (target) => { if (paneMenuTarget(target.id)?.shown && !isPinned(target.id) && registeredLayoutPanes().length > 1 && target.nodeId === activeNodeId()) dispatch({ type: 'close', pane: target.id }) } },
  ])
  onCleanup(() => paneAction.dispose())
  createEffect(() => {
    const target = paneMenu()?.target
    if (target?.location === 'rail.pane' &&
      (target.nodeId !== activeNodeId() || target.taskId !== props.task.id || !paneMenuTarget(target.id) ||
        paneRegistry.get(target.id) !== openedPane)) setPaneMenu(null)
  })
  const switcherProps = (): PaneSwitcherProps => ({
    panes: switcherPanes().map((pane) => ({
      id: pane.id,
      label: pane.label,
      description: pane.description,
      icon: pane.glyph,
      shown: registeredLayoutPanes().some((drawn) => drawn.id === pane.id),
      pinned: isPinned(pane.id),
      shortcut: props.shortcutFor?.(`pane.show.${pane.id}`)
        ? formatChord(props.shortcutFor(`pane.show.${pane.id}`)!)
        : pane.defaultChord ? formatChord(pane.defaultChord) : undefined,
    })),
    task: { id: props.task.id, title: props.task.title, projectId: props.task.projectId },
    maximized: maximizedPane(props.task.id) ?? null,
    show: (id) => dispatch({ type: 'show', pane: id }),
    add: (id) => dispatch({ type: 'add', pane: id }),
    close: (id) => dispatch({ type: 'close', pane: id }),
    pin: (id) => dispatch({ type: 'pin', pane: id }),
    toggleMaximize: (id) => setMaximizedPane(props.task.id, maximizedPane(props.task.id) === id ? null : id),
    equalize: () => dispatch({ type: 'equalize' }),
    openContextMenu: openPaneMenu,
  })

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
              <EmptyState title="No pane to show">Pick one from the bar on the right.</EmptyState>
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
                  <IconButton
                    size="xs"
                    icon={isPinned(pane.id) ? 'pin-off' : 'pin'}
                    tip={isPinned(pane.id) ? 'Unpin' : 'Keep open'}
                    tipSub="A pinned pane stays when you switch panes."
                    label={isPinned(pane.id) ? `Unpin ${pane.label}` : `Pin ${pane.label}`}
                    pressed={isPinned(pane.id)}
                    onPress={() => dispatch({ type: 'pin', pane: pane.id })}
                  />
                  <Show when={registeredLayoutPanes().length > 1 || isPinned(pane.id)}>
                    <IconButton
                      size="xs"
                      icon="x"
                      tip={isPinned(pane.id) ? 'Unpin to close' : 'Close pane'}
                      label={isPinned(pane.id) ? `Unpin ${pane.label}` : `Close ${pane.label}`}
                      onPress={() => dispatch({ type: 'close', pane: pane.id })}
                    />
                  </Show>
                </div>
                <ContributionBoundary contributionId={pane.id} owner={paneRegistry.ownerOf(pane.id)}>
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
        <ExclusiveSlotHost slot="pane.switcher" value={switcherProps()} />
        {props.extraButtons}
        {/* Whole-control busy rather than a marker: while the teardown runs there is no close
            action left to offer, so the glyph itself becomes the spinner. RailTab keeps it hoverable
            and focusable, because a disabled button swallows the mouseover the tooltip needs. */}
        <Show when={props.onCloseTask}>
          {(close) => (
            <RailTab
              class="tabrail-bottom"
              label="Archive task"
              glyph="x"
              tone="danger"
              busy={props.closing}
              busyLabel="Archiving…"
              onClick={() => close()()}
            />
          )}
        </Show>
      </nav>
      <ContextMenuHost
        location="rail.pane"
        ariaLabel={paneMenu() ? `Actions for ${paneMenu()!.target.title}` : 'Pane actions'}
        opening={paneMenu}
        onClose={() => setPaneMenu(null)}
        returnFocus={() => paneMenuReturnFocus?.isConnected ? paneMenuReturnFocus : undefined}
      />
    </>
  )
}
