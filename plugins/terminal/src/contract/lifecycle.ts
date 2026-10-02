export type TerminalCompletedEvent = {
  taskId: string
  sessionId: string
  exitCode: number | null
  completedAt: number
}
