// What another plugin may add beside the terminal's own controls (docs/plugins/toolbar-actions.md).
//
// Facts about the selected session and one action. A contributor never gets the PTY: no input, no
// output, no environment, no command history, and no process handle. Running a command stays the
// person's, in the terminal itself.

export const TERMINAL_TOOLBAR_ACTIONS_POINT = 'terminal:toolbar-actions'

/** How many contributors draw before the host shows a count of the rest. */
export const TERMINAL_TOOLBAR_ACTIONS_MAX = 4

/** What a contributor is mounted with. `session` is the selected session, absent when there is none. */
export type TerminalToolbarProps = {
  taskId: string
  projectId?: string
  session?: { id: string; title: string; running: boolean }
}

/** `host.invoke('interrupt', payload)`. Refused unless `expectedSessionId` is still the selected,
 *  running session of the task the contributor was mounted for. */
export type TerminalInterruptPayload = { expectedSessionId: string }

/**
 * What `interrupt` answers. A refusal, not an error, so the contributor can say why in its own control.
 *
 * - `needs_person`: nobody pressed anything in the contributor's tree just now.
 * - `changed`: the selected session, its task, its running state, or the Node changed.
 */
export type TerminalToolbarResult = { ok: true } | { ok: false; reason: 'needs_person' | 'changed' }

/**
 * The checks both hosts make before a contributor's interrupt, so the desktop drawer and the terminal
 * client can't drift apart. Returns the refusal, or `null` to go ahead.
 *
 * `live` is the host's own answer to "is this still the task and Node the contributor was mounted
 * for". `selected` is the session the person has selected now, not the one the payload names.
 */
export function interruptRefusal(input: {
  byPerson: boolean
  payload: unknown
  mountedTaskId: string
  live: boolean
  selected: { id: string; taskId: string; running: boolean } | null
}): TerminalToolbarResult | null {
  if (!input.byPerson) return { ok: false, reason: 'needs_person' }
  const expected = (input.payload as Partial<TerminalInterruptPayload> | null)?.expectedSessionId
  const selected = input.selected
  if (
    !input.live ||
    !selected ||
    selected.id !== expected ||
    selected.taskId !== input.mountedTaskId ||
    !selected.running
  ) {
    return { ok: false, reason: 'changed' }
  }
  return null
}
