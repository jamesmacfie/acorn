import { TASK_SCRIPT_OUTPUT_BYTES } from '@acorn/protocol/taskScripts.ts'

/** Keep a valid UTF-8 suffix without retaining an oversized input's backing buffer. */
export function utf8Tail(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8')
  let start = Math.max(0, buffer.length - maxBytes)
  while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start++
  return buffer.subarray(start).toString('utf8')
}
export function appendOutput(previous: string, data: string): { output: string; truncated: boolean } {
  const joined = (previous + data).replace(/acorn_(?:it|dt)_[A-Za-z0-9_.-]+/g, '[redacted acorn credential]')
  return { output: utf8Tail(joined, TASK_SCRIPT_OUTPUT_BYTES), truncated: Buffer.byteLength(joined) > TASK_SCRIPT_OUTPUT_BYTES }
}
