// The launch-context seam (CoreServices.context). Two reads a plugin cannot make once it holds no
// handle to core's database:
//
//   - the `prefs` row that turns startup context injection off, and
//   - the assembler in `agentTools/contextSections.ts`, which walks core's contribution registry and
//     reads the github, linear, and rollbar mirrors on the way.
//
// One caller: plugins/memory's launchInjector (docs/notes-and-memory.md). Which sections to send,
// how to format them, and whether to send at all stays a policy decision in the plugin.
import type { TaskContext } from '@acorn/protocol/api.ts'
import { assembleContext } from '../../../server/agentTools/contextSections'
import type { AppDatabase } from '../../../server/db'
import { contextInjectionEnabled } from '../../taskWorktree'

export type ContextService = {
  // The owner's `startup_context_injection` pref. Absent means true: the owner never changed it.
  injectionEnabled(userId: string): Promise<boolean>
  // The assembled sections for a task, or null when the task id does not resolve. `include` is the
  // caller's choice of contribution ids.
  assemble(userLogin: string, taskId: string, include: Set<string>): Promise<TaskContext | null>
}

export function createContextService(db: AppDatabase): ContextService {
  return {
    injectionEnabled: (userId) => contextInjectionEnabled(db, userId),
    assemble: (userLogin, taskId, include) => assembleContext(db, userLogin, taskId, include),
  }
}
