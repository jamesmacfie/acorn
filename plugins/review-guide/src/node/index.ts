import { inArray } from 'drizzle-orm'
import { registerDeletedTaskPurge, type NodePlugin } from '@acorn/plugin-api/node'
import type { AgentProfiles, AgentSessionExecute } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import { capabilityId } from '@acorn/protocol/plugin/ids.ts'
import { CHANGED_CHANNEL } from '../shared/guide'
import { createGuides } from '../server/guides'
import { createGuideFetch } from '../server/routes'
import { reviewGuides } from './schema'

const SESSION_EXECUTE = capabilityId<AgentSessionExecute>('agents.sessionExecute')
const PROFILES = capabilityId<AgentProfiles>('agents.profiles')

// A loaded package, so it reaches the host only through what its manifest grants
// (docs/first-party-plugins/review-guide.md).
export const reviewGuidePlugin = (): NodePlugin => ({
  name: 'review-guide',
  init: async (ctx) => {
    const db = ctx.storage.open()
    const guides = createGuides({
      db,
      tasks: ctx.core.tasks,
      git: ctx.core.git,
      prefs: ctx.core.prefs,
      changed: (taskId) => ctx.events.send({ channel: CHANGED_CHANNEL, taskId }),
      execute: () => ctx.capabilities.get(SESSION_EXECUTE),
      profiles: () => ctx.capabilities.get(PROFILES),
    })
    await guides.failInterrupted()
    ctx.routes.fetch(createGuideFetch(guides))
    ctx.events.on('head:changed', (frame) => {
      if (typeof frame.taskId === 'string' && typeof frame.head === 'string')
        void guides.markStale(frame.taskId, frame.head)
    })
    registerDeletedTaskPurge(
      ctx,
      async (taskIds) => (await db.delete(reviewGuides).where(inArray(reviewGuides.taskId, [...taskIds]))).changes,
    )
  },
})
