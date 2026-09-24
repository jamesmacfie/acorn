import { clientCapabilityId } from '@acorn/plugin-api/client'

// The Agent pane only needs the run and step that own a session. Workflows provides this small
// projection without Agents importing its domain rows or creating a package cycle.
export type WorkflowControl = {
  runForSession(sessionId: string): Promise<{
    run: { id: string; name: string }
    step: { id: string; name: string }
  } | null>
}

export const WORKFLOW_CONTROL = clientCapabilityId<WorkflowControl>('workflows.control')
