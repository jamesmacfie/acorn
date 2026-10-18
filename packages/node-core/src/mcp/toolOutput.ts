// The one size limit on an agent's tool result (docs/mcp/result-size.md). A result over the limit
// keeps its head and tail, because a log or a diff usually fails at the end, and the full text goes
// to a file the agent can read with its own file tool.
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { lstat, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 32 KiB is about 8,000 tokens, well under the 25,000 past which Claude Code cuts a result's end.
const HEAD_BYTES = 24 * 1024
const TAIL_BYTES = 8 * 1024
// How far a cut moves to land on a line break, so a JSON line or a diff line stays whole.
const LINE_SLACK = 1024
const KEEP_MS = 7 * 24 * 60 * 60 * 1000

const NEWLINE = 0x0a
// A UTF-8 continuation byte, which a cut must not start or end on.
const isContinuation = (byte: number | undefined) => byte !== undefined && (byte & 0xc0) === 0x80

const toolOutputRoot = () => join(tmpdir(), 'acorn-tool-output')

/** Where a task's full tool results go. The node and the MCP child share `TMPDIR` through the task
 *  environment, so both name the same folder. */
export const toolOutputDir = (taskId: string) => join(toolOutputRoot(), taskId)

/** Creates the folder if it's missing, and throws unless it's a real folder, not a link, that this
 *  user owns and nobody else can open. Linux's temp folder is shared, so another user could create a
 *  folder first, or plant a link, to read results, redirect a write, or aim the sweep at other files. */
function ownedDir(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const info = lstatSync(dir)
  // Windows has no uids to compare, and its temp folder is per user.
  const owned = !process.getuid || info.uid === process.getuid()
  if (!info.isDirectory() || !owned || info.mode & 0o077)
    throw new Error(`${dir} must be a folder only this user can open`)
  return dir
}

function headEnd(bytes: Buffer): number {
  const newline = bytes.lastIndexOf(NEWLINE, HEAD_BYTES - 1)
  if (newline + 1 >= HEAD_BYTES - LINE_SLACK) return newline + 1
  let end = HEAD_BYTES
  while (isContinuation(bytes[end])) end--
  return end
}

function tailStart(bytes: Buffer): number {
  let start = bytes.length - TAIL_BYTES
  const newline = bytes.indexOf(NEWLINE, start - 1)
  if (newline !== -1 && newline + 1 <= start + LINE_SLACK) return newline + 1
  while (isContinuation(bytes[start])) start++
  return start
}

/** The text unchanged when it fits, otherwise its head and tail around one marker line. The full text
 *  goes to the task's folder first, named after the call. */
export function capToolText(text: string, taskId: string, callId: string): string {
  const bytes = Buffer.from(text)
  if (bytes.length <= HEAD_BYTES + TAIL_BYTES) return text
  const head = bytes.subarray(0, headEnd(bytes)).toString()
  const tail = bytes.subarray(tailStart(bytes)).toString()
  const omitted = bytes.length - Buffer.byteLength(head) - Buffer.byteLength(tail)
  let saved: string
  try {
    const file = join(ownedDir(join(ownedDir(toolOutputRoot()), taskId)), `${callId}.txt`)
    // Owner-only, because the text can hold anything a tool returned. `wx` never overwrites.
    writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' })
    saved = `Read the full text from ${file}`
  } catch (error) {
    saved = `The full text could not be saved: ${(error as Error).message}`
  }
  const marker = `[acorn cut this result: ${bytes.length} bytes in all, ${omitted} left out here. ${saved}]`
  return `${head}${head.endsWith('\n') ? '' : '\n'}${marker}\n${tail}`
}

/** Deletes saved results older than seven days. Best effort: a file another process removed, or a
 *  folder it can't read, is skipped. It never follows a link, so it deletes only inside the root. */
export async function sweepToolOutput(now = Date.now()): Promise<void> {
  let root: string
  try {
    root = ownedDir(toolOutputRoot())
  } catch {
    return
  }
  for (const task of await readdir(root).catch(() => [])) {
    const dir = join(root, task)
    if (!(await lstat(dir).catch(() => null))?.isDirectory()) continue
    for (const name of await readdir(dir).catch(() => [])) {
      const file = join(dir, name)
      const info = await lstat(file).catch(() => null)
      if (info?.isFile() && now - info.mtimeMs > KEEP_MS) await rm(file, { force: true }).catch(() => {})
    }
  }
}
