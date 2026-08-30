import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

// workflows.notices: the client's notification bell, and the per-step event stream behind the run
// panel (docs/workflows.md).
//
// These two used to sit on `ctx.events`, the broadcast surface every plugin receives, which meant one
// plugin's domain vocabulary — a `'gate' | 'run-done'` notice kind, a `runId`/`stepId` pair — was part
// of the context handed to all twenty-one. A capability puts them where the rest of this plugin's
// cross-plugin surface already is: owned by workflows, resolved at call time, absent when workflows is
// disabled.
//
// The one other consumer is the memory-proposal gate (plugins/memory), which raises a `'gate'` notice
// of its own when proposals are waiting for review.
export type WorkflowNotices = {
  // A bell row against a task. `kind` decides the copy and the row's action on the client side.
  notice(taskId: string, kind: 'gate' | 'run-done', title: string): void
  // One step's progress, for a run panel that is open. Fire-and-forget: a client that is not watching
  // re-reads the run when it opens it.
  stepEvent(runId: string, stepId: string, event: unknown): void
}

export const WORKFLOWS_NOTICES = capabilityId<WorkflowNotices>('workflows.notices')
