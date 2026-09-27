import { chmodSync, closeSync, fstatSync, openSync, renameSync, rmSync, writeSync } from 'node:fs'

const MAX_LOG_BYTES = 8 * 1024 * 1024

/** The detached entry owns its log fd. Rotation happens before a write, so a long-running Node
 * cannot grow its log without bound. The startup credential uses fd 3 and never passes here. */
export function installBackgroundLog(path: string): void {
  let fd = openSync(path, 'a', 0o600)
  chmodSync(path, 0o600)
  const write = (chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
    const done = typeof encoding === 'function' ? encoding : callback
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8') : Buffer.from(chunk)
    try {
      const body = bytes.length > MAX_LOG_BYTES ? bytes.subarray(bytes.length - MAX_LOG_BYTES) : bytes
      if (fstatSync(fd).size + body.length > MAX_LOG_BYTES) {
        closeSync(fd)
        try {
          rmSync(`${path}.1`, { force: true })
          renameSync(path, `${path}.1`)
          fd = openSync(path, 'a', 0o600)
        } catch {
          // An open reader can prevent rename on Windows. Truncation still bounds this log and
          // leaves a writable fd rather than silently dropping every later message.
          fd = openSync(path, 'w', 0o600)
        }
        chmodSync(path, 0o600)
      }
      writeSync(fd, body)
      done?.(null)
    } catch (error) {
      done?.(error as Error)
    }
    return true
  }
  process.stdout.write = write as typeof process.stdout.write
  process.stderr.write = write as typeof process.stderr.write
}
