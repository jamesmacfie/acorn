import { createSignal } from 'solid-js'
import type { WorkflowInput } from '../../shared/workflowContracts'

export type ScheduleRequest = {
  scheduleId?: string
  workflowId: string
  name: string
  projectId: string
  inputs: WorkflowInput[]
}

const [scheduleRequest, setScheduleRequest] = createSignal<ScheduleRequest | undefined>()

export { scheduleRequest }
export const requestWorkflowSchedule = (request: ScheduleRequest): void => { setScheduleRequest(request) }
export const closeWorkflowSchedule = (): void => { setScheduleRequest(undefined) }
