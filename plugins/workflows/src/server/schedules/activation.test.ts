import { describe, expect, it, vi } from 'vitest'
import { registerWorkflowTriggers } from './activation'
import type { WorkflowRunner } from '../runs/runner'

type Listener = () => void

function fakeContext(codeHosts: string[], refuses: string[] = []) {
  const listeners = new Map<string, Set<Listener>>()
  const fire = (channel: string) => listeners.get(channel)?.forEach((listener) => listener())
  const ctx = {
    core: { codeHosts: () => codeHosts },
    events: {
      on: (channel: string, listener: Listener) => {
        if (refuses.some((id) => channel === `plugin:${id}:checks-changed`))
          throw new Error(`plugin does not declare 'checks-changed'`)
        const set = listeners.get(channel) ?? new Set()
        listeners.set(channel, set.add(listener))
        return { dispose: () => set.delete(listener) }
      },
    },
    schedules: { register: vi.fn() },
    log: { warn: vi.fn() },
  }
  return { ctx: ctx as unknown as Parameters<typeof registerWorkflowTriggers>[0], fire }
}

describe('registerWorkflowTriggers', () => {
  it("sweeps early on each running code host's checks-changed, and follows hosts that start or stop", async () => {
    const hosts = ['github', 'quiet']
    const { ctx, fire } = fakeContext(hosts, ['quiet'])
    const pollTriggers = vi.fn(async () => ({ started: 0, errors: [] }))
    registerWorkflowTriggers(ctx, { pollTriggers } as unknown as WorkflowRunner)

    fire('plugin:github:checks-changed')
    expect(pollTriggers).toHaveBeenCalledTimes(1)

    // GitLab starts and GitHub stops after this plugin.
    hosts.splice(0, hosts.length, 'gitlab-test', 'quiet')
    fire('plugins:changed')
    fire('plugin:github:checks-changed')
    expect(pollTriggers).toHaveBeenCalledTimes(1)
    fire('plugin:gitlab-test:checks-changed')
    expect(pollTriggers).toHaveBeenCalledTimes(2)

    // A second roster change doesn't subscribe the same host twice.
    fire('plugins:changed')
    fire('plugin:gitlab-test:checks-changed')
    expect(pollTriggers).toHaveBeenCalledTimes(3)
  })
})
