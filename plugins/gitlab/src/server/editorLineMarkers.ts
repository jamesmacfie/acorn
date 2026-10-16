import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import { changeRequestLineMarkers, type EditorLineMarkerProvider } from '@acorn/plugin-editor/contract/lineMarkers.ts'
import { mirroredMergeRequest } from './mirror/detail'
import { taskMergeRequest } from './taskMergeRequest'

type MarkerCore = Pick<CoreServices, 'tasks' | 'projects' | 'identity' | 'git'>

/** Merge request lines in the local working document, with both ends from GitLab's mirror. */
export const mergeRequestEditorLineMarkers = (db: PluginDatabase, core: MarkerCore): EditorLineMarkerProvider =>
  changeRequestLineMarkers(core, async (taskId) => {
    const key = await taskMergeRequest(db, core, core.identity.active(), taskId)
    const row = key && (await mirroredMergeRequest(db, key))
    if (!key || !row?.baseRef || !row.headSha) return null
    return { key: JSON.stringify([key.userId, key.projectId, key.iid]), baseRef: row.baseRef, headSha: row.headSha }
  })
