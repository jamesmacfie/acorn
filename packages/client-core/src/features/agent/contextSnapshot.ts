import type { AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'

export function contextSnapshot(input: Omit<
  AgentContextSnapshot,
  'type' | 'byteSize' | 'estimatedTokens' | 'capturedAt'
> & { capturedAt?: number }): AgentContextSnapshot {
  const bytes = new TextEncoder().encode(input.content).byteLength
  return {
    ...input,
    type: 'context',
    byteSize: bytes,
    estimatedTokens: Math.ceil(bytes / 4),
    capturedAt: input.capturedAt ?? Date.now(),
  }
}
