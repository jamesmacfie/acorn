// What the node says on its way out when nothing caught the error.
//
// Until this existed, an `uncaughtException` printed Node's own stack and the process died, which
// is fine for a developer watching a terminal and invisible to everyone else: a supervised node's
// stderr goes to the helper's log, and nothing correlated the death with what the owner was doing.
//
// **Installing a listener changes what Node does.** With any `uncaughtException` listener
// registered, Node stops printing the stack and stops exiting, so a handler that only records would
// leave the process alive in whatever state the throw left it. This one does what Node would have
// done — prints the stack, then exits 1 — with one flush in between, bounded so a wedged sink
// cannot turn a crash into a hang.
//
// Installed from the two process entries and not from `startServiceRuntime`, which boots three
// times in one process in its own test. Process-level handlers belong to the process.
import { emitError, flushTelemetry } from '@acorn/node-core/server/telemetry/collector.ts'
import { createLogger } from '@acorn/node-core/server/telemetry/logger.ts'

const log = createLogger('crash')

/** How long the flush gets. A crash is not the moment to wait on a network sink, and one second is
 *  long enough for an in-process one to write a file. */
export const FLUSH_DEADLINE_MS = 1_000

export type CrashHandlerOptions = {
  /** Overridden in the test, which cannot call the real one. */
  exit?: (code: number) => void
  flush?: () => void | Promise<void>
  deadlineMs?: number
}

let installed = false

/**
 * Record an uncaught exception or an unhandled rejection as a fatal error, flush, and exit 1.
 *
 * The stack goes on the record here and nowhere else in the node. A log line with a stack in it
 * buries the next fifty lines, but a fatal error with no stack is not worth sending anywhere
 * (docs/telemetry.md § What never leaves the machine).
 */
export function installCrashHandlers(options: CrashHandlerOptions = {}): void {
  if (installed) return
  installed = true
  const exit = options.exit ?? ((code: number) => process.exit(code))
  const deadlineMs = options.deadlineMs ?? FLUSH_DEADLINE_MS
  // The collector hands batches off synchronously; exporters convert and post afterwards.
  // Returning from flushTelemetry is not a delivery acknowledgement. Give those asynchronous
  // sinks the bounded crash window before exiting, even when the collector itself returns at once.
  const flush = options.flush ?? (() => {
    flushTelemetry()
    return new Promise<void>((resolve) => setTimeout(resolve, deadlineMs))
  })

  const die = (kind: 'uncaughtException' | 'unhandledRejection', value: unknown): void => {
    const error = value instanceof Error ? value : new Error(String(value))
    emitError('core', {
      name: error.name || 'Error',
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      level: 'fatal',
      handled: false,
      attrs: { seam: kind },
    })
    // What Node prints when no listener is registered. Through the logger, so the line is also a
    // record, and with the stack because this one is the exception to the no-stacks rule.
    log.error(`${kind}: ${error.stack ?? error.message}`)
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      exit(1)
    }
    setTimeout(finish, deadlineMs).unref?.()
    void Promise.resolve()
      .then(() => flush())
      .then(finish, finish)
  }

  process.on('uncaughtException', (error) => die('uncaughtException', error))
  // Node's own default for an unhandled rejection has been "throw" since v15, so exiting here is
  // the same outcome by a shorter path.
  process.on('unhandledRejection', (reason) => die('unhandledRejection', reason))
}

/** Test seam. The handlers are process-wide and installed once, so a suite that installs them has
 *  to be able to take them back. */
export function resetCrashHandlersForTest(): void {
  installed = false
  process.removeAllListeners('uncaughtException')
  process.removeAllListeners('unhandledRejection')
}
