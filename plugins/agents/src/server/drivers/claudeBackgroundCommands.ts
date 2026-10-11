// Claude Code's background commands: a Bash call with `run_in_background: true` returns at once, and
// the command runs on, writing to a file in Claude's temporary folder. This module reads the launch and
// the exit off the wire and copies the file's output onto the command's card while it runs.
// docs/managed-agents/background-commands.md describes the whole feature.
//
// Captured on Claude Code 2.1.296 with adapter 0.54.1 (./__fixtures__/claudeBackgroundCommandWire.json):
//   launch  the Bash call's completing update carries the receipt text below, and an earlier update
//           carries `toolResponse.backgroundTaskId`
//   exit    a `task_notification` SDK message, which the adapter forwards as the `_claude/sdkMessage`
//           extension notification only when the session asks for it (claudeHarness.ts)
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { createLogger } from '@acorn/plugin-api/node'
import type { AgentToolCall } from '../../contract/wire.ts'
import type { AgentDriverEvent } from './types'

const log = createLogger('agents:provider', 'agents')

/** What the card keeps of a command's output. The materializer's inline limit, so a card never turns
 *  into an artifact pointer halfway through a run. */
export const BACKGROUND_OUTPUT_CAP = 64 * 1024
/** What stays when output passes the cap: the newest part, which is where a build or a test run says
 *  how it went. */
const BACKGROUND_OUTPUT_KEEP = 48 * 1024
const CUT_NOTE = '[Earlier output was cut. This shows the newest part.]\n'
const POLL_MS = 1_000

const RECEIPT = /^Command running in background with ID: (\S+)\. Output is being written to: (.+?\/tasks\/\1\.output)\./

/** The launch receipt of a background Bash call: the harness's task id and the file it writes. */
export function claudeBackgroundLaunch(text: string | undefined): { taskId: string; outputPath: string } | undefined {
  const match = text ? RECEIPT.exec(text.trim()) : null
  return match ? { taskId: match[1], outputPath: match[2] } : undefined
}

