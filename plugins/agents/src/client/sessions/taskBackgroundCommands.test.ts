// A task's background command list and the output its tabs show, driven by the frames a client hears.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentBackgroundCommand, AgentEventRecord, AgentToolCall } from '../../contract/wire.ts'

const backgroundCommands = vi.fn<(taskId: string) => Promise<AgentBackgroundCommand[]>>()
const toolCall = vi.fn<(sessionId: string, toolId: string) => Promise<{ tool: AgentToolCall; seq: number }>>()
let frame: (value: unknown) => void = () => {}
let reconnect: () => void = () => {}
const roster: { id: string; taskId: string }[] = []

vi.mock('./managedClient', () => ({ managedAgentApi: { backgroundCommands, toolCall } }))
vi.mock('./managedStore', () => ({
  managedAgentStore: { captureRead: () => ({ current: () => true }), sessions: () => roster },
}))
vi.mock('./wsChannel', () => ({
  wsOnAgentFrame: (callback: (value: unknown) => void) => {
    frame = callback
    return () => {}
  },
}))
vi.mock('@acorn/plugin-api/client', () => ({
  wsOnReconnect: (callback: () => void) => {
    reconnect = callback
    return () => {}
  },
  onScopeEvicted: () => () => {},
}))

const { activateBackgroundCommands, backgroundCommandsFor, backgroundCommandTabs } =
  await import('./taskBackgroundCommands')

const row = (sessionId: string, toolCallId: string, title = toolCallId): AgentBackgroundCommand => ({
  sessionId,
  turnId: 'turn-1',
  toolCallId,
  title,
  startedAt: 1,
})
let seq = 0
const toolFrame = (sessionId: string, tool: Partial<AgentToolCall> & { id: string }, at = ++seq) =>
  frame({
    channel: 'agent:event',
    event: {
      id: `event-${at}`,
      sessionId,
      turnId: 'turn-1',
      seq: at,
      schemaVersion: 1,
      createdAt: at,
      event: { type: 'tool', tool: { title: '', kind: 'execute', ...tool } },
    } satisfies AgentEventRecord,
  })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const ids = (taskId: string) => backgroundCommandsFor(taskId).commands.map((command) => command.tabId)

let stop: () => void
beforeEach(() => {
  stop = activateBackgroundCommands()
})
afterEach(() => {
  stop()
  backgroundCommands.mockReset()
  toolCall.mockReset()
  roster.length = 0
})

describe("a task's background commands", () => {
  it('reads the task once, reads again at a launch or a reconnect, and drops a command when it settles', async () => {
    roster.push({ id: 's1', taskId: 'task-a' })
    backgroundCommands.mockResolvedValue([row('s1', 'dev')])
    expect(backgroundCommandsFor('task-a').loaded).toBe(false)
    await flush()
    expect(backgroundCommandsFor('task-a').loaded).toBe(true)
    expect(ids('task-a')).toEqual(['background:s1:turn-1:dev'])

    // Output is not a launch, so it reads nothing.
    toolFrame('s1', { id: 'dev', output: 'ready\n', outputAppend: true })
    expect(backgroundCommands).toHaveBeenCalledTimes(1)

    // Codex marks a command as background with no status.
    backgroundCommands.mockResolvedValue([row('s1', 'dev'), row('s1', 'tests')])
    toolFrame('s1', { id: 'tests', background: true })
    await flush()
    expect(ids('task-a')).toEqual(['background:s1:turn-1:dev', 'background:s1:turn-1:tests'])

    toolFrame('s1', { id: 'dev', status: 'completed', exitCode: 0 })
    expect(ids('task-a')).toEqual(['background:s1:turn-1:tests'])

    backgroundCommands.mockClear()
    reconnect()
    expect(backgroundCommands).toHaveBeenCalledWith('task-a', expect.anything())
  })

  it("doesn't bring back a command that settled while a read was out", async () => {
    roster.push({ id: 's2', taskId: 'task-b' })
    let answer: (rows: AgentBackgroundCommand[]) => void = () => {}
    backgroundCommands.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    backgroundCommandsFor('task-b')

    toolFrame('s2', { id: 'server', status: 'unknown' })
    answer([row('s2', 'server')])
    await flush()
    expect(backgroundCommandsFor('task-b')).toEqual({ loaded: true, commands: [] })
  })
})

describe("a background command's tab", () => {
  it("writes the card's output, then what changes, and nothing its first read already had", async () => {
    backgroundCommands.mockResolvedValue([row('s3', 'build', 'pnpm build')])
    backgroundCommandsFor('task-c')
    await flush()
    const [tab] = backgroundCommandTabs.tabs('task-c').tabs
    expect(tab).toMatchObject({ id: 'background:s3:turn-1:build', title: 'pnpm build' })

    let read: (value: { tool: AgentToolCall; seq: number }) => void = () => {}
    toolCall.mockReturnValue(new Promise((resolve) => (read = resolve)))
    const written: string[] = []
    const close = tab.io.open({ cols: 80, rows: 24 }, (event) => {
      if (event.kind === 'out') written.push(event.data)
    })
    expect(toolCall).toHaveBeenCalledWith('s3', 'build', expect.anything())

    // Both arrive while the read is out. The read folded the first, and not the second.
    toolFrame('s3', { id: 'build', output: 'two\n', outputAppend: true }, 50)
    toolFrame('s3', { id: 'build', output: 'three\n', outputAppend: true }, 52)
    read({ tool: { id: 'build', title: 'pnpm build', output: 'one\ntwo\n' }, seq: 51 })
    await flush()
    expect(written).toEqual(['one\r\ntwo\r\n', 'three\r\n'])

    // Past the cap the card's output is replaced, so the view starts over.
    toolFrame('s3', { id: 'build', output: '[cut]\nfour\n' }, 53)
    expect(written.at(-1)).toBe('\x1bc[cut]\r\nfour\r\n')

    // Typing goes nowhere, and a closed view hears nothing more.
    tab.io.input('rm -rf /\r')
    close()
    toolFrame('s3', { id: 'build', output: 'five\n', outputAppend: true }, 54)
    expect(written).toHaveLength(3)
  })
})
