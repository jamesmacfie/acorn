import type { Task } from '@acorn/protocol/api.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { WorkflowGitLaunchRequest } from '../contract/gitLaunch.ts'

type Session = { task: Task | null; values: Record<string, DataValue>; defId: string }
const sessions = new Map<string, Session>()
const key = (request: WorkflowGitLaunchRequest) => JSON.stringify([request.nodeId, request.projectId, request.commitId])

export function gitLaunchSession(request: WorkflowGitLaunchRequest): Session {
  const id = key(request)
  let session = sessions.get(id)
  if (!session) { session = { task: null, values: {}, defId: '' }; sessions.set(id, session) }
  return session
}

export function forgetGitLaunchSession(request: WorkflowGitLaunchRequest): void {
  sessions.delete(key(request))
}
