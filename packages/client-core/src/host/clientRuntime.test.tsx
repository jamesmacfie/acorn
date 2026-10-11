import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'

// The shared start's own decisions: the plugin watcher waits for the host, schedules wait for the
// node, and one disposer stops everything. Each piece it starts has its own test.

const started: string[] = []
const stopped: string[] = []
const piece = (name: string) => () => {
  started.push(name)
  return () => void stopped.push(name)
}
const [ready, setReady] = createSignal(false)

vi.mock('../features/tasks/watchTaskChanges', () => ({ watchTaskChanges: piece('tasks') }))
vi.mock('../features/integrations/watchConnectionChanges', () => ({ watchConnectionChanges: piece('connections') }))
vi.mock('../features/projects/watchProjectChanges', () => ({ watchProjectChanges: piece('projects') }))
vi.mock('../features/workspaces/watchWorkspaceChanges', () => ({ watchWorkspaceChanges: piece('workspaces') }))
vi.mock('../infra/node/watchNodeEvents', () => ({ watchNodeEvents: piece('node events') }))
vi.mock('../features/notifications/deliver', () => ({
  initWorkflowNotices: piece('workflow notices'),
  initSystemNotices: piece('system notices'),
}))
vi.mock('./plugins/reload', () => ({ watchPluginChanges: piece('plugins') }))
vi.mock('./registries/shell/schedules', () => ({
  clientScheduleRegistry: { register: () => ({ dispose: () => void stopped.push('task status') }) },
  startClientSchedules: piece('schedules'),
}))
vi.mock('../infra/node/activeNode', () => ({ nodeReady: ready }))
vi.mock('../infra/persistence/deviceConfigSync', () => ({
  startDeviceConfigSync: async () => piece('device config')(),
}))
vi.mock('../infra/telemetry/emitter', () => ({ startClientTelemetry: () => void started.push('telemetry') }))
vi.mock('../infra/telemetry/post', () => ({ postTelemetryBatch: () => async () => {} }))

const { startClientRuntime } = await import('./clientRuntime')

describe('the shared client start', () => {
  it('waits for the host before watching plugins, for the node before scheduling, and stops it all', async () => {
    let pluginsReady!: () => void
    const stop = await startClientRuntime({
      runtime: 'tui',
      client: () => {
        throw new Error('unused')
      },
      pluginsReady: new Promise<void>((resolve) => {
        pluginsReady = resolve
      }),
    })
    expect(started).not.toContain('plugins')
    expect(started).not.toContain('schedules')

    pluginsReady()
    setReady(true)
    await vi.waitFor(() => expect(started).toContain('plugins'))
    expect(started).toContain('schedules')

    stop()
    expect(stopped.sort()).toEqual([...started.filter((name) => name !== 'telemetry'), 'task status'].sort())
  })
})
