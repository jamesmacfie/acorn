import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import { changeRequestLineMarkers, type EditorLineMarkerProvider } from '@acorn/plugin-editor/contract/lineMarkers.ts'
import { taskPullComparison } from './mirrorQueries'

type MarkerCore = Pick<CoreServices, 'tasks' | 'projects' | 'identity' | 'git'>

/** Pull request lines in the local working document, with both ends of the pull from GitHub's mirror. */
export const pullRequestEditorLineMarkers = (db: PluginDatabase, core: MarkerCore): EditorLineMarkerProvider =>
  changeRequestLineMarkers(core, async (taskId) => {
    const comparison = await taskPullComparison(db, core, core.identity.active(), taskId)
    if (!comparison?.baseRef || !comparison.headSha) return null
    return {
      key: JSON.stringify([comparison.userId, comparison.repoId, comparison.number]),
      baseRef: comparison.baseRef,
      headSha: comparison.headSha,
    }
  })
