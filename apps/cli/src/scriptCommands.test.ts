import { expect, it, vi } from 'vitest'
import { parseCliArgs } from './args'
import { runCommand, validateCommand } from './commands'
import { CliError } from './error'
import type { CliNode } from './node'
const snapshot = { taskId: 'task', phase: 'setup', generation: 2, attemptId: 'attempt', state: 'running', reason: 'process_started', terminalSessionId: 'session', requestedAt: 1, startedAt: 2, finishedAt: null, exitCode: null, outputAvailable: true, outputTruncated: false }
const args = (options: string[] = []) => parseCliArgs(['task', 'scripts', 'wait', 'task', '--phase', 'setup', ...options])
function node(get: CliNode['get']): CliNode { return { nodeId: 'node', endpoint: 'https://fixture', get, mutate: vi.fn(), close: vi.fn() } }
it('pins composed waits to the first attempt and returns inspectable checked failure and timeout resources', async () => {
  const get = vi.fn().mockResolvedValueOnce({ snapshot, matched: false, reason: 'timeout' }).mockResolvedValueOnce({ snapshot: { ...snapshot, state: 'failed', reason: 'nonzero_exit', exitCode: 1 }, matched: true, reason: 'settled' })
  await expect(runCommand(node(get), args(['--check']))).rejects.toMatchObject({ exitCode: 6, partial: { kind: 'TaskScriptWait', snapshot: { attemptId: 'attempt', exitCode: 1 } } })
  expect(get.mock.calls[1][0]).toContain('attemptId=attempt')
  await expect(runCommand(node(async () => ({ snapshot, matched: false, reason: 'timeout' })), args(['--timeout', '0']))).rejects.toMatchObject({ exitCode: 5, partial: { kind: 'TaskScriptWait' } })
})
it('accepts intentional skips for --check, returns not_started promptly, and confines omitted task IDs', async () => {
  const client = node(async () => ({ snapshot: { ...snapshot, state: 'skipped', reason: 'disabled' }, matched: true, reason: 'settled' }))
  expect(await runCommand(client, args(['--check']))).toMatchObject({ kind: 'TaskScriptWait', matched: true })
  await expect(runCommand(node(async () => ({ snapshot: { ...snapshot, attemptId: null, state: 'not_started', reason: 'not_requested' }, matched: false, reason: 'not_started' })), args(['--check']))).rejects.toMatchObject({ exitCode: 6 })
  client.taskId = 'task'
  expect(await runCommand(client, parseCliArgs(['task', 'scripts', 'wait', '--phase', 'setup']))).toMatchObject({ matched: true })
  await expect(runCommand(client, parseCliArgs(['task', 'scripts', 'wait', 'foreign', '--phase', 'setup']))).rejects.toMatchObject({ code: 'task_scope' })
  for (const argv of [['task', 'scripts', 'wait', 'task'], ['task', 'scripts', 'logs', 'task', '--phase', 'setup', '--tail', '1001']]) expect(() => validateCommand(parseCliArgs(argv))).toThrow(CliError)
})
it('Ctrl+C aborts only the local read and removes its signal handler', async () => {
  const before = process.listenerCount('SIGINT')
  const client = node((_path, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true })))
  const waiting = runCommand(client, args())
  await vi.waitFor(() => expect(process.listenerCount('SIGINT')).toBe(before + 1))
  process.emit('SIGINT')
  await expect(waiting).rejects.toMatchObject({ exitCode: 130 })
  expect(process.listenerCount('SIGINT')).toBe(before)
  expect(client.mutate).not.toHaveBeenCalled()
})
