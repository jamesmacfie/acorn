// A turn in a decision before it happens (docs/plugins.md § Hooks).
//
// Everything else in the extension-point family is about drawing. This one is about deciding. The owner
// declares the moment and what is allowed at it, contributors register a handler, and this module runs
// the chain and hands the owner a verdict.
//
// A hook is not an event (docs/future/events.md). An event has already happened, fans out, and carries
// no answer; a hook runs before, in order, with a return value, a timeout and a validated payload. The
// two contracts stay different on purpose: a producer that declares no `emits` has said no to
// listeners, and an owner that declares no hook has said no to interceptors.
//
// Two carriers, one chain, the same rule the route registry follows: a built-in contributes a function
// and a loaded plugin contributes a route, the host wraps both in the same `call` closure at
// registration, and nothing below this line knows which it has. That is also why there is no `Env` in
// this file — the closure that needs one was built where one was in scope (./host.ts).
import {
  isHookMode,
  matchesHookPayload,
  type HookMode,
  type HookPayload,
  type HookPayloadShape,
  type HookVerdict,
} from '@acorn/protocol/extensionPoints.ts'
import type { Disposable } from './capabilities'
import { emitSpan, newSpanId, newTraceId, runWithTelemetry, telemetryEnabled } from '../telemetry/collector'
import { createLogger, describeError } from '../telemetry/logger'

const log = createLogger('hooks')

/** How much of a handler's own text reaches the owner's UI. Display-only, capped by the node, the same
 *  treatment a task check's message gets on its way to the archive dialog. */
const REASON_MAX = 200

export type HookPointRegistration = {
  /** `<ownerId>:<pointId>`, minted by the host. Core's own points are the `core:` ones. */
  id: string
  ownerId: string
  payload: HookPayloadShape
  allows: readonly HookMode[]
  timeoutMs: number
  onTimeout: 'allow' | 'deny'
  order: 'priority' | 'install'
  collect: boolean
}

export type HookHandlerRegistration = {
  /** `<pluginId>:<extensionId>`, minted by the host. */
  id: string
  pluginId: string
  point: string
  mode: HookMode
  priority: number
  /**
   * The handler, already bound to its carrier. Answers whatever the mode asks for; anything else is
   * treated as no answer and recorded.
   *
   * Never throws for a plugin-side failure the host can absorb: a rejection here is a handler that
   * threw, which the chain records and skips.
   */
  call: (payload: HookPayload, signal: AbortSignal) => Promise<unknown>
}

// Module singletons, like the route, collection and extension-point registries beside them, with the
// same lifecycle answer: the plugin host clears a plugin's entries before re-registering them
// (./host.ts § clearRegistrations).
const points = new Map<string, HookPointRegistration>()
const handlers = new Map<string, HookHandlerRegistration>()

/**
 * Core's own points, declared here because core has no manifest to declare them in
 * (@acorn/protocol/extensionPoints.ts § CORE_HOOK_POINTS).
 *
 * `core:worktree-created` is the generalisation of the old single-slot `WORKTREE_CREATED` capability:
 * one plugin used to be able to run setup after a worktree appeared, and now any number can, in the
 * owner's order, with a timeout each and a roster row when one fails. It allows `observe` and
 * `transform` and not `veto`: the worktree exists by the time this runs, so there is nothing left to
 * refuse, and a handler that wants to change what happens next changes the payload.
 */