export type ClaudeTaskNotification = {
  toolUseId: string
  status: NonNullable<AgentToolCall['status']>
  exitCode?: number
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value != null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

/**
 * A `task_notification` from the `_claude/sdkMessage` extension notification, read as a command's end.
 *
 * The exit code is only in the summary, `Background command "x" completed (exit code 0)` or `... failed
 * with exit code 1`. The SDK's own `status` says whether it passed. `stopped` is Claude stopping it
 * through its own tool.
 */
export function claudeTaskNotification(params: unknown): ClaudeTaskNotification | undefined {
  const message = asRecord(asRecord(params)?.message)
  if (message?.type !== 'system' || message.subtype !== 'task_notification') return undefined
  const toolUseId = typeof message.tool_use_id === 'string' ? message.tool_use_id : undefined
  if (!toolUseId) return undefined
  const code = typeof message.summary === 'string' ? /exit code (-?\d+)/.exec(message.summary)?.[1] : undefined
  const status = message.status === 'completed' ? 'completed' : message.status === 'stopped' ? 'cancelled' : 'failed'
  return { toolUseId, status, ...(code != null ? { exitCode: Number(code) } : {}) }
}

/**
 * The folders Claude may write a task's output under: `claude-<uid>` in `CLAUDE_CODE_TMPDIR` when the
 * session sets it, else in `/tmp`. The OS temporary folder is included for a build that follows it.
 * Resolved, because macOS's `/tmp` is a link to `/private/tmp` and the receipt names the real path.
 */
export async function claudeTaskRoots(env: Record<string, string | undefined>): Promise<string[]> {
  const folder = `claude-${process.getuid?.() ?? 0}`
  const bases = [env.CLAUDE_CODE_TMPDIR, '/tmp', tmpdir()].filter((base): base is string => Boolean(base))
  const roots = await Promise.all(bases.map((base) => realpath(join(base, folder)).catch(() => undefined)))
  return [...new Set(roots.filter((root): root is string => root != null))]
}

type Tail = {
  toolCallId: string
  turnId: string | null
  path: string
  offset: number
  decoder: StringDecoder
  /** What the card holds right now, so a cut can keep its newest part. */
  shown: string
  timer?: ReturnType<typeof setTimeout>
  reading?: Promise<void>
}

/**
 * The commands one Claude session has running in the background, and the files the driver reads for
 * them. One per ACP connection: when the harness stops, so does every tail, and the runtime's lifecycle
 * rule decides what the cards then say (../sessions/commandLifecycle.ts).
 */
export class ClaudeBackgroundCommands {
  /** The Acorn turn in flight, which a launch is attributed to. Set by the driver around each prompt. */
  turnId: string | null = null
  readonly #tails = new Map<string, Tail>()
  /** Every background command this connection launched, tailed or not, and the turn it launched in.
   *  Only their notifications settle a card, because a backgrounded subagent sends the same one. */
  readonly #launched = new Map<string, string | null>()
  #stopped = false

  constructor(
    private readonly emit: (event: AgentDriverEvent) => Promise<void>,
    private readonly roots: Promise<string[]>,
    private readonly pollMs = POLL_MS,
  ) {}

  /** A background call's receipt arrived. Starts reading its file if the path is one Claude owns. */
  launched(toolCallId: string, launch: { taskId: string; outputPath: string }): void {
    if (this.#stopped || this.#launched.has(toolCallId)) return
    this.#launched.set(toolCallId, this.turnId)
    const tail: Tail = {
      toolCallId,
      turnId: this.turnId,
      path: launch.outputPath,
      offset: 0,
      decoder: new StringDecoder('utf8'),
      shown: '',
    }
    // The folder rather than the file, which Claude may not have created yet.
    void this.#inside(dirname(launch.outputPath)).then((folder) => {
      if (this.#stopped) return
      if (!folder) {
        log.warn(`not reading background command output outside Claude's temporary folder: ${launch.outputPath}`)
        return
      }
      this.#tails.set(toolCallId, tail)
      this.#schedule(tail, 0)
    })
  }

  /** A task notification arrived. Reads what is left of the file, then settles the card. */
  async notified(params: unknown): Promise<void> {
    const ended = claudeTaskNotification(params)
    if (!ended || this.#stopped || !this.#launched.has(ended.toolUseId)) return
    const turnId = this.#launched.get(ended.toolUseId) ?? null
    this.#launched.delete(ended.toolUseId)
    const tail = this.#tails.get(ended.toolUseId)
    if (tail) {
      this.#tails.delete(ended.toolUseId)
      clearTimeout(tail.timer)
      await tail.reading
      await this.#read(tail)
    }
    await this.emit({
      type: 'tool',
      tool: {
        id: ended.toolUseId,
        title: '',
        kind: 'execute',
        background: true,
        status: ended.status,
        ...(ended.exitCode != null ? { exitCode: ended.exitCode } : {}),
      },
      acornTurnId: turnId,
    })
  }

  stop(): void {
    this.#stopped = true
    for (const tail of this.#tails.values()) clearTimeout(tail.timer)
    this.#tails.clear()
  }

  #schedule(tail: Tail, delay: number): void {
    tail.timer = setTimeout(() => {
      tail.reading = this.#read(tail)
        .catch((error: unknown) =>
          log.warn(
            `reading background command output failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
        .finally(() => {
          if (!this.#stopped && this.#tails.get(tail.toolCallId) === tail) this.#schedule(tail, this.pollMs)
        })
    }, delay)
  }

  // Opened per read rather than held, so a file that appears late or is replaced is still found. The
  // real path is checked each time, and the last component must not be a link, so a file swapped for
  // a link after the launch is not followed out of Claude's folder.
  async #read(tail: Tail): Promise<void> {
    const real = await this.#inside(tail.path)
    if (!real) return
    const handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const { size } = await handle.stat()
      // Rewritten from the start, so read it again from there.
      if (size < tail.offset) {
        tail.offset = 0
        tail.decoder = new StringDecoder('utf8')
      }
      let cut = false
      // More than the card keeps arrived since the last read. Skip to the part that would survive.
      if (size - tail.offset > BACKGROUND_OUTPUT_CAP) {
        tail.offset = size - BACKGROUND_OUTPUT_CAP
        tail.decoder = new StringDecoder('utf8')
        cut = true
      }
      if (size === tail.offset) return
      const buffer = Buffer.alloc(size - tail.offset)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, tail.offset)
      tail.offset += bytesRead
      const text = tail.decoder.write(buffer.subarray(0, bytesRead))
      if (text) await this.#show(tail, text, cut)
    } finally {
      await handle.close()
    }
  }

  /** The real path, when it is inside one of Claude's folders. */
  async #inside(path: string): Promise<string | undefined> {
    const real = await realpath(path).catch(() => undefined)
    if (!real) return undefined
    const roots = await this.roots
    return roots.some((root) => real.startsWith(root + sep)) ? real : undefined
  }

  // Appends while the card has room. Past the cap it replaces the card's output with its newest part
  // and a note saying so, which is the one way to drop the oldest part of a card that only appends.
  async #show(tail: Tail, text: string, cut: boolean): Promise<void> {
    const appended = tail.shown + text
    const fits = !cut && Buffer.byteLength(appended, 'utf8') <= BACKGROUND_OUTPUT_CAP
    tail.shown = fits ? appended : CUT_NOTE + newest(appended, BACKGROUND_OUTPUT_KEEP)
    await this.emit({
      type: 'tool',
      tool: fits
        ? { id: tail.toolCallId, title: '', kind: 'execute', output: text, outputAppend: true }
        : { id: tail.toolCallId, title: '', kind: 'execute', output: tail.shown },
      acornTurnId: tail.turnId,
    })
  }
}

/** The last `bytes` of `text`, from a line start where one is near, so a cut does not split a line. */
function newest(text: string, bytes: number): string {
  const buffer = Buffer.from(text.startsWith(CUT_NOTE) ? text.slice(CUT_NOTE.length) : text, 'utf8')
  if (buffer.length <= bytes) return buffer.toString('utf8')
  // Decoding from a byte in the middle of a character gives a replacement character, which is then
  // dropped with the partial line before the first break.
  const kept = buffer.subarray(buffer.length - bytes).toString('utf8')
  const lineStart = kept.indexOf('\n')
  return lineStart >= 0 && lineStart < 1024 ? kept.slice(lineStart + 1) : kept
}
