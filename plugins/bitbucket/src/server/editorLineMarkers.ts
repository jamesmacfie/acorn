import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import { changeRequestLineMarkers, type EditorLineMarkerProvider } from '@acorn/plugin-editor/contract/lineMarkers.ts'
import { mirroredPullRequest } from './mirror/detail'
import { taskPullRequest } from './taskPullRequest'
import type { BitbucketAccount } from './account'

type MarkerCore = Pick<CoreServices, 'tasks' | 'projects' | 'git'>

/** Pull request lines in the local working document, with both ends from Bitbucket's mirror. */
export const pullRequestEditorLineMarkers = (
  db: PluginDatabase,
  core: MarkerCore,
  account: BitbucketAccount,
): EditorLineMarkerProvider =>
  changeRequestLineMarkers(core, async (taskId) => {
    const key = await taskPullRequest(core, account, taskId)
    const row = key && (await mirroredPullRequest(db, key))
    if (!key || !row?.baseRef || !row.headSha) return null
    return {
      key: JSON.stringify([key.connectionId, key.repository, key.number]),
      baseRef: row.baseRef,
      headSha: row.headSha,
    }
  })