const CORE_POINTS: readonly HookPointRegistration[] = [
  {
    id: 'core:worktree-created',
    ownerId: 'core',
    payload: { taskId: 'string', path: 'string' },
    allows: ['observe', 'transform'],
    // An order of magnitude above a task check's two seconds: setup here runs real commands in a fresh
    // worktree, and the person who asked for the task is watching it appear rather than waiting on a
    // dialog.
    timeoutMs: 30_000,
    onTimeout: 'allow',
    order: 'priority',
    collect: false,
  },
  {
    // The gate in front of every agent tool call, wherever the call came from: an MCP client, a managed
    // harness, or the renderer's own typed projection all land on one route (../routes/agentTools.ts).
    // Core's rather than the agents plugin's, because core owns the tool registry and the route; the
    // plugin owns sessions.
    //
    // `veto` and no `transform`: an approval gate says yes or no, and a plugin that could rewrite a
    // tool's arguments could turn a read into a write behind the tier the owner approved.
    id: 'core:before-tool-call',
    ownerId: 'core',
    payload: { taskId: 'string', tool: 'string', sessionId: 'string' },
    allows: ['observe', 'veto'],
    timeoutMs: 5_000,
    // Deny, unusually: this hook exists to be an approval gate, and a gate that opens when its keeper
    // stops answering is not one. The tier defaults still apply underneath, so the failure mode is a
    // tool call refused rather than a node that cannot act.
    onTimeout: 'deny',
    order: 'priority',
    collect: false,
  },
  {
    // What goes into a task's context snapshot, before it is assembled (../agentTools/contextSections.ts).
    // Core's rather than the context plugin's: that plugin is client-only, and the assembler is here.
    //
    // The payload is section names, so a budget shaper or a PII stripper can drop a section and nothing
    // else. Rewriting the items themselves would mean a handler editing another plugin's answer, which
    // is what the section registry exists to prevent.
    id: 'core:before-snapshot',
    ownerId: 'core',
    payload: { taskId: 'string', sections: 'string[]' },
    allows: ['observe', 'transform', 'veto'],
    timeoutMs: 5_000,
    onTimeout: 'allow',
    order: 'priority',
    collect: false,
  },
]

for (const point of CORE_POINTS) points.set(point.id, point)

/** What each handler's last run did, for the developer view and the roster row. Kept out of the
 *  registrations so a re-register does not wipe the record of why the previous one failed. */
export type HookRunRecord = { at: number; ms: number; outcome: 'ok' | 'skipped' | 'timeout' | 'failed' | 'vetoed'; detail?: string }

const lastRun = new Map<string, HookRunRecord>()

/** Declare a point this plugin (or core) owns. `ownerId` is bound by the host, never passed by the
 *  plugin, the same rule `openExtensionPoint` follows and for the same reason. */
export function registerHookPoint(registration: HookPointRegistration): Disposable {
  if (points.has(registration.id)) throw new Error(`Hook point already declared: ${registration.id}`)
  points.set(registration.id, registration)
  return { dispose: () => void points.delete(registration.id) }
}

/** Register one handler on somebody else's point (or your own). Registering before the point is
 *  declared is fine and expected: plugin init order is not a dependency contract. */
export function registerHookHandler(registration: HookHandlerRegistration): Disposable {
  if (handlers.has(registration.id)) throw new Error(`Duplicate hook handler '${registration.id}'.`)
  handlers.set(registration.id, registration)
  return { dispose: () => void handlers.delete(registration.id) }
}

/** Drop everything this plugin declared and everything it registered. Both halves, because a plugin
 *  that goes away leaves neither a point nothing owns nor a handler nothing can dispose. */
export function clearHooks(pluginId: string): void {
  for (const [id, point] of points) if (point.ownerId === pluginId) points.delete(id)
  for (const [id, handler] of handlers) if (handler.pluginId === pluginId) handlers.delete(id)
}

/** Every point declared on this node, for the developer view and for tests. */
export const hookPoints = (): HookPointRegistration[] => [...points.values()].sort((a, b) => a.id.localeCompare(b.id))

/**
 * The handlers that will actually run at this point, in the order they will run in.
 *
 * Two filters and they are the whole of "an owner that declared no hook has said no": a handler on a
 * point nobody declared is never called, and neither is one asking for a mode the owner did not allow.
 * Both stay registered, because the developer view's job is to say that they matched nothing.
 */
