import { registerDeletedTaskPurge, type NodePlugin } from '@acorn/plugin-api/node'
import { inArray } from 'drizzle-orm'
import { reviewNotes } from '../../node/schema'
import { localGitAgentTools } from './agentTools'
import { CHANGES_HOOKS, localGitBridge } from './localGit'
import { localGit, LOCAL_GIT } from './routes/localGit'
import { reviewNotesRoutes } from './routes/reviewNotes'
import { EDITOR_LINE_MARKERS } from '@acorn/plugin-editor/contract/lineMarkers.ts'
import { EDITOR_FILE_STATUS } from '@acorn/plugin-editor/contract/fileStatus.ts'
import { changesEditorFileStatus } from './editorFileStatus'
import { STATIC_DEPENDENCY_POLICY } from '@acorn/protocol/dependencyPolicy.ts'

type Context = Parameters<NonNullable<NodePlugin['init']>>[0]

/** The Changes tab's node half: the task worktree's status, diff, staging, commits, pull and push,
 *  and review notes. Returns what to dispose when the plugin stops. */
export function registerChanges(ctx: Context): () => void {
  // Opened and migrated by the host before any request can reach it
  // (docs/data-layer/plugin-databases.md § Plugin databases).
  const db = ctx.storage.open()
  ctx.routes.register(reviewNotesRoutes(db, ctx.core, ctx.events.send), { prefix: '/tasks', note: '/:id/review-notes' })
  registerDeletedTaskPurge(
    ctx,
    async (taskIds) => (await db.delete(reviewNotes).where(inArray(reviewNotes.taskId, [...taskIds]))).changes,
  )
  // The two decisions this plugin opens to other plugins, declared before the bridge that runs them
  // (./localGit.ts § CHANGES_HOOKS, docs/plugins/hooks.md § Hooks). Declaring is the whole consent: a
  // point this plugin did not declare has no chain and no trust line.
  for (const point of CHANGES_HOOKS) ctx.hooks.declare({ ...point, allows: [...point.allows] })
  const bridge = localGitBridge(ctx.core, ctx.events.worktreeStatus, ctx.hooks)
  const capability = ctx.capabilities.provide(LOCAL_GIT, bridge)
  const policyCapability = ctx.capabilities.provide(STATIC_DEPENDENCY_POLICY, {
    read: async (root, signal) => (await import('./dependencyReview')).staticDependencyPolicy(root, signal),
  })
  ctx.extensionPoints.handle(EDITOR_LINE_MARKERS, {
    id: 'uncommitted',
    value: {
      kind: 'uncommitted',
      read: async (taskId, path, source) =>
        (await import('./editorLineMarkers')).uncommittedEditorLineMarkers(ctx.core).read(taskId, path, source),
    },
  })
  ctx.extensionPoints.handle(EDITOR_FILE_STATUS, {
    id: 'worktree',
    value: changesEditorFileStatus(ctx.core),
  })
  // Task check: warns about uncommitted work the archive would discard
  // (docs/plugins/task-checks.md § Task checks; details in ./archiveCheck.ts).
  ctx.taskChecks.register({
    id: 'uncommitted',
    check: async (task) => (await import('./archiveCheck')).changesArchiveConcern(bridge, task),
  })
  ctx.routes.register(localGit, { prefix: '/tasks', note: '/:id/local/*' })
  // local_changes, local_diff, and git_log. Same module as the bridge above, so the agent and the
  // Changes tab cannot disagree about the working tree.
  for (const tool of localGitAgentTools(ctx.core)) ctx.tools.register(tool)
  return () => {
    capability.dispose()
    policyCapability.dispose()
  }
}
