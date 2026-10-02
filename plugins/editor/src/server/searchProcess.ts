import { spawn } from 'node:child_process'
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
} = {}): Promise<SearchResult> {
  if (options.signal?.aborted) return Promise.reject(new SearchFailure('cancelled', 'Search was cancelled.'))
  return new Promise((resolve, reject) => {
    const results = new RgResults()
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
      else reject(new SearchFailure(code === 2 && stderr.includes('regex parse error:') ? 'invalid_query' : 'execution_failed',
        stderr.trim() || `Ripgrep exited with ${code ?? signal}.`))
    })
  })
}
