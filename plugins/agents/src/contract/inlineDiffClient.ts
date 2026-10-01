import { clientCapabilityId } from '@acorn/plugin-api/client'
import type { Component } from 'solid-js'
import type { AgentSession } from './wire.ts'
import type { InlineDiffOrigin } from './inlineDiff.ts'

export type InlineDiffChatSurface = {
  prime: (taskId: string) => void
  sessionsForTask: (taskId: string) => readonly AgentSession[]
  reportPatches: (scope: Pick<InlineDiffOrigin, 'taskId' | 'source' | 'scope' | 'pull'>, patches: Record<string, string | null>) => void
  isStale: (origin: InlineDiffOrigin) => boolean | null
  Card: Component<{ origin: InlineDiffOrigin; loadContext: () => Promise<string>; onClose?: () => void }>
}

export const AGENTS_INLINE_DIFF = clientCapabilityId<InlineDiffChatSurface>('agents.inlineDiff')
