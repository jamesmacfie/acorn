// The small vocabulary a step kind emits through `StepHandlerContext.emit`, so the run pane can draw
// progress without knowing which plugin contributed the kind (docs/workflows.md § Contributed step
// kinds).
//
// `emit` stays typed as an open record: a kind may send anything, and the pane shows what it does not
// recognise as JSON under a disclosure. This union is the part the pane draws properly, and it is
// here rather than in a plugin so both the emitter and the reader name one type.

/** An agent kind's own stream, forwarded from the managed session. */
export type ManagedAgentStepEvent = { type: 'managed-agent'; sequence?: number; event: unknown }

/** A captured command's output, chunk by chunk. The client keeps a tail, not the whole stream. */
export type OutputStepEvent = { type: 'stdout' | 'stderr'; text: string }

/** One line of "what it is doing now", from any kind. */
export type ProgressStepEvent = { type: 'progress'; text: string }

/** How many rows a data kind has read so far. */
export type RowsStepEvent = { type: 'rows'; count: number }

export type WorkflowStepEventBody =
  | ManagedAgentStepEvent
  | OutputStepEvent
  | ProgressStepEvent
  | RowsStepEvent

export const WORKFLOW_STEP_EVENT_TYPES = ['managed-agent', 'stdout', 'stderr', 'progress', 'rows'] as const

/** True when the event is one this vocabulary describes. Anything else is kept and shown as JSON. */
export function isWorkflowStepEvent(event: unknown): event is WorkflowStepEventBody {
  const type = (event as { type?: unknown } | null)?.type
  return typeof type === 'string' && (WORKFLOW_STEP_EVENT_TYPES as readonly string[]).includes(type)
}
