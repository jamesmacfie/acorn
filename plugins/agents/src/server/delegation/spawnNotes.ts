import { randomUUID } from 'node:crypto'
import { describeError } from '@acorn/plugin-api/node'
import type { SpawnNotesCapture } from '@acorn/plugin-notes/contract/spawnSnapshot.ts'
import { DELEGATED_NOTES_SOURCE, type AgentInputPart } from '../../contract/wire.ts'
import type { AgentStore } from '../sessions/store'

type TurnBody = { input: AgentInputPart[]; effectivePolicy: Record<string, unknown> }

/**
 * Adds the notes a delegated child starts with to its first turn
 * (docs/managed-agents/delegation.md § Notes in delegated agents). The notes go into the turn itself,
 * so a retry, recovery, or resume replays the same snapshot.
 *
 * Without the Notes plugin, the turn goes out unchanged. A capture that fails throws, so the spawn
 * fails instead of starting without the guidance the person expects it to have.
 */
export async function withSpawnNotes(
  capture: SpawnNotesCapture | undefined,
  store: Pick<AgentStore, 'firstTurn'>,
  sources: { taskId: string; parentTaskId: string; parentSessionId: string | null },
  turn: TurnBody,
): Promise<TurnBody> {
  if (!capture) return turn
  // A delegating session that was itself delegated passes on what it was given.
  const inherited = sources.parentSessionId
    ? (await store.firstTurn(sources.parentSessionId))?.effectivePolicy.spawnNotes
    : undefined
  let snapshot: Awaited<ReturnType<SpawnNotesCapture>>
  try {
    snapshot = await capture({ taskId: sources.taskId, parentTaskId: sources.parentTaskId, inherited })
  } catch (error) {
    throw new Error(
      `Acorn could not read the notes this agent should start with, so it did not start. ${describeError(error).message} Try agent_spawn again.`,
    )
  }
  if (!snapshot.content) return turn
  const byteSize = Buffer.byteLength(snapshot.content, 'utf8')
  return {
    input: [
      ...turn.input,
      {
        type: 'context',
        contextId: randomUUID(),
        label: 'Notes · attached',
        content: snapshot.content,
        source: DELEGATED_NOTES_SOURCE,
        provenance: 'Included notes captured when this delegated session started',
        deepLink: { pane: 'notes' },
        byteSize,
        estimatedTokens: Math.ceil(byteSize / 4),
        freshness: 'cached',
        sensitivity: 'workspace',
        capturedAt: snapshot.capturedAt,
      },
    ],
    effectivePolicy: { ...turn.effectivePolicy, spawnNotes: snapshot.notes },
  }
}
