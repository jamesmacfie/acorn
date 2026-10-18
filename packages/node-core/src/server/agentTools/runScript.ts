import releaseSync from '@jitl/quickjs-wasmfile-release-sync'
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
} from 'quickjs-emscripten-core'
import type { ToolCallResult, ToolContext } from './registry.ts'

// The run_script handler. Only this module imports QuickJS, and run_script's registration loads it on
// first use, so the interpreter stays out of the Node's boot code.

export const SCRIPT_LIMITS = {
  timeMs: 120_000,
  // The program's own JavaScript runs on the Node's event loop, which nothing else can use meanwhile.
  // Waiting on a tool call doesn't count.
  engineMs: 1_000,
  calls: 50,
  memoryBytes: 32 * 1024 * 1024,
  // QuickJS checks its own stack, but Node's native stack runs out first above about 512 KiB.
  stackBytes: 256 * 1024,
  logChars: 32_768,
}

export type ScriptCall = { tool: string; ok: boolean; error?: string }
export type ScriptResult =
  | { ok: true; value: unknown; logs: string[]; calls: ScriptCall[] }
  | { ok: false; error: { message: string; line?: number }; logs: string[]; calls: ScriptCall[] }

// Built inside the engine, so `tools` and `console` are the program's own objects. The host hands
// in two functions, and values cross both ways as JSON text.
const PRELUDE = `(call, log) => {
  globalThis.tools = new Proxy({}, {
    get: (_, name) => typeof name === 'string' && name !== 'then'
      ? (input) => call(name, JSON.stringify(input === undefined ? {} : input)).then((text) => JSON.parse(text))
      : undefined,
  })
  const write = (...args) => log(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a) ?? String(a)).join(' '))
  globalThis.console = { log: write, info: write, warn: write, error: write }
}`

// The program runs inside an async function so it can await and return. The wrapper shares the
// program's first line, so line numbers in errors match the program's own.
const wrap = (code: string) => `(async () => {${code}\n})().then((value) => JSON.stringify(value ?? null))`

class ScriptStopped extends Error {}

