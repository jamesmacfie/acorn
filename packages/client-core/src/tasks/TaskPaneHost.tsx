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

  const resize = (
    event: PointerEvent,
    pane: PaneContribution,
    adjacent: PaneContribution,
    paneElement: HTMLElement,
    adjacentElement: HTMLElement,
  ) => {
    event.preventDefault()
    event.currentTarget instanceof HTMLElement && event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const paneWidth = paneElement.getBoundingClientRect().width
    const adjacentWidth = adjacentElement.getBoundingClientRect().width
    let frame = 0
    const apply = (clientX: number) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => dispatch({
        type: 'resize', pane: pane.id, adjacent: adjacent.id, deltaPx: clientX - startX,
        paneWidth, adjacentWidth,
        paneMinWidth: minWidthFor(pane), adjacentMinWidth: minWidthFor(adjacent),
      }))
    }
    const move = (pointer: PointerEvent) => apply(pointer.clientX)
    const up = () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const resizeFromKeyboard = (
    event: KeyboardEvent,
    pane: PaneContribution,
    adjacent: PaneContribution,
    paneElement: HTMLElement,
    adjacentElement: HTMLElement,
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    dispatch({
      type: 'resize', pane: pane.id, adjacent: adjacent.id,
      deltaPx: event.key === 'ArrowRight' ? 16 : -16,
      paneWidth: paneElement.getBoundingClientRect().width,
      adjacentWidth: adjacentElement.getBoundingClientRect().width,
      paneMinWidth: minWidthFor(pane), adjacentMinWidth: minWidthFor(adjacent),
    })
  }

  const slotRefs = new Map<PaneId, HTMLDivElement>()

  return (
    <>
      <div class="task-pane-row" classList={{ maximized: !!maximizedPane(props.task.id) }}>
        <For
          each={visiblePanes()}
          fallback={
            <section class="pane pane-empty workspace-empty contribution-unavailable">
              <div class="workspace-empty-inner">
                <p class="muted">This layout has no panes available in the current environment.</p>
                <p class="muted">Choose an available pane from the switcher.</p>
              </div>
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
                  <button
                    type="button"
                    class="pane-pin-btn"
                    classList={{ active: isPinned(pane.id) }}
                    title={isPinned(pane.id) ? 'Unpin pane' : 'Pin pane'}
                    aria-label={isPinned(pane.id) ? `Unpin ${pane.label}` : `Pin ${pane.label}`}
                    aria-pressed={isPinned(pane.id)}
                    onClick={() => dispatch({ type: 'pin', pane: pane.id })}
                  >
                    {isPinned(pane.id) ? '◆' : '◇'}
                  </button>
                  <Show when={layout().panes.length > 1 || isPinned(pane.id)}>
                    <button
                      type="button"
                      class="pane-close-btn"
                      title={isPinned(pane.id) ? 'Unpin pane before closing' : 'Close pane'}
                      aria-label={isPinned(pane.id) ? `Unpin ${pane.label}` : `Close ${pane.label}`}
                      onClick={() => dispatch({ type: 'close', pane: pane.id })}
                    >✕</button>
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
                      class="pane-divider"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${pane.label} and ${adjacent()?.label ?? 'next pane'}`}
                      tabindex="0"
                      onDblClick={() => dispatch({ type: 'equalize' })}
                      onPointerDown={(event) => {
                        const next = adjacent()
                        const beforeEl = slotRefs.get(pane.id)
                        const afterEl = next && slotRefs.get(next.id)
                        if (next && beforeEl && afterEl) resize(event, pane, next, beforeEl, afterEl)
                      }}
                      onKeyDown={(event) => {
                        const next = adjacent()
                        const beforeEl = slotRefs.get(pane.id)
                        const afterEl = next && slotRefs.get(next.id)
                        if (next && beforeEl && afterEl) resizeFromKeyboard(event, pane, next, beforeEl, afterEl)
                      }}
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
            <button
              type="button"
              class="pane-switch-btn"
              classList={{ active: showsPane(pane.id) }}
              data-tip={pane.label}
              data-tip-key={props.shortcutFor?.(`pane.show.${pane.id}`) ? formatChord(props.shortcutFor(`pane.show.${pane.id}`)!) : pane.defaultChord ? formatChord(pane.defaultChord) : undefined}
              data-tip-sub={`${pane.description ?? pane.label} · ⌘-click to open beside`}
              aria-label={pane.label}
              onClick={(event) => onSwitch(pane.id, event)}
            ><Icon name={pane.glyph} /></button>
          )}
        </For>
        {props.extraButtons}
        {/* Not `disabled` while closing — disabled buttons swallow the mouseover the tooltip needs. */}
        <button
          type="button"
          class="pane-switch-btn pane-switch-close"
          data-tip={props.closing ? 'Removing…' : 'Close task'}
          aria-label={props.closing ? 'Removing task' : 'Close task'}
          aria-busy={props.closing || undefined}
          onClick={() => { if (!props.closing) props.onCloseTask() }}
        >
          {props.closing ? <span class="spin">⠿</span> : '✕'}
        </button>
      </nav>
    </>
  )
}
