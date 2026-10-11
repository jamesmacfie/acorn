import type { Task } from '@acorn/protocol/api.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { WorkflowGitLaunchRequest } from '../contract/gitLaunch.ts'
import { createSignal, type Accessor } from 'solid-js'

type Session = {
  task: Accessor<Task | null>
  setTask: (task: Task) => void
  runId: Accessor<string | null>
  setRunId: (runId: string) => void
  pending: Accessor<boolean>
  setPending: (pending: boolean) => void
  invocation: Accessor<{ selectionId: string; definitionId: string; inputs: Record<string, DataValue> } | null>
  setInvocation: (value: { selectionId: string; definitionId: string; inputs: Record<string, DataValue> }) => void
  targetIdentity: string | null
  values: Record<string, DataValue>
  defId: string
  launchId: string
}
const sessions = new Map<string, Session>()
const key = (request: WorkflowGitLaunchRequest) => JSON.stringify([request.nodeId, request.projectId, request.commitId])

export function gitLaunchSession(request: WorkflowGitLaunchRequest): Session {
  const id = key(request)
  let session = sessions.get(id)
  if (!session) {
    const [task, setTask] = createSignal<Task | null>(null)
    const [runId, setRunId] = createSignal<string | null>(null)
    const [pending, setPending] = createSignal(false)
    const [invocation, setInvocation] = createSignal<ReturnType<Session['invocation']>>(null)
    session = {
      task,
      setTask,
      runId,
      setRunId,
      pending,
      setPending,
      invocation,
      setInvocation,
      targetIdentity: null,
      values: {},
      defId: '',
      launchId: crypto.randomUUID(),
    }
    sessions.set(id, session)
  }
  return session
}

export function forgetGitLaunchSession(request: WorkflowGitLaunchRequest, expected?: Session): void {
  const id = key(request)
  if (!expected || sessions.get(id) === expected) sessions.delete(id)
}

export function forgetUnusedGitLaunchSession(request: WorkflowGitLaunchRequest, expected: Session): void {
  if (!expected.task() && !expected.runId() && !expected.pending()) forgetGitLaunchSession(request, expected)
}
