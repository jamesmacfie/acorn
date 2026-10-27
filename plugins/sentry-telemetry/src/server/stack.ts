// A V8 or WebKit stack string, turned into the frames Sentry draws.
//
// acorn carries a stack as the string `Error.stack` gave it, because a record is scalars and a
// frame list is not (`TelemetryRecord` in protocol). Sentry wants `stacktrace.frames[]`, so somebody has to
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
// the data root as `<data>` (docs/telemetry/model.md § What never leaves the machine).
//
// A packaged file's path depends on where the app is installed, so a packaged Node frame gets the
// fixed name its source map was uploaded under, `app:///helper/…` or `app:///plugins/<id>/dist/…`
// (docs/integrations/sentry/the-acorn-teams-dsn.md § Readable stacks). Renderer frames are URLs
// already, and Sentry matches their path whatever the scheme and host.
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
// WebKit writes `fn@app://acorn/file.js:1:2`, `@url:1:2`, and `fn@[native code]`.
const WEBKIT_FRAME = /^(?<fn>.*?)@(?<loc>.+:\d+(?::\d+)?|\[native code\])$/
const LOCATION = /^(?<file>.*?)(?::(?<line>\d+))?(?::(?<col>\d+))?$/
// The last `helper/` or `plugins/<id>/dist/` in the path, as the packaged app and the data root lay
// them out. Only `.js`, so a frame from TypeScript source run in a checkout keeps its real path.
const PACKAGED = /^.*[\\/](helper|plugins[\\/][^\\/]+[\\/]dist)[\\/]([^:]+\.js)$/

const uploadedName = (file: string): string => {
  const packaged = PACKAGED.exec(file)
  return packaged ? `app:///${packaged[1]}/${packaged[2]}`.replaceAll('\\', '/') : file
}

/** How many frames one error may carry. Sentry keeps 50 server-side, so more is bytes nobody sees. */
const MAX_FRAMES = 50

export function parseStack(stack: string): SentryStackFrame[] {
  const frames: SentryStackFrame[] = []
  for (const line of stack.split('\n')) {
    // The first line is `Error: message`, which is the exception's own type and value, not a frame.
    const parsed = FRAME.exec(line) ?? WEBKIT_FRAME.exec(line.trim())
    if (!parsed?.groups) continue
    const fn = parsed.groups.fn?.trim()
    if (parsed.groups.loc === '[native code]') {
      if (fn) frames.push({ function: fn, in_app: false })
      continue
    }
    const location = LOCATION.exec(parsed.groups.loc.trim())
    const file = location?.groups?.file?.trim()
    if (!file && !fn) continue
    const lineno = Number(location?.groups?.line)
    const colno = Number(location?.groups?.col)
    const name = file && uploadedName(file)
    frames.push({
      ...(fn ? { function: fn } : {}),
      ...(name ? { filename: name, abs_path: name } : {}),
      ...(Number.isFinite(lineno) ? { lineno } : {}),
      ...(Number.isFinite(colno) ? { colno } : {}),
      in_app: !!file && !file.includes('node_modules') && !file.startsWith('node:'),
    })
  }
  return frames.reverse().slice(-MAX_FRAMES)
}
