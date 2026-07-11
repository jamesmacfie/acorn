import { wsRegisterUi, wsSendUiState, type UiCommandResult } from '../wsClient'
import {
  activeTaskId,
  dispatchLayout,
  focusedPane,
  maximizedPane,
  selectedSource,
  setActiveTaskId,
  setSelectedSource,
  taskLayouts,
} from '../tasks/tasks'
import type { LayoutAction, PaneId } from '../tasks/layout'

// UI control client (docs/public-api.md). The renderer half of the broker: it
// registers this window, maps public command ids + input to the existing layout/task reducers, and
// reports presentation snapshots. Presentation state stays owned by the reducers — this is only the
// crossing. Commands not yet mapped return command_unavailable (their reducer wiring is additive).

const WINDOW_ID = 'primary'
let revision = 0

// Build the serializable presentation snapshot from the live signals (core-api.md §9).
function snapshot(): Record<string, unknown> {
  const taskId = activeTaskId()
  const layouts: Record<string, unknown> = {}
  for (const [id, layout] of Object.entries(taskLayouts())) {
    layouts[id] = { panes: layout.panes, ...(layout.pinned ? { pinned: layout.pinned } : {}), ...(layout.weights ? { weights: layout.weights } : {}) }
  }
  const focused = taskId ? focusedPane(taskId) : undefined
  const maxPane = taskId ? maximizedPane(taskId) : undefined
  return {
    windowId: WINDOW_ID,
    primary: true,
    ready: true,
    route: typeof location !== 'undefined' ? location.pathname : '/',
    activeWorkspaceId: null,
    activeTaskId: taskId,
    selectedSourceId: selectedSource(),
    layouts,
    focusedPane: taskId && focused ? { taskId, paneId: focused } : null,
    maximized: taskId && maxPane ? { kind: 'pane', taskId, paneId: maxPane } : { kind: 'none' },
    terminalDrawer: null,
    agentsPanel: null,
    overlay: null,
    revision,
  }
}

const ok = (): UiCommandResult => ({ ok: true, result: { changed: true }, revision })
const unavailable = (id: string): UiCommandResult => ({ ok: false, error: { code: 'command_unavailable', message: `Command ${id} is not wired in this window` }, revision })

// Map a public command id + input to a layout/task reducer action.
async function handle(commandId: string, input: unknown): Promise<UiCommandResult> {
  const p = (input ?? {}) as Record<string, unknown>
  const pane = p.paneId as PaneId
  const taskId = p.taskId as string
  let action: LayoutAction | null = null
  switch (commandId) {
    case 'core.pane.show':
      action = { type: p.mode === 'add' ? 'add' : 'show', pane }
      break
    case 'core.pane.close':
      action = { type: 'close', pane }
      break
    case 'core.pane.pin.set':
      action = { type: 'pin', pane, pinned: Boolean(p.pinned) }
      break
    case 'core.pane.move':
      action = { type: 'move', pane, direction: p.direction === 'left' ? -1 : 1 }
      break
    case 'core.task.activate':
      setActiveTaskId(taskId)
      if (p.paneId) dispatchLayout(taskId, { type: 'show', pane: pane })
      revision++
      wsSendUiState(WINDOW_ID, snapshot())
      return ok()
    case 'core.source.activate':
      setSelectedSource(String(p.sourceId))
      revision++
      wsSendUiState(WINDOW_ID, snapshot())
      return ok()
    default:
      return unavailable(commandId)
  }
  if (action) {
    dispatchLayout(taskId, action)
    revision++
    wsSendUiState(WINDOW_ID, snapshot())
    return ok()
  }
  return unavailable(commandId)
}

// Register this window with the broker after startup restore. Returns a disposer.
export function activateUiControl(): () => void {
  return wsRegisterUi(WINDOW_ID, true, snapshot(), handle)
}
