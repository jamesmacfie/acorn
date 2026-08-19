import { For, Show, type JSX } from 'solid-js'
import type { Task } from '../queries'
import { paneAvailable, paneContribution, paneContributions, type PaneContribution, type PaneId } from '../registries/panes'
import { activeNodeId } from '../node/activeNode'
import { nodeState } from '../node/fleet'
import { freshnessOf, type Freshness } from '../node/freshness'
import NodeChip from '../node/NodeChip'
import { ContributionBoundary } from '../ui/ContributionBoundary'
// Imported for `use:paneFocus` below. Solid compiles a directive to a bare reference to this
// identifier, so without the import the first pane that renders dies on "paneFocus is not defined".
// The linter cannot see that use, hence the suppression rather than a deletion.
// eslint-disable-next-line no-unused-vars -- used by the `use:paneFocus` directive on the pane element.
import { paneFocus } from './paneFocus'
import Icon from '../ui/Icon'
import { dispatchLayout, layoutForTask, maximizedPane } from './tasks'
import { defaultLayout, type LayoutAction } from './layout'
import { formatChord } from './paneShortcuts'
import { Button, EmptyState } from '../ui/primitives'
import { createSplitDrag } from '../ui/split'

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
    // A layout can name a pane this task cannot show — DEFAULT_PANE is the PR pane, and a task on a
    // plain or GitHub-less project has no PR, which is now the ordinary case rather than the exception.
    // Fall back to the first pane the task DOES offer; the empty state below is then what it says it
    // is: an environment with no panes at all.
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

  // The badge is hidden while everything is fine, which is the common case and the reason this is not
  // visual noise in every pane header. One value for the whole task view, because that is what it reports:
  // the node's state, not a per-pane query (registries/panes.ts explains why there is no per-pane hook).
  const nodeFreshness = (): Freshness => freshnessOf(nodeState(activeNodeId() ?? ''))

  const weightFor = (pane: PaneId) => layout().weights?.[pane] ?? 1
  const minWidthFor = (pane: PaneContribution) => pane.minWidth ?? 240

  const slotRefs = new Map<PaneId, HTMLDivElement>()

  // Pointer capture, rAF coalescing, selection suppression and the arrow/Home/End keys come from
  // createSplitDrag; the weight model stays here. Widths are snapshotted at pointer-down because the
  // reducer works from the sizes the drag STARTED at — re-measuring mid-drag compounds the delta.
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
                  {/* docs/ui-design.md § Connection and staleness vocabulary asks for offline/stale rendering on every
                      node-backed surface. `.pane-slot-actions` is the ONE piece of chrome every pane has,
                      so this is one edit rather than thirteen — and it is rendered only when there is
                      something to say, so a healthy node changes nothing on screen.
                      It reports the NODE's state, which is the reactive half of docs/ui-design.md's vocabulary; see
                      registries/panes.ts for why there is no per-pane query hook. */}
                  <Show when={nodeFreshness() !== 'live'}>
                    <NodeChip nodeId={activeNodeId() ?? ''} compact />
                  </Show>
                  <Button
                    variant="bare" class="pane-pin-btn"
                    classList={{ active: isPinned(pane.id) }}
                    data-tip={isPinned(pane.id) ? 'Unpin pane' : 'Pin pane'}
                    aria-label={isPinned(pane.id) ? `Unpin ${pane.label}` : `Pin ${pane.label}`}
                    aria-pressed={isPinned(pane.id)}
                    onClick={() => dispatch({ type: 'pin', pane: pane.id })}
                  >
                    {isPinned(pane.id) ? '◆' : '◇'}
                  </Button>
                  <Show when={layout().panes.length > 1 || isPinned(pane.id)}>
                    <Button
                      variant="bare" class="pane-close-btn"
                      data-tip={isPinned(pane.id) ? 'Unpin pane before closing' : 'Close pane'}
                      aria-label={isPinned(pane.id) ? `Unpin ${pane.label}` : `Close ${pane.label}`}
                      onClick={() => dispatch({ type: 'close', pane: pane.id })}
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
            <Button
              variant="bare" class="pane-switch-btn"
              classList={{ active: showsPane(pane.id) }}
              data-tip={pane.label}
              data-tip-key={props.shortcutFor?.(`pane.show.${pane.id}`) ? formatChord(props.shortcutFor(`pane.show.${pane.id}`)!) : pane.defaultChord ? formatChord(pane.defaultChord) : undefined}
              data-tip-sub={`${pane.description ?? pane.label} · ⌘-click to open beside`}
              aria-label={pane.label}
              onClick={(event) => onSwitch(pane.id, event)}
            ><Icon name={pane.glyph} /></Button>
          )}
        </For>
        {props.extraButtons}
        {/* Not `disabled` while closing — disabled buttons swallow the mouseover the tooltip needs. */}
        <Button
          variant="bare" class="pane-switch-btn pane-switch-close"
          data-tip={props.closing ? 'Removing…' : 'Close task'}
          aria-label={props.closing ? 'Removing task' : 'Close task'}
          aria-busy={props.closing || undefined}
          onClick={() => { if (!props.closing) props.onCloseTask() }}
        >
          {props.closing ? <span class="spin">⠿</span> : '✕'}
        </Button>
      </nav>
    </>
  )
}
