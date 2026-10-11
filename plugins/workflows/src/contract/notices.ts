import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

// workflows.notices: the per-step event stream behind the run panel (docs/workflows.md).
//
// A capability rather than a member of `ctx.events`, so a `runId`/`stepId` pair stays this plugin's
// vocabulary instead of part of the context every plugin receives. It is absent when workflows is
// disabled. Bell rows don't belong here: they go through `ctx.events.notice`, whose target is core's.
export type WorkflowNotices = {
  // One step's progress, for a run panel that is open. Fire-and-forget: a client that is not watching
  // re-reads the run when it opens it.
  stepEvent(runId: string, stepId: string, event: unknown): void
}

export const WORKFLOWS_NOTICES = capabilityId<WorkflowNotices>('workflows.notices')
