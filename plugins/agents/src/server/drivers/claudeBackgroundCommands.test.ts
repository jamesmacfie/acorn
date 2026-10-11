import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolCall } from '../../contract/wire.ts'
import { mergeToolCall } from '../../shared/toolFold'
import { claudeBashLaunch, normalizeAcpUpdate } from './acpNormalizer'
import { BACKGROUND_OUTPUT_CAP, ClaudeBackgroundCommands, claudeTaskNotification } from './claudeBackgroundCommands'
import type { AgentDriverEvent } from './types'

type Captured = {
  events: Array<{ sessionUpdate?: SessionUpdate; extNotification?: { method: string; params: unknown } }>
}
const capture = JSON.parse(
  readFileSync(new URL('./__fixtures__/claudeBackgroundCommandWire.json', import.meta.url), 'utf8'),
) as {
  succeeded: Captured
  failed: Captured
}

const card = (run: Captured): AgentToolCall =>
  run.events
    .flatMap((entry) => (entry.sessionUpdate ? normalizeAcpUpdate(entry.sessionUpdate, 'Claude Code') : []))
    .flatMap((event) => (event.type === 'tool' ? [event.tool] : []))
    .reduce(mergeToolCall)

describe('Claude background commands on the wire', () => {
  it('reads the launch receipt as a running background command, not a finished call', () => {
    expect(card(capture.succeeded)).toMatchObject({
      title: 'sleep 8; echo done',
      kind: 'execute',
      status: 'running',
      background: true,
      // The receipt's text gives way to the command's own output.
      output: '',
    })
    const receipt = capture.succeeded.events
      .flatMap((entry) => (entry.sessionUpdate ? [claudeBashLaunch(entry.sessionUpdate)] : []))
      .find(Boolean)
    expect(receipt).toEqual({
      taskId: 'b3jeu131u',
      outputPath:
        '/private/tmp/claude-501/-private-tmp-acorn-bg-capture-work/7dc0c46a-c1c3-4375-8c17-6916b57efbbe/tasks/b3jeu131u.output',
    })
  })

  it('reads the exit code and outcome from the task notification', () => {
    const ended = (run: Captured) =>
      run.events.flatMap((entry) =>
        entry.extNotification ? [claudeTaskNotification(entry.extNotification.params)] : [],
      )
    expect(ended(capture.succeeded)).toEqual([
      { toolUseId: 'toolu_01HcvFNs7ANgoJSj8u9SbiFk', status: 'completed', exitCode: 0 },
    ])
    expect(ended(capture.failed)).toEqual([
      { toolUseId: 'toolu_01LNKGfaEr9SjBdxhDrYR2Vm', status: 'failed', exitCode: 1 },
    ])
  })
})

describe('ClaudeBackgroundCommands', () => {
  let base: string
  let root: string
  let tasks: string
  let events: AgentDriverEvent[]
  let commands: ClaudeBackgroundCommands

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'acorn-bg-')))
    root = join(base, 'claude-501')
    tasks = join(root, 'project', 'session', 'tasks')
    mkdirSync(tasks, { recursive: true })
    events = []
    commands = new ClaudeBackgroundCommands(
      async (event) => {
        events.push(event)
      },
      Promise.resolve([root]),
      10,
    )
    commands.turnId = 'turn-1'
  })
  afterEach(() => {
    commands.stop()
    rmSync(base, { recursive: true, force: true })
  })

  const notification = (toolUseId: string, summary: string, status = 'completed') => ({
    sessionId: 's',
    message: { type: 'system', subtype: 'task_notification', tool_use_id: toolUseId, status, summary },
  })
  const output = () =>
    events.flatMap((event) => (event.type === 'tool' && event.tool.output != null ? [event.tool] : []))

  it('copies output onto the card as it is written, then settles it on the launch turn', async () => {
    const path = join(tasks, 'task1.output')
    writeFileSync(path, 'first\n')
    commands.launched('call-1', { taskId: 'task1', outputPath: path })
    // A turn ending must not move the card: the exit lands where the launch did.
    commands.turnId = null
    await vi.waitFor(() => expect(output()).toHaveLength(1))
    appendFileSync(path, 'second\n')
    await vi.waitFor(() => expect(output()).toHaveLength(2))
    appendFileSync(path, 'done\n')
    await commands.notified(notification('call-1', 'Background command "x" completed (exit code 0)'))
    expect(events).toEqual([
      {
        type: 'tool',
        tool: { id: 'call-1', title: '', kind: 'execute', output: 'first\n', outputAppend: true },
        acornTurnId: 'turn-1',
      },
      {
        type: 'tool',
        tool: { id: 'call-1', title: '', kind: 'execute', output: 'second\n', outputAppend: true },
        acornTurnId: 'turn-1',
      },
      {
        type: 'tool',
        tool: { id: 'call-1', title: '', kind: 'execute', output: 'done\n', outputAppend: true },
        acornTurnId: 'turn-1',
      },
      {
        type: 'tool',
        tool: { id: 'call-1', title: '', kind: 'execute', background: true, status: 'completed', exitCode: 0 },
        acornTurnId: 'turn-1',
      },
    ])
  })

  it("reads nothing from a path outside Claude's folder, and still settles the card", async () => {
    const outside = join(base, 'elsewhere', 'tasks')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'task2.output'), 'secret\n')
    commands.launched('call-2', { taskId: 'task2', outputPath: join(outside, 'task2.output') })
    await new Promise((resolve) => setTimeout(resolve, 50))
    await commands.notified(notification('call-2', 'Background command "x" failed with exit code 1', 'failed'))
    expect(events).toEqual([
      {
        type: 'tool',
        tool: { id: 'call-2', title: '', kind: 'execute', background: true, status: 'failed', exitCode: 1 },
        acornTurnId: 'turn-1',
      },
    ])
  })

  it('ignores a notification for something it did not launch, such as a background subagent', async () => {
    await commands.notified(notification('agent-call', 'Agent "x" completed'))
    expect(events).toEqual([])
  })

  it('keeps the newest part of output larger than the card holds, and says it was cut', async () => {
    const path = join(tasks, 'task3.output')
    writeFileSync(path, `${'old line\n'.repeat(10_000)}last line\n`)
    commands.launched('call-3', { taskId: 'task3', outputPath: path })
    await vi.waitFor(() => expect(output()).toHaveLength(1))
    const [shown] = output()
    expect(shown.outputAppend).toBeUndefined()
    expect(shown.output).toMatch(/^\[Earlier output was cut\. This shows the newest part\.\]\nold line\n/)
    expect(shown.output?.endsWith('last line\n')).toBe(true)
    expect(Buffer.byteLength(shown.output ?? '')).toBeLessThanOrEqual(BACKGROUND_OUTPUT_CAP)
  })
})