export async function runScript(code: string, ctx: ToolContext): Promise<ScriptResult> {
  const callTool = ctx.callTool
  if (!callTool) throw new Error('run_script reached its handler without a tool caller.')
  const logs: string[] = []
  const calls: ScriptCall[] = []
  const deadline = Date.now() + SCRIPT_LIMITS.timeMs
  const stop = new AbortController()
  const timeUp = () => stop.abort(new ScriptStopped(`It ran past the ${SCRIPT_LIMITS.timeMs / 1000}-second limit.`))
  const timer = setTimeout(timeUp, SCRIPT_LIMITS.timeMs)
  const cancel = () => stop.abort(new ScriptStopped('The call was cancelled.'))
  ctx.signal?.addEventListener('abort', cancel, { once: true })
  if (ctx.signal?.aborted) cancel()

  // A fresh wasm module per program, about a millisecond each. A deeply nested value can overflow
  // Node's own stack inside the engine, which leaves that module unusable, so no program shares one.
  const quickjs = await newQuickJSWASMModuleFromVariant(releaseSync)
  const runtime = quickjs.newRuntime()
  runtime.setMemoryLimit(SCRIPT_LIMITS.memoryBytes)
  runtime.setMaxStackSize(SCRIPT_LIMITS.stackBytes)
  // Engine time is counted around the program's own runs. The handler also fires during the host's
  // short calls into the engine, and those don't count.
  let engineMs = 0
  let sliceStart: number | undefined
  const inEngine = <T>(work: () => T): T => {
    sliceStart = performance.now()
    try {
      return work()
    } finally {
      engineMs += performance.now() - sliceStart
      sliceStart = undefined
    }
  }
  // The timer can't fire while the engine runs, so a busy program checks the clock here.
  runtime.setInterruptHandler(() => {
    if (Date.now() > deadline) timeUp()
    else if (sliceStart !== undefined && engineMs + performance.now() - sliceStart > SCRIPT_LIMITS.engineMs)
      stop.abort(new ScriptStopped(`It ran JavaScript for more than ${SCRIPT_LIMITS.engineMs / 1000} seconds.`))
    return stop.signal.aborted
  })
  const vm = runtime.newContext()
  const pending = new Set<QuickJSDeferredPromise>()
  let woken: () => void = () => {}
  let logChars = 0

  const fail = (message: string, line?: number): ScriptResult => ({
    ok: false,
    error: line ? { message, line } : { message },
    logs,
    calls,
  })

  const log = vm.newFunction('log', (text) => {
    const line = vm.getString(text)
    if (logChars >= SCRIPT_LIMITS.logChars) return
    logChars += line.length
    logs.push(logChars > SCRIPT_LIMITS.logChars ? '[acorn dropped the rest of the logs]' : line)
  })

  // A thrown error here reaches the program as one thrown by `tools.<name>()`.
  const call = vm.newFunction('call', (nameHandle, inputHandle) => {
    const name = vm.getString(nameHandle)
    if (calls.length >= SCRIPT_LIMITS.calls) throw new Error(`run_script allows ${SCRIPT_LIMITS.calls} tool calls.`)
    const input: unknown = JSON.parse(vm.getString(inputHandle))
    const entry: ScriptCall = { tool: name, ok: false, error: 'cancelled' }
    calls.push(entry)
    const callId = ctx.callId ? `${ctx.callId}:${calls.length}` : undefined
    const deferred = vm.newPromise()
    pending.add(deferred)
    const settle = (result: ToolCallResult) => {
      if (stop.signal.aborted) return
      pending.delete(deferred)
      Object.assign(entry, result.ok ? { ok: true, error: undefined } : { error: result.error })
      try {
        const settled = result.ok ? vm.newString(JSON.stringify(result.value)) : vm.newError(refusal(name, result))
        if (result.ok) deferred.resolve(settled)
        else deferred.reject(settled)
        settled.dispose()
        deferred.dispose()
      } catch (error) {
        // Most likely a result too large for the program's memory.
        stop.abort(new ScriptStopped(`${name}'s result could not be passed in: ${(error as Error).message}`))
      }
      woken()
    }
    callTool(name, input, { callId, signal: stop.signal }).then(settle, (error) =>
      settle({
        ok: false,
        status: 500,
        error: 'failed',
        detail: [error instanceof Error ? error.message : String(error)],
      }),
    )
    // The library frees this handle once the call returns, and the deferred keeps its own resolvers.
    return deferred.handle
  })

  // Reading a thrown object can run its getters and toJSON, so it counts as the program's time.
  const programError = (handle: QuickJSHandle): ScriptResult => {
    const [message, line] = inEngine(() => thrownError(vm, handle, code))
    return stop.signal.aborted ? fail(`The program stopped. ${stop.signal.reason.message}`) : fail(message, line)
  }

  let program: QuickJSHandle | undefined
  try {
    const prelude = vm.unwrapResult(vm.evalCode(PRELUDE, 'prelude.js'))
    vm.unwrapResult(vm.callFunction(prelude, vm.undefined, call, log)).dispose()
    prelude.dispose()

    const evaluated = inEngine(() => vm.evalCode(wrap(code), 'script.js'))
    if (evaluated.error) return programError(evaluated.error)
    program = evaluated.value
    for (;;) {
      inEngine(() => runtime.executePendingJobs())
      const state = vm.getPromiseState(program)
      if (state.type === 'fulfilled') {
        const text = state.value.consume((value) => (vm.typeof(value) === 'string' ? vm.getString(value) : null))
        if (text === null) return fail('The program changed JSON.stringify, so its result could not be read.')
        return { ok: true, value: JSON.parse(text), logs, calls }
      }
      if (state.type === 'rejected') {
        if (stop.signal.aborted) return fail(`The program stopped. ${stop.signal.reason.message}`)
        return programError(state.error)
      }
      if (stop.signal.aborted) return fail(`The program stopped. ${stop.signal.reason.message}`)
      if (pending.size === 0) return fail('The program is waiting on a promise that nothing will settle.')
      await new Promise<void>((resolve) => {
        woken = resolve
        stop.signal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
  } catch (error) {
    if (stop.signal.aborted) return fail(`The program stopped. ${stop.signal.reason.message}`)
    // A host error from inside the engine, such as Node's own stack overflowing on a deeply nested
    // value. The module is discarded, so nothing else runs on it.
    return fail(`The interpreter failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    ctx.signal?.removeEventListener('abort', cancel)
    if (!stop.signal.aborted) stop.abort(new ScriptStopped('The program finished.'))
    try {
      for (const deferred of pending) deferred.dispose()
      program?.dispose()
      call.dispose()
      log.dispose()
      vm.dispose()
      runtime.dispose()
    } catch {
      // A module that failed mid-run can't free its runtime cleanly. Dropping the module frees it.
    }
  }
}

function refusal(name: string, result: Extract<ToolCallResult, { ok: false }>): string {
  return `${name}: ${result.error}${result.detail?.length ? ` (${result.detail.join('; ')})` : ''}`
}

// `name: message`, with the program's line from the stack. A syntax error at the end of the program
// points at the wrapper's closing line, so the line is capped at the program's last.
function thrownError(vm: QuickJSContext, handle: QuickJSHandle, code: string): [string, number | undefined] {
  const thrown = handle.consume((error) => vm.dump(error)) as unknown
  const message =
    thrown && typeof thrown === 'object' && 'message' in thrown
      ? `${String((thrown as { name?: unknown }).name ?? 'Error')}: ${String(thrown.message)}`
      : `Uncaught ${JSON.stringify(thrown) ?? String(thrown)}`
  const stack = thrown && typeof thrown === 'object' && 'stack' in thrown ? String(thrown.stack) : ''
  const found = /script\.js:(\d+)/.exec(stack)
  return [message, found ? Math.min(Number(found[1]), code.split('\n').length) : undefined]
}
