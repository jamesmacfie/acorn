import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

// workflows.notices: the per-step event stream behind the run panel (docs/workflows.md).
//
// This used to sit on `ctx.events`, the broadcast surface every plugin receives, which meant one
// plugin's domain vocabulary — a `runId`/`stepId` pair — was part of the context handed to all
// twenty-one. A capability puts it where the rest of this plugin's cross-plugin surface already is:
// owned by workflows, resolved at call time, absent when workflows is disabled.
//
// The bell row left on that argument and has come back to `ctx.events` as `notice`, because the
// objection was to the vocabulary rather than to the surface: a `target` is core's own and is shared
// with the attention inbox, so nothing on the shared context knows what a run is. The memory-proposal
// gate borrowed this capability to reach the bell, which is how it ended up with a row that could only
// point at a workflow run and so pointed nowhere. It calls `ctx.events.notice` now and no longer
// depends on this plugin at all.
export type WorkflowNotices = {
  // One step's progress, for a run panel that is open. Fire-and-forget: a client that is not watching
  // re-reads the run when it opens it.
  stepEvent(runId: string, stepId: string, event: unknown): void
}

export const WORKFLOWS_NOTICES = capabilityId<WorkflowNotices>('workflows.notices')
