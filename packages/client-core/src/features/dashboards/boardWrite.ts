import { createSignal } from 'solid-js'
import type { DashboardDisplayRow } from '@acorn/dashboards-core/render'
import type { BoardMove, BoardMoveResult } from './boardMoves'

export type BoardMoveIntent = { rowId: string; move: BoardMove; key: string }
type MoveOutcome = 'done' | 'stale' | 'not-writable' | 'invalid-target'

/** One pending or retried intent owns one key. A new gesture always creates a new intent. */
export function createBoardWrite(options: {
  resolve(row: DashboardDisplayRow, choiceId: string): BoardMoveResult
  send(intent: BoardMoveIntent): Promise<MoveOutcome>
  refresh(): Promise<void>
  onOptimistic(value: { rowId: string; move: BoardMove; startedAt: number } | undefined): void
  onMessage(message: string): void
  key(): string
  now(): number
}) {
  const [pending, setPending] = createSignal<BoardMoveIntent>()
  const [retry, setRetry] = createSignal<BoardMoveIntent>()

  const send = async (intent: BoardMoveIntent): Promise<void> => {
    setPending(undefined)
    setRetry(undefined)
    options.onOptimistic({ rowId: intent.rowId, move: intent.move, startedAt: options.now() })
    let result: MoveOutcome
    try { result = await options.send(intent) }
    catch (error) {
      options.onMessage(`${intent.move.sourceLabel}: ${error instanceof Error ? error.message : 'The change failed.'}`)
      setRetry(intent)
      options.onOptimistic(undefined)
      return
    }
    if (result !== 'done') {
      options.onMessage(`${intent.move.sourceLabel}: ${result === 'stale' ? 'This record has moved since the board loaded. Refresh and try again.'
        : result === 'not-writable' ? 'This field is no longer writable.' : 'This source no longer accepts that value.'}`)
      options.onOptimistic(undefined)
      return
    }
    try {
      await options.refresh()
      options.onOptimistic(undefined)
      options.onMessage(`${intent.move.sourceLabel} updated.`)
    } catch { options.onMessage(`${intent.move.sourceLabel} updated, but the board could not refresh. Use Refresh to check its current value.`) }
  }

  const request = (row: DashboardDisplayRow, choiceId: string): void => {
    setRetry(undefined)
    const result = options.resolve(row, choiceId)
    if (!result.move) { options.onMessage(result.reason); return }
    const intent = { rowId: row.id, move: result.move, key: options.key() }
    if (result.move.risk === 'read') void send(intent)
    else setPending(intent)
  }

  return { pending, retry, request, send, cancel: () => setPending(undefined) }
}
