import type { AgentSession } from '../../contract/wire.ts'
import type { ComposerDraftState } from './composerState.ts'

/** Capture once before an await; a reactive composer may show another session on completion. */
export type ComposerOrigin = {
  state: ComposerDraftState
  session: AgentSession
  nodeId: string | null
  visible: () => boolean
}

export const operationError = (caught: unknown, fallback: string) =>
  caught instanceof Error ? caught.message : fallback
