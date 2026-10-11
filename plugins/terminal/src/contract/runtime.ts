import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

// terminal.runtime: the post-listener reconcile pass, the same shape as `agents.runtime`.
//
// reconcile() re-attaches tmux sessions that are still alive and drops rows whose tmux is gone. The
// composition root runs it beside the worktree, workflow, and agent passes, off the paint-critical
// path, so the order of those passes stays in one place.
export const TERMINAL_RUNTIME = capabilityId<{ reconcile(): Promise<void> }>('terminal.runtime')
