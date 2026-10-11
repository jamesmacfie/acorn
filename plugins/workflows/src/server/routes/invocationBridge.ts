// The capability the agent invocation routes call (./invocation.ts). Its own module, so the plugin can
// provide it at init while the routes load on first use.
import { routeCapability } from '@acorn/plugin-api/node'
import type {
  WorkflowInvocationApproval,
  WorkflowInvocationPolicy,
  WorkflowInvocationReview,
} from '../../shared/workflowInvocation'

export type WorkflowInvocationBridge = {
  review(projectId: string, definitionKey: string): Promise<WorkflowInvocationReview>
  approve(approval: WorkflowInvocationApproval): Promise<WorkflowInvocationPolicy>
  revoke(projectId: string, definitionKey: string): Promise<WorkflowInvocationPolicy | null>
}

export const WORKFLOW_INVOCATION_ROUTE = routeCapability<WorkflowInvocationBridge>('workflows.invocation')
