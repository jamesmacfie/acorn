import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { rgPath } from '@vscode/ripgrep'
import { SearchFailure } from '../shared/search'
import type { SearchResult } from '../shared/search'
import { RgResults } from './searchResults'

// The former whole-output ceiling was 32 MiB. A 64 MiB per-record ceiling preserves those
// supported minified lines without max-columns changing their exact match positions.
const MAX_RECORD_BYTES = 64 * 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024

export function runRipgrep(root: string, args: string[], options: {
  signal?: AbortSignal
  executable?: string
  timeoutMs?: number
  maxRecordBytes?: number
  allowedPaths?: ReadonlySet<string>
} = {}): Promise<SearchResult> {
  if (options.signal?.aborted) return Promise.reject(new SearchFailure('cancelled', 'Search was cancelled.'))
  return new Promise((resolve, reject) => {
    const results = new RgResults(options.allowedPaths)
    const maxRecord = options.maxRecordBytes ?? MAX_RECORD_BYTES
    const child = spawn(options.executable ?? rgPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    let failure: SearchFailure | undefined
    let partial: Buffer[] = []
    let partialBytes = 0
    let stderr = ''
    let stderrBytes = 0
    let stopping = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const stop = (error?: SearchFailure) => {
      if (stopping) return
      stopping = true
      failure = error
      partial = []
      partialBytes = 0
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 250)
    }
    const abort = () => stop(new SearchFailure('cancelled', 'Search was cancelled.'))
    const timeout = setTimeout(() => stop(new SearchFailure('timeout', 'Search timed out.')), options.timeoutMs ?? 10_000)
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()

    const record = (piece: Buffer, complete: boolean) => {
      if (partialBytes + piece.length > maxRecord) {
        stop(new SearchFailure('overflow', 'A ripgrep record exceeds the 64 MiB search limit.'))
        return
      }
      if (piece.length) { partial.push(piece); partialBytes += piece.length }
      if (!complete) return
      // Decode after joining the record, so both UTF-8 and JSON can span arbitrary chunks.
      const raw = Buffer.concat(partial, partialBytes).toString('utf8')
      partial = []
      partialBytes = 0
      try { results.accept(raw) }
      catch (error) { stop(error instanceof SearchFailure ? error : new SearchFailure('invalid_output', 'Ripgrep returned malformed match data.')); return }
      if (results.truncated) stop()
    }
    const stdout = (chunk: Buffer) => {
      if (stopping) return
      let start = 0
      while (start < chunk.length && !stopping) {
        const end = chunk.indexOf(10, start)
        if (end < 0) { record(chunk.subarray(start), false); break }
        record(chunk.subarray(start, end), true)
        start = end + 1
      }
    }
    const onStderr = (chunk: Buffer) => {
      const remaining = MAX_STDERR_BYTES - stderrBytes
      if (remaining > 0) {
        const accepted = chunk.subarray(0, remaining)
        stderr += accepted.toString('utf8')
        stderrBytes += accepted.length
      }
    }
    const onError = () => { failure ??= new SearchFailure('launch_failed', 'Unable to start ripgrep.'); stopping = true }
    child.stdout.on('data', stdout)
    child.stderr.on('data', onStderr)
    child.on('error', onError)
    child.once('close', (code, signal) => {
      // close joins exit and both pipes, including failed startup. Never resolve just on abort.
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', abort)
      child.stdout.removeListener('data', stdout)
      child.stderr.removeListener('data', onStderr)
      child.removeListener('error', onError)
      if (!stopping && partialBytes) record(Buffer.alloc(0), true)
      if (killTimer) clearTimeout(killTimer)
      partial = []
      if (failure) reject(failure)
      else if (results.truncated) resolve(results.result())
      else if (code === 0 || code === 1) resolve(results.result())
      else reject(new SearchFailure(code === 2 && stderr.includes('regex parse error:') ? 'invalid_query'
        : code === 2 && stderr.includes('error parsing glob') ? 'invalid_filter' : 'execution_failed',
        stderr.trim() || `Ripgrep exited with ${code ?? signal}.`))
    })
  })
}

// Ripgrep owns glob matching. The text search itself runs with ordinary ignore/hidden defaults;
// this file list only narrows which of those results may count toward the 2,000-hit limit.
export function listFilteredPaths(root: string, folder: string, include: readonly string[], exclude: readonly string[], signal?: AbortSignal): Promise<ReadonlySet<string>> {
  const args = ['--files', '--null', '--no-config']
  for (const pattern of include) args.push('--glob', pattern)
  for (const pattern of exclude) args.push('--glob', pattern.startsWith('!') ? pattern : `!${pattern}`)
  args.push('--', folder)
  return new Promise((resolve, reject) => {
    execFile(rgPath, args, { cwd: root, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, timeout: 10_000, signal }, (error, stdout, stderr) => {
      if (signal?.aborted) { reject(new SearchFailure('cancelled', 'Search was cancelled.')); return }
      const message = stderr.toString('utf8')
      if (error && (error as NodeJS.ErrnoException).code !== '1' && (error as { code?: number }).code !== 1) {
        const code = message.includes('error parsing glob') ? 'invalid_filter'
          : (error as { killed?: boolean }).killed ? 'timeout'
          : (error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'overflow' : 'execution_failed'
        reject(new SearchFailure(code, message.trim() || 'Unable to list filtered search paths.'))
        return
      }
      resolve(new Set(stdout.toString('utf8').split('\0').filter(Boolean).map((path) => path.startsWith('./') ? path.slice(2) : path)))
    })
  })
}
