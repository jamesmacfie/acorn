// What a running session hears when memory changes after it started (docs/managed-agents/sessions.md
// § Standing memory). The system prompt keeps the snapshot the session started with, so the prompt cache
// survives. Each turn instead compares the current index with the last one the session was told, and a
// difference rides ahead of the turn as one context part.
import { createLogger, describeError } from '@acorn/plugin-api/node'
import type { AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import type { AgentNormalizedEvent } from '../../contract/wire.ts'
import type { AgentStore } from './store'

const log = createLogger('agents', 'agents')

type MemoryChanges = {
  part: AgentContextSnapshot
  /** The index to save as `standingContextTold` once the turn has run. */
  told: string
  /** The transcript's one line about the change. */
  line: string
}

const HEADER = 'The memory index changed since your last turn. Read a memory with memory_get when it matters.'

// Only the entries count. The contract text and headings don't move, and a truncation marker's count
// changes with every write past the cap.
const entries = (index: string): string[] => index.split('\n').filter((line) => line.startsWith('- '))

/**
 * The part for the next turn, or null when no entry was added or removed. `lastTold` is the session's
 * `standingContextTold`, or its `standingContext` before the first change. A session with neither, or
 * with live updates off (`current` is null), hears nothing.
 */
function memoryChanges(lastTold: unknown, current: string | null): MemoryChanges | null {
  if (current === null || typeof lastTold !== 'string') return null
  const before = new Set(entries(lastTold))
  const now = new Set(entries(current))
  const added = [...now].filter((line) => !before.has(line))
  const removed = [...before].filter((line) => !now.has(line))
  if (!added.length && !removed.length) return null
  // An edited description is one of each. The old line stays so the agent knows what it replaced. An
  // entry pushed past the cap also leaves the index, which is why this doesn't say "deleted".
  const content = [
    HEADER,
    ...(added.length ? ['Added or updated:', ...added] : []),
    ...(removed.length ? ['No longer in the index:', ...removed] : []),
  ].join('\n')
  return {
    part: {
      type: 'context',
      contextId: 'memory',
      source: 'context.memory',
      label: 'Memory changes',
      content,
      capturedAt: Date.now(),
    },
    told: current,
    line: `Memory changed since the last turn: ${added.length} added, ${removed.length} removed.`,
  }
}

/**
 * This turn's note, or null, which is also the answer without a reader. `deliver` runs once the turn has run: it saves the index as
 * `standingContextTold` and writes the transcript line. A failed turn never calls it, so the next turn
 * offers the same change. Neither half throws, because the note must never fail a turn.
 */
export async function memoryNote(
  sessionId: string,
  store: Pick<AgentStore, 'requireSession' | 'patchSession'>,
  current: ((taskId: string) => Promise<string | null>) | undefined,
  record: (event: AgentNormalizedEvent) => Promise<unknown>,
): Promise<{ part: AgentContextSnapshot; deliver(): Promise<void> } | null> {
  if (!current) return null
  try {
    const session = await store.requireSession(sessionId)
    const changes = memoryChanges(
      session.config.standingContextTold ?? session.config.standingContext,
      await current(session.taskId),
    )
    if (!changes) return null
    return {
      part: changes.part,
      deliver: async () => {
        try {
          const latest = await store.requireSession(sessionId)
          await store.patchSession(sessionId, { config: { ...latest.config, standingContextTold: changes.told } })
          await record({ type: 'diagnostic', level: 'info', message: changes.line })
        } catch (error) {
          log.warn(`memory change record failed: ${describeError(error).message}`)
        }
      },
    }
  } catch (error) {
    log.warn(`memory index read failed: ${describeError(error).message}`)
    return null
  }
}
