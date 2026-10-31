import { clientCapabilityId } from '@acorn/plugin-api/client'
import type { Component, JSX } from 'solid-js'
import type { PinnedNote } from '@acorn/plugin-api/ui/diff'
import type { AgentSession } from './wire.ts'
import type { InlineDiffOrigin } from './inlineDiff.ts'

export type InlineDiffChatSurface = {
  prime: (taskId: string) => void
  sessionsForTask: (taskId: string) => readonly AgentSession[]
  reportPatches: (
    scope: Pick<InlineDiffOrigin, 'taskId' | 'source' | 'scope' | 'pull'>,
    patches: Record<string, string | null>,
  ) => void
  isStale: (origin: InlineDiffOrigin) => boolean | null
  /** `notes` are the line's notes, its opening messages. A conversation started with them keeps them. */
  Card: Component<{
    origin: InlineDiffOrigin
    loadContext: () => Promise<string>
    onClose?: () => void
    notes?: readonly PinnedNote<JSX.Element>[]
  }>
}

export const AGENTS_INLINE_DIFF = clientCapabilityId<InlineDiffChatSurface>('agents.inlineDiff')
