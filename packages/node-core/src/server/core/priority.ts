// Kept apart from proc.ts, whose whole module is handed to plugins as `core.proc`. A loaded plugin has no
// reason to renice a process, and this would let it lower any one, the Node's included.
import { setPriority } from 'node:os'
import { createLogger, describeError } from '../telemetry/logger'

const log = createLogger('core:proc')

// Nice values: the window, the helper, and the Node stay at 0. An agent runs a little below them, and work
// nobody is waiting on runs below the agent. A child inherits its parent's value, so an agent's builds
// and tests follow the agent.
const NICE = { agent: 5, background: 10 } as const
let priorityFailureLogged = false

// Lowers a child that has just spawned. Never throws: a container may refuse it, and a child that
// already exited is not worth a log line. Nice lowers CPU share only, not disk or memory priority, which is
// why this is not `taskpolicy -b`.
export function lowerPriority(pid: number | undefined, level: keyof typeof NICE): void {
  if (!pid) return
  try {
    setPriority(pid, NICE[level])
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH' || priorityFailureLogged) return
    priorityFailureLogged = true
    log.warn(`could not lower a child's priority; children keep the Node's: ${describeError(error).message}`)
  }
}
