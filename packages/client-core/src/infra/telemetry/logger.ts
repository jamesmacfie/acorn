// The client's logger, and the only file under `packages/client-core/src`, `apps/desktop/src/client`
// and `apps/desktop/src/shell` allowed to call `console.*` (tools/arch/boundaries.test.ts § the
// console rule).
//
// The same shape as the node's (`node-core/server/telemetry/logger.ts`) and for the same reason: a
// line written through here carries the tag that wrote it and reaches every sink, and a bare
// `console.warn` carries only the prefix somebody typed. What differs is where it goes. The node
// writes to stderr because stdout is a wire; the renderer writes to the devtools console, which is
// the thing a developer already has open, and it keeps `console.warn` and `console.error` for the
// two levels the console filters on.
//
// A second argument is allowed and is not an attribute. Half the renderer's log sites pass a caught
// error as a second argument to get the console's expandable object, and the record takes the
// error's name and message instead, because a record cannot carry an object
// (docs/telemetry.md § The attribute vocabulary).
import type { TelemetryAttrs } from '@acorn/protocol/telemetry.ts'
import { emitLog } from './emitter'

export type Logger = {
  debug(message: string, detail?: unknown, attrs?: TelemetryAttrs): void
  info(message: string, detail?: unknown, attrs?: TelemetryAttrs): void
  warn(message: string, detail?: unknown, attrs?: TelemetryAttrs): void
  error(message: string, detail?: unknown, attrs?: TelemetryAttrs): void
}

/** An unknown thrown value as a name and a one-line message. No stack: a stack in a log line buries
 *  the next fifty, and the two places worth sending one are the window handlers, which build their
 *  error record directly. */
export function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name || 'Error', message: error.message || error.name || 'Error' }
  if (typeof error === 'string') return { name: 'Error', message: error }
  return { name: 'Error', message: 'unknown error' }
}

/** What a second argument adds to the record. An error becomes two attributes; a scalar becomes one;
 *  anything else is dropped, because an object is where a request body hides. */
const detailAttrs = (detail: unknown): TelemetryAttrs => {
  if (detail === undefined) return {}
  if (detail instanceof Error) {
    const described = describeError(detail)
    return { 'error.name': described.name, 'error.message': described.message }
  }
  if (typeof detail === 'string' || typeof detail === 'number' || typeof detail === 'boolean') return { detail }
  return {}
}

/**
 * A logger bound to one tag. `createLogger('fleet').warn('could not delete the persisted cache')`
 * prints `[fleet] could not delete the persisted cache`, which is what the hand-written prefix
 * printed before.
 *
 * `owner` defaults to `core`. A compiled plugin's client half passes its own id, which is what makes
 * the line answer "whose is this" without anyone reading the call site.
 */
export function createLogger(tag: string, owner = 'core'): Logger {
  const write = (level: 'debug' | 'info' | 'warn' | 'error', message: string, detail?: unknown, attrs?: TelemetryAttrs): void => {
    const line = `[${tag}] ${message}`
    // The console's own two channels, so a devtools filter on warnings and errors keeps working.
    // `debug` and `info` share `log`, which is where every renderer line went before. The detail is
    // only passed when there is one, so a line with nothing to expand stays one line.
    const args: unknown[] = detail === undefined ? [line] : [line, detail]
    if (level === 'error') console.error(...args)
    else if (level === 'warn') console.warn(...args)
    else console.log(...args)
    emitLog(owner, { at: Date.now(), level, logger: tag, body: message, attrs: { ...detailAttrs(detail), ...attrs } })
  }
  return {
    debug: (message, detail, attrs) => write('debug', message, detail, attrs),
    info: (message, detail, attrs) => write('info', message, detail, attrs),
    warn: (message, detail, attrs) => write('warn', message, detail, attrs),
    error: (message, detail, attrs) => write('error', message, detail, attrs),
  }
}
