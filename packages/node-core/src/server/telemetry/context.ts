// The node's ambient telemetry context: which trace is open and who is on the stack.
//
// This is the first `AsyncLocalStorage` in the codebase, and it earns that on one argument.
// `core/git.ts` and `storage/sqlite.ts` are reached from every plugin and every route and know
// nothing about their caller, so their histograms all read `owner: core` and answer "the node spent
// four seconds in git" without answering whose four seconds. Threading an owner down to them would
// change hundreds of signatures. Entering one store at the five seams that already know touches
// five (docs/telemetry.md § Ambient attribution).
//
// **It holds three fields and no more.** A request-scoped logger or a per-request deadline could
// ride the same store later; a bag of whatever a caller felt like adding could not be reasoned
// about, and this one runs under every request.
//
// **It imports nothing from the collector.** The collector reads `currentTelemetryContext()` on the
// git and SQL paths, so the dependency runs one way and there is no cycle to reason about. The
// guarded verb a seam calls is `runWithTelemetry` in ./collector.ts, which skips the store entirely
// when nothing is collecting.
import { AsyncLocalStorage } from 'node:async_hooks'

/** What is ambient for the duration of one request, dispatch, schedule run, or hook handler. */
export type TelemetryContext = {
  traceId: string
  /** The span everything raised inside this context hangs under. */
  spanId: string
  /** `core`, or the plugin whose work this is. */
  owner: string
}

const storage = new AsyncLocalStorage<TelemetryContext>()

/** What is on the stack, or `undefined` outside every entered seam. About 8 nanoseconds a call, so
 *  a caller on the SQL path can ask per statement. */
export const currentTelemetryContext = (): TelemetryContext | undefined => storage.getStore()

/**
 * Run `fn` with `context` ambient for it and everything it awaits.
 *
 * The mechanism, with no switch of its own: `runWithTelemetry` in ./collector.ts is the one seams
 * call, and it reads the switch first. Kept separate so this file stays stdlib and types.
 */
export const runWithTelemetryContext = <T>(context: TelemetryContext, fn: () => T): T => storage.run(context, fn)
