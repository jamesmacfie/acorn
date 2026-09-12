// A V8 stack string, turned into the frames Sentry draws.
//
// acorn carries a stack as the string `Error.stack` gave it, because a record is scalars and a
// frame list is not (protocol/telemetry.ts). Sentry wants `stacktrace.frames[]`, so somebody has to
// take the string apart, and the exporter is the only side that knows it needs to.
//
// Two details that are easy to get wrong and invisible when you do:
//
//   Order. V8 writes newest first; Sentry reads oldest first and draws the last frame as the one
//   that threw. So the list is reversed.
//   `in_app`. Without it every frame renders the same and a dependency's internals sit at the top
//   of the issue. A frame is in-app when its path is not inside `node_modules`.
//
// The paths here have already been through core's scrubber, so a home directory reads as `~` and
// the data root as `<data>` (docs/telemetry.md § What never leaves the machine).
//
// No acorn imports.

export type SentryStackFrame = {
  function?: string
  filename?: string
  abs_path?: string
  lineno?: number
  colno?: number
  in_app: boolean
}

// `at fn (/path/file.ts:1:2)`, `at fn (/path/file.ts)`, `at /path/file.ts:1:2`, and the
// `at async fn (…)` form Node writes for an awaited call.
const FRAME = /^\s*at\s+(?:(?<fn>.+?)\s+\()?(?<loc>[^()]+?)\)?$/
const LOCATION = /^(?<file>.*?)(?::(?<line>\d+))?(?::(?<col>\d+))?$/

/** How many frames one error may carry. Sentry keeps 50 server-side, so more is bytes nobody sees. */
const MAX_FRAMES = 50

export function parseStack(stack: string): SentryStackFrame[] {
  const frames: SentryStackFrame[] = []
  for (const line of stack.split('\n')) {
    // The first line is `Error: message`, which is the exception's own type and value, not a frame.
    if (!/^\s*at\s/.test(line)) continue
    const parsed = FRAME.exec(line)
    if (!parsed?.groups) continue
    const location = LOCATION.exec(parsed.groups.loc.trim())
    const file = location?.groups?.file?.trim()
    const fn = parsed.groups.fn?.trim()
    if (!file && !fn) continue
    const lineno = Number(location?.groups?.line)
    const colno = Number(location?.groups?.col)
    frames.push({
      ...(fn ? { function: fn } : {}),
      ...(file ? { filename: file, abs_path: file } : {}),
      ...(Number.isFinite(lineno) ? { lineno } : {}),
      ...(Number.isFinite(colno) ? { colno } : {}),
      in_app: !!file && !file.includes('node_modules') && !file.startsWith('node:'),
    })
  }
  return frames.reverse().slice(-MAX_FRAMES)
}
