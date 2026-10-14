import type {
  BridgeAgentSession,
  BridgeWorkflow,
  BridgeWorkflowRun,
  BridgeWorkflowStep,
} from '@acorn/protocol/extensionBridge.ts'
import type { AgentSession } from '@acorn/plugin-agents/contract/wire.ts'
import type { WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '@acorn/plugin-workflows/contract/wire.ts'

// The workflows plugin's route bodies, narrowed to what the sidebar draws. Types only: the CLI bundle
// takes no code from that plugin. docs/browser-extension/workflows.md.

const workflowsRoute = '/v1/p/workflows'
export const workflowDefsRoute = (workspaceId: string) =>
  `${workflowsRoute}/defs?workspaceId=${encodeURIComponent(workspaceId)}`
export const taskWorkflowsRoute = (taskId: string) => `${workflowsRoute}/tasks/${encodeURIComponent(taskId)}/workflows`
export const runStepsRoute = (runId: string) => `${workflowsRoute}/workflows/runs/${encodeURIComponent(runId)}/steps`

// What a task in this project can run, by the desktop's own rule for its Start workflow box: no known
// problems, and a definition typed in the app only once it is published. A definition another
// project's checkout holds runs only there.
export const runnableWorkflows = (definitions: readonly WorkflowDefSummary[], projectId: string): BridgeWorkflow[] =>
  definitions
    .filter(
      (definition) =>
        !definition.problems?.length &&
        (definition.source !== 'database' || !!definition.publishedRevision) &&
        (!definition.projectId || definition.projectId === projectId),
    )
    .map((definition) => ({
      id: definition.id,
      name: definition.name,
      inputs: (definition.inputs ?? []).map(({ name, label, description, required, default: value, schema }) => ({
        name,
        label,
        description,
        required,
        default: value,
        schema,
      })),
    }))

// Newest first, as the desktop's run list reads.
export const bridgeRuns = (runs: readonly WorkflowRunRow[]): BridgeWorkflowRun[] =>
  runs
    .map(({ id, name, status, createdAt, updatedAt }) => ({ id, name, status, createdAt, updatedAt }))
    .sort((a, b) => b.createdAt - a.createdAt)

// The task a step ran in: its own, when the runner gave it a task and checkout, or the run's.
export const stepTaskId = (step: WorkflowStepRow): string | null => {
  try {
    const childTaskId = (JSON.parse(step.inputsJson ?? 'null') as { childTaskId?: unknown } | null)?.childTaskId
    return typeof childTaskId === 'string' ? childTaskId : null
  } catch {
    return null
  }
}

// A step's conversation is the session its row names. A running step's row names none yet, but the
// agents plugin writes the step on the session it starts, so that finds it sooner.
export const bridgeSteps = (
  steps: readonly WorkflowStepRow[],
  sessions: readonly AgentSession[],
  bridgeSession: (session: AgentSession) => BridgeAgentSession,
): BridgeWorkflowStep[] =>
  steps.map((step) => {
    const session = sessions.find(
      (candidate) => candidate.id === step.agentSessionId || candidate.config?.workflowStepId === step.id,
    )
    return {
      id: step.id,
      name: step.name,
      status: step.status,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
      session: session ? bridgeSession(session) : null,
    }
  })