export function hookHandlersFor(pointId: string): HookHandlerRegistration[] {
  const point = points.get(pointId)
  if (!point) return []
  return [...handlers.values()]
    .filter((handler) => handler.point === pointId && point.allows.includes(handler.mode))
    .sort((a, b) => (point.order === 'priority' ? a.priority - b.priority : 0) || a.id.localeCompare(b.id))
}

/** Every handler registered anywhere, with whether its point exists, for the developer view. */
export const hookHandlers = (): (HookHandlerRegistration & { matched: boolean; lastRun?: HookRunRecord })[] =>
  [...handlers.values()]
    .map((handler) => {
      const point = points.get(handler.point)
      const record = lastRun.get(handler.id)
      return {
        ...handler,
        matched: !!point && point.allows.includes(handler.mode),
        ...(record ? { lastRun: record } : {}),
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))

// One handler's turn in the chain: when it started, and the ids its span and everything it does
// inside it share. A chain is one trace, not one per handler, because three handlers answering one
// question are one thing that happened (docs/telemetry.md § Traces). Empty ids when nothing is
// collecting, so a chain costs no allocation it will not use.
type HookRun = { started: number; traceId: string; spanId: string }
const beginRun = (traceId: string): HookRun => ({ started: Date.now(), traceId, spanId: traceId ? newSpanId() : '' })

// The developer view's record of one handler, and its span. Both from the same three facts, because
// `note` was already a span in all but name: a start, an end and a closed outcome set. The owner is
// the handler's plugin, stamped from the registration and never read off the handler's answer, the
// same rule the verdict's `by` follows.
const note = (handler: HookHandlerRegistration, run: HookRun, outcome: HookRunRecord['outcome'], detail?: string): void => {
  const at = Date.now()
  lastRun.set(handler.id, { at, ms: at - run.started, outcome, ...(detail ? { detail } : {}) })
  if (!telemetryEnabled()) return
  emitSpan(handler.pluginId, {
    traceId: run.traceId,
    spanId: run.spanId,
    name: 'hook.run',
    start: run.started,
    durationMs: at - run.started,
    status: outcome === 'failed' || outcome === 'timeout' ? 'error' : 'ok',
    attrs: { seam: 'hook.run', 'hook.point': handler.point, 'hook.handler': handler.id, 'hook.outcome': outcome },
  })
}

const displayText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, REASON_MAX) : undefined

/**
 * One handler, bounded and contained. `'timeout'` for a handler that did not answer in time, `null`
 * for one that threw.
 *
 * The deadline races the call rather than only signalling an abort, the same shape ./taskChecks.ts
 * uses and for the same reason: a handler that ignores its signal would otherwise leave this promise
 * pending forever, and with it whatever the owner was about to do. The abandoned work still runs; the
 * deadline only guarantees that nobody is waiting for it.
 */
