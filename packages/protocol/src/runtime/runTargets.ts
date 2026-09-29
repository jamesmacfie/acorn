// Core run-target wire contracts.
// Run targets as the renderer sees them (docs/workflows.md): the merged config list plus live
// status. The terminal plugin's run-target contract and the client query layer share these shapes.
export type RunTargetInfo = {
  id: string
  command: string
  stop?: string
  restart?: string
  url?: string
  urlCommand?: string
  icon?: string
  default?: boolean
  running: boolean
}
export type RunStatus = { running: boolean; url?: string; exitCode?: number | null }
