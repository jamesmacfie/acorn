import { createSignal } from 'solid-js'
import type { WorkflowInput } from '../../shared/workflowContracts'

export type TriggerRequest = {
  triggerId?: string
  workflowId: string
  name: string
  projectId: string
  inputs: WorkflowInput[]
}

const [triggerRequest, setTriggerRequest] = createSignal<TriggerRequest | undefined>()

export { triggerRequest }
export const requestWorkflowTrigger = (request: TriggerRequest): void => {
  setTriggerRequest(request)
}
export const closeWorkflowTrigger = (): void => {
  setTriggerRequest(undefined)
}
