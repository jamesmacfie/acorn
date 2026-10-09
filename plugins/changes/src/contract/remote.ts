/** Public task remote command surface. Changes keeps checkout semantics and before-push hooks. */
export type { PullOptions, PushOptions } from '../shared/api'
export const GIT_PULL_POLICY_PREF = 'git.pullPolicy'
export const changesRemoteRoute = (taskId: string, action: 'fetch' | 'pull' | 'push') =>
  `/v1/p/changes/tasks/${encodeURIComponent(taskId)}/local/${action}`
