export type WorkflowCompletedEvent = {
  taskId: string
  runId: string
  status: string
  completedAt: number
}
