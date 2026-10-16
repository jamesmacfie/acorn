import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import { changeRequestLineMarkers, type EditorLineMarkerProvider } from '@acorn/plugin-editor/contract/lineMarkers.ts'
import { mirroredMergeRequest } from './mirror/detail'
import { taskMergeRequest } from './taskMergeRequest'
import type { GitlabServers } from './servers'

type MarkerCore = Pick<CoreServices, 'tasks' | 'projects' | 'git'>

/** Merge request lines in the local working document, with both ends from GitLab's mirror. */
export const mergeRequestEditorLineMarkers = (
  db: PluginDatabase,
  core: MarkerCore,
  servers: GitlabServers,
): EditorLineMarkerProvider =>
  changeRequestLineMarkers(core, async (taskId) => {
    const key = await taskMergeRequest(db, core, servers, taskId)
    const row = key && (await mirroredMergeRequest(db, key))
    if (!key || !row?.baseRef || !row.headSha) return null
    return {
      key: JSON.stringify([key.connectionId, key.projectId, key.iid]),
      baseRef: row.baseRef,
      headSha: row.headSha,
    }
  })
