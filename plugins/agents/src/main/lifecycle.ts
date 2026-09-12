import { asc, eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'
import * as schema from '../node/schema'
import type {
  AgentLifecyclePublisher,
  AgentSessionChange,
  AgentSessionRosterEntry,
  SessionRenameSource,
} from '../contract/lifecycle'
import { mapAgentSession } from './rowMapping'

/** The post-commit projection from session rows to the public lifecycle contract. */
export class AgentLifecycle {
  constructor(
    private readonly db: PluginDatabase,
    private readonly publish?: AgentLifecyclePublisher,
  ) {}

  announceSession(
    session: AgentSession,
    changes: AgentSessionChange[],
    renameSource?: SessionRenameSource,
  ): void {
    if (!changes.length) return
    this.publish?.({
      channel: 'plugin:agents:sessions-changed',
      taskId: session.taskId,
      sessionId: session.id,
      present: !changes.includes('deleted'),
      archived: session.archivedAt != null,
      changes,
      ...(changes.includes('renamed') && renameSource ? { renameSource } : {}),
    })
  }

  async sessions(taskId: string): Promise<AgentSessionRosterEntry[]> {
    const rows = await this.db
      .select()
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.taskId, taskId))
      .orderBy(asc(schema.agentSessions.createdAt))
    return rows.map((row) => {
      const session = mapAgentSession(row)
      return {
        taskId,
        sessionId: session.id,
        present: true,
        archived: session.archivedAt != null,
        providerId: session.providerId,
        profileId: session.profileId,
        kind: session.kind,
        title: session.title,
        runtimeState: session.runtimeState,
        attention: session.attention,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }
    })
  }
}
