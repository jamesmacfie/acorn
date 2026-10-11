import { spawn } from 'node:child_process'
import { rgPath } from '@vscode/ripgrep'
import { SearchFailure } from '../shared/search'
import type { SearchResult } from '../shared/search'
import { RgResults } from './searchResults'

// A 64 MiB per-record ceiling keeps very long minified lines whole, without max-columns changing their
// exact match positions.
const MAX_RECORD_BYTES = 64 * 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const MAX_PATH_BYTES = 4 * 1024 * 1024

type ProcessEnd = { code: number | null; signal: NodeJS.Signals | null; stderr: string; stopped: boolean }

// Both ripgrep passes settle only after the child and its pipes close. A timed out or aborted
// process gets a grace period before SIGKILL, including when it ignores SIGTERM.
function runProcess(
  root: string,
  args: string[],
  options: { signal?: AbortSignal; executable?: string; timeoutMs?: number },
  onStdout: (chunk: Buffer, stop: (failure?: SearchFailure) => void) => void,
): Promise<ProcessEnd> {
  if (options.signal?.aborted) return Promise.reject(new SearchFailure('cancelled', 'Search was cancelled.'))
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable ?? rgPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    let failure: SearchFailure | undefined
    let stderr = ''
    let stderrBytes = 0
    let stopping = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const stop = (error?: SearchFailure) => {
      if (stopping) return
      stopping = true
      failure = error
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 250)
    }
    const abort = () => stop(new SearchFailure('cancelled', 'Search was cancelled.'))
    const timeout = setTimeout(
      () => stop(new SearchFailure('timeout', 'Search timed out.')),
      options.timeoutMs ?? 10_000,
    )
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    child.stdout.on('data', (chunk: Buffer) => {
      if (stopping) return
      try {
        onStdout(chunk, stop)
      } catch (cause) {
        stop(
          cause instanceof SearchFailure
            ? cause
            : new SearchFailure('invalid_output', 'Ripgrep returned malformed match data.'),
        )
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const accepted = chunk.subarray(0, Math.max(0, MAX_STDERR_BYTES - stderrBytes))
      stderr += accepted.toString('utf8')
      stderrBytes += accepted.length
    })
    child.on('error', () => {
      failure ??= new SearchFailure('launch_failed', 'Unable to start ripgrep.')
      stopping = true
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else resolve({ code, signal, stderr, stopped: stopping })
    })
  })
}

export function runRipgrep(
  root: string,
  args: string[],
  options: {
    signal?: AbortSignal
    executable?: string
    timeoutMs?: number
    maxRecordBytes?: number
    allowedPaths?: ReadonlySet<string>
  } = {},
): Promise<SearchResult> {
  const results = new RgResults(options.allowedPaths)
  const maxRecord = options.maxRecordBytes ?? MAX_RECORD_BYTES
  let partial: Buffer[] = []
  let partialBytes = 0
  const record = (piece: Buffer, complete: boolean, stop: (failure?: SearchFailure) => void) => {
    if (partialBytes + piece.length > maxRecord)
      throw new SearchFailure('overflow', 'A ripgrep record exceeds the 64 MiB search limit.')
    if (piece.length) {
      partial.push(piece)
      partialBytes += piece.length
    }
    if (!complete) return
    const raw = Buffer.concat(partial, partialBytes).toString('utf8')
    partial = []
    partialBytes = 0
    results.accept(raw)
    if (results.truncated) stop()
  }
  return runProcess(root, args, options, (chunk, stop) => {
    let start = 0
    while (start < chunk.length && !results.truncated) {
      const end = chunk.indexOf(10, start)
      if (end < 0) {
        record(chunk.subarray(start), false, stop)
        break
      }
      record(chunk.subarray(start, end), true, stop)
      start = end + 1
    }
  }).then(({ code, signal, stderr, stopped }) => {
    if (!stopped && partialBytes) record(Buffer.alloc(0), true, () => {})
    partial = []
    if (results.truncated || code === 0 || code === 1) return results.result()
    throw new SearchFailure(
      code === 2 && stderr.includes('regex parse error:')
        ? 'invalid_query'
        : code === 2 && stderr.includes('error parsing glob')
          ? 'invalid_filter'
          : 'execution_failed',
      stderr.trim() || `Ripgrep exited with ${code ?? signal}.`,
    )
  })
}

// Ripgrep owns glob matching. The text search itself runs with ordinary ignore/hidden defaults;
// this file list only narrows which of those results may count toward the 2,000-hit limit.
export function listFilteredPaths(
  root: string,
  folder: string,
  include: readonly string[],
  exclude: readonly string[],
  signal?: AbortSignal,
): Promise<ReadonlySet<string>> {
  const files = (globs: readonly string[]) => {
    const args = ['--files', '--null', '--no-config', ...globs, '--', folder]
    const chunks: Buffer[] = []
    let bytes = 0
    return runProcess(root, args, { signal }, (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_PATH_BYTES) throw new SearchFailure('overflow', 'The filtered file list exceeds the 4 MiB limit.')
      chunks.push(chunk)
    }).then(({ code, signal: exitSignal, stderr }) => {
      if (code !== 0 && code !== 1)
        throw new SearchFailure(
          code === 2 && stderr.includes('error parsing glob') ? 'invalid_filter' : 'execution_failed',
          stderr.trim() || `Ripgrep exited with ${code ?? exitSignal}.`,
        )
      return new Set(
        Buffer.concat(chunks, bytes)
          .toString('utf8')
          .split('\0')
          .filter(Boolean)
          .map((path) => (path.startsWith('./') ? path.slice(2) : path)),
      )
    })
  }
  const globs: string[] = []
  for (const pattern of include) globs.push('--glob', pattern)
  for (const pattern of exclude) globs.push('--glob', pattern.startsWith('!') ? pattern : `!${pattern}`)
  // A positive ripgrep glob can explicitly re-include hidden or .gitignored files. Keep
  // the default file set as the authority, then intersect with ripgrep's glob result.
  return files([]).then(async (defaults) => {
    const selected = await files(globs)
    return new Set([...selected].filter((path) => defaults.has(path)))
  })
}
