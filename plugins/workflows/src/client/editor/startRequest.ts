// What "run this workflow" is, before anything draws it.
//
// A module of its own rather than a signal inside ./StartDialog.tsx, because the palette asks for the
// dialog and a palette command is a `.ts` file with a node-environment test: one Solid component on
// the path makes that module unloadable there (docs/plugin-authoring.md § Testing).
import { createSignal } from 'solid-js'
import { toast } from '@acorn/plugin-api/client'
import type { WorkflowInput } from '@acorn/protocol/workflow.ts'
import { workflowApi } from '../workflowsClient'

export type StartRequest = {
  /** What to start: a row id, or `repo:<fileId>` / `user:<fileId>` for a committed file. */
  defId: string
  name: string
  inputs?: readonly WorkflowInput[]
  /** Values the caller already knows — the item a run was started from, in phase 5. */
  prefill?: Readonly<Record<string, string>>
  /** The task to run on. Absent means the dialog asks. */
  taskId?: string
  projectId?: string
  onStarted?: (runId: string) => void
}

const [request, setRequest] = createSignal<StartRequest | null>(null)

/** What the dialog draws, or nothing. */
export const startRequest = request

export const closeWorkflowStart = (): void => {
  setRequest(null)
}

/**
 * Whether a request has to stop and ask: something is missing, or there is nowhere to run it.
 *
 * Exported because the palette's "Run a workflow" row needs the same answer before it starts, and it
 * cannot call `requestWorkflowStart` for the other half: a command's refusal belongs in the palette
 * frame rather than in a toast, so that row throws (../commands.ts). One rule, two readers.
 */
export const needsStartDialog = (next: Pick<StartRequest, 'inputs' | 'prefill' | 'taskId'>): boolean =>
  !next.taskId
  || (next.inputs ?? []).some((input) => input.required && !input.default && !next.prefill?.[input.name])

/**
 * Ask for the dialog.
 *
 * A definition that needs nothing and already has a task starts instead of opening a box with one
 * button in it, which is what keeps "Run a workflow" one keystroke for the common case.
 */
export async function requestWorkflowStart(next: StartRequest): Promise<void> {
  const taskId = next.taskId
  // `taskId` is tested twice on purpose. `needsStartDialog` owns the rule; the second half is how the
  // compiler learns that a request past this point has a task to run on.
  if (needsStartDialog(next) || !taskId) {
    setRequest(next)
    return
  }
  const values = { ...(next.prefill ?? {}) }
  const answer = await workflowApi.start(taskId, { defId: next.defId }, Object.keys(values).length ? values : undefined)
  if (answer.error) toast(answer.error, { tone: 'danger' })
  else if (answer.runId) next.onStarted?.(answer.runId)
}
