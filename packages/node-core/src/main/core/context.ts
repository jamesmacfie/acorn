// The launch-context seam (CoreServices.context). Two reads that a plugin cannot make for itself once
// it has no handle to core's database:
//
//   - the `prefs` row that turns startup context injection off, and
//   - `agentTools/contextSections.ts`'s assembler, which walks core's contribution registry and reads
//     the github/linear/rollbar mirrors on the way.
//
// One caller: plugins/memory's launchInjector, which pushes "PR + linked issues + notes + repo memory"
// into a fresh agent session as its first prompt (docs/notes-and-memory.md). The POLICY — which
// sections, how they are formatted, whether to send at all — stays in the plugin; only the two reads
// that need core's tables are here.
import type { TaskContext } from '@acorn/protocol/api.ts'
import { assembleContext } from '../../server/agentTools/contextSections'
import type { AppDatabase } from '../../server/db'
import { contextInjectionEnabled } from '../taskWorktree'

export type ContextService = {
  // The owner's `startup_context_injection` pref. Defaults to true — absence means "never changed it".
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
