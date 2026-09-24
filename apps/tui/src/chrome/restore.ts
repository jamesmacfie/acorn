// Reopening where you left off.
//
// This host restores one thing, which workspace was open, and lets the per-workspace view memory
// supply the rest. That memory is node-owned and keyed by workspace (client-core
// features/tasks/tasks.ts), so "the workspace I was in" plus "what I was looking at in it" is the
// whole answer. The desktop reopens from the same two values (apps/desktop/src/client/App.tsx).
//
// Two slices and not the registry's, deliberately. Client plugins register their own slices for the
// desktop's pass — open editor files, PR filters, pane layouts — and turning those on in a terminal is
// a separate decision with its own surface to check, not a side effect of remembering a workspace.

import { createEffect } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import type { PersistedStateSlice } from '@acorn/client-core/infra/persistence/persistedState.ts'
import { lastWorkspaceSlice, workspaceViewSlice } from '@acorn/client-core/infra/persistence/stateSlices.ts'
import { createStartupRestore } from '@acorn/client-core/infra/persistence/startupRestore.ts'
import { chosenWorkspace, setPlaceRestored } from './state'
import type { ShellModel } from './model'

/**
 * The workspace the shell settled on, which is not the same as the one that was chosen by hand: the
 * shell follows the open task and falls back to the first workspace, and reopening on the one that
 * was actually on screen is the point.
 *
 * Restored by replaying a workspace switch rather than by setting the choice, so the view memory is
 * applied by the one function that knows how to apply it. The slice restores in the `view` phase,
 * after `core.workspace-views`, and a switch reads that memory.
 *
 * A workspace that has since gone away needs no check here. `chooseWorkspace` finds nothing to
 * restore and the model resolves an unknown id to the first workspace, which is what an empty
 * preference does too.
 */
const restoreLastWorkspace = (model: ShellModel) => (saved: string): void => {
  if (!saved || chosenWorkspace()) return
  model.chooseWorkspace(saved)
}

/**
 * Wire the shell to its persisted place. Called once, from `Shell.tsx`, inside its reactive root.
 *
 * It waits for the workspace roster and the task list, because a restore reads both: an id with no
 * roster to resolve it is overwritten by the model's fallback a tick later, and a remembered task
 * with no list to find it in silently degrades to the workspace's default source.
 */
export function installRestore(
  model: ShellModel,
  prefs: () => Readonly<Record<string, string>> | undefined,
): void {
  const queryClient = useQueryClient()
  const slices = [workspaceViewSlice, lastWorkspaceSlice(restoreLastWorkspace(model))] as readonly PersistedStateSlice<unknown>[]
  const pass = createStartupRestore({
    queryClient,
    prefs,
    ready: model.ready,
    slices: () => slices,
  })
  createEffect(() => {
    if (pass.restored()) setPlaceRestored(true)
  })
}