async function callOne(
  handler: HookHandlerRegistration,
  run: HookRun,
  payload: HookPayload,
  timeoutMs: number,
): Promise<unknown | 'timeout' | null> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve('timeout')
    }, timeoutMs)
  })
  try {
    // The handler runs inside its own span, so whatever it spawns or queries is filed under its
    // plugin and lands in the chain's trace (../telemetry/context.ts).
    const answer = runWithTelemetry({ traceId: run.traceId, spanId: run.spanId, owner: handler.pluginId }, () =>
      handler.call(payload, controller.signal))
    return await Promise.race([answer, deadline])
  } catch (error) {
    log.warn(`${handler.id} on '${handler.point}' failed: ${describeError(error).message}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Run the chain for one point and answer the owner.
 *
 * Never rejects and never returns a payload the owner did not declare. Every failure mode — a point
 * nobody declared, a handler that threw, a transform that answered with the wrong shape, a veto that
 * stalled — resolves to a verdict, because every caller is a code path that was about to do something
 * and "the interceptor is broken" must not be the thing that stops it.
 *
 * The chain rules, all of them, are these thirty lines:
 *
 *   - Handlers never see each other. Each is called with the payload as it stands when its turn comes.
 *   - Observers run alongside and cannot affect anything, so their answers are dropped unread.
 *   - A transform's answer is validated against the same shape as its input. Anything else is treated
 *     as no change and recorded.
 *   - The chain stops at the first veto unless the owner declared `collect`.
 *   - A timed-out veto is treated as the owner's `onTimeout` says. Fail open by default, because a
 *     plugin that stalls must not brick a push.
 */
export async function runHook<T extends HookPayload>(pointId: string, payload: T): Promise<HookVerdict<T>> {
  const point = points.get(pointId)
  // An undeclared point is not an error. Core declares its own points at boot and a plugin declares its
  // own at init, so the only way here is a caller running before its own declaration, and the honest
  // answer to "did anybody object" when nobody could have is no.
  if (!point) return { ok: true, payload }
  if (!matchesHookPayload(point.payload, payload)) {
    // The owner's own bug, not a plugin's, so it is loud. Running the chain with a payload that does not
    // match the declaration would hand strangers' handlers a shape the trust prompt never described.
    log.warn(`'${pointId}' was run with a payload its own declaration does not describe`)
    return { ok: true, payload }
  }

  const chain = hookHandlersFor(pointId)
  // One trace for the whole chain, minted here because nothing asked for this from outside: a hook
  // point is reached from inside some other piece of work, and its handlers are one answer to one
  // question.
  const traceId = telemetryEnabled() ? newTraceId() : ''
  // Fired and forgotten, deliberately: an observer's answer is not read, and awaiting one would give it
  // the power over timing that `observe` exists to withhold.
  for (const handler of chain.filter((entry) => entry.mode === 'observe')) {
    const run = beginRun(traceId)
    void callOne(handler, run, payload, point.timeoutMs).then((answer) => {
      note(handler, run, answer === 'timeout' ? 'timeout' : answer === null ? 'failed' : 'ok')
    })
  }

  let current = payload
  const reasons: { reason: string; by: string }[] = []
  for (const handler of chain) {
    if (handler.mode === 'observe') continue
    const run = beginRun(traceId)
    const answer = await callOne(handler, run, current, point.timeoutMs)
    if (answer === null) {
      note(handler, run, 'failed')
      continue
    }
    if (handler.mode === 'transform') {
      if (answer === 'timeout') {
        note(handler, run, 'timeout')
        continue
      }
      const next = (answer as { payload?: unknown })?.payload
      if (matchesHookPayload(point.payload, next)) {
        current = next as T
        note(handler, run, 'ok')
      } else {
        // Recorded rather than refused: a transform that answers with the wrong shape has said nothing,
        // and the author needs the developer view to tell them so.
        note(handler, run, 'skipped', 'answered with a payload the point does not declare')
      }
      continue
    }
    // veto
    if (answer === 'timeout') {
      note(handler, run, 'timeout')
      if (point.onTimeout === 'deny') {
        reasons.push({ reason: `${handler.pluginId} did not answer in time`, by: handler.pluginId })
        if (!point.collect) break
      }
      continue
    }
    const verdict = answer as { ok?: unknown; reason?: unknown }
    if (verdict?.ok === false) {
      note(handler, run, 'vetoed', displayText(verdict.reason))
      reasons.push({
        reason: displayText(verdict.reason) ?? `${handler.pluginId} stopped this`,
        // Stamped by the host from the registration, never read off the answer: a handler that could
        // name the blamed plugin could blame a different one.
        by: handler.pluginId,
      })
      if (!point.collect) break
    } else {
      note(handler, run, 'ok')
    }
  }

  const first = reasons[0]
  return {
    ok: reasons.length === 0,
    payload: current,
    ...(first ? { reason: first.reason, by: first.by } : {}),
    ...(point.collect && reasons.length ? { reasons } : {}),
  }
}

/** The modes a handler may ask for, as a runtime check over a value off a manifest. Re-exported here so
 *  the host has one import for the whole hook contract. */
export { isHookMode }
