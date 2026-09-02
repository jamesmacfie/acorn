// The helper's cold-start account, behind `ACORN_PERF=1`.
//
// The desktop opens in three processes and the helper is the middle one: Rust spawns it, it sweeps its
// caches, starts and supervises the node, binds the WebSocket the renderer talks to, and only then
// prints the ready line Rust is blocked on. Every one of those steps is in front of the window
// appearing, and none of them was timed (docs/local-development.md § Timing a cold start).
//
// stderr, not stdout: stdout is the line protocol Rust parses, and a timing line on it is a handshake
// Rust cannot read (apps/desktop/src/helper/helperMain.ts). Behind the switch rather than
// unconditional, unlike the node's own boot marks, because this stream is the one a developer watches
// while using the app.
//
// The clock starts when this module is evaluated, which in the helper is the first thing its bundle
// does, so the offsets are from process start closely enough to subtract from Rust's own spawn time.

export const HELPER_PERF = process.env.ACORN_PERF === '1'

const started = process.hrtime.bigint()
let previous = started

export function helperMark(label: string): void {
  if (!HELPER_PERF) return
  const now = process.hrtime.bigint()
  const ms = (from: bigint) => (Number(now - from) / 1e6).toFixed(0)
  console.error(`[helper:boot] ${label} +${ms(started)}ms (${ms(previous)}ms)`)
  previous = now
}
