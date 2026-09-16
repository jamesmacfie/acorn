import { MessageChannel, Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { PluginRpcEndpoint, rpcError } from './pluginRpc'
import { isProviderOperationError, ProviderOperationError } from '../integrations/types'

// A bundled plugin runs in an isolated worker, so every error it throws is torn down to a wire record
// and rebuilt on the host side as a plain Error. Only the fields named here survive, which makes this
// the list that decides whether the host can still tell one failure from another.
describe('plugin RPC error marshalling', () => {
  // Reconstruction, as pluginRpc does it on receipt. Kept here rather than exported, because the only
  // thing worth pinning is that a round trip leaves the host able to answer.
  const received = (error: unknown): Error => {
    const wire = rpcError(error)
    const rebuilt = new Error(wire.message)
    rebuilt.name = wire.name
    return Object.assign(rebuilt, {
      ...(wire.code === undefined ? {} : { code: wire.code }),
      ...(wire.status === undefined ? {} : { status: wire.status }),
    })
  }

  // The bug. `status` used to be dropped, so a provider error arrived with its code intact and no
  // status, stopped matching the shape the host checks, and a rejected credential was answered as
  // "the provider is unavailable".
  it('keeps a provider error recognisable after the trip out of the worker', () => {
    const thrown = new ProviderOperationError('provider_needs_auth', 401)
    const arrived = received(thrown)

    expect(arrived).not.toBeInstanceOf(ProviderOperationError)
    expect(isProviderOperationError(arrived)).toBe(true)
    expect(isProviderOperationError(arrived) && arrived.status).toBe(401)
    expect(isProviderOperationError(arrived) && arrived.code).toBe('provider_needs_auth')
  })

  it('defaults the status the same way the constructor does', () => {
    const arrived = received(new ProviderOperationError('provider_unavailable'))
    expect(isProviderOperationError(arrived) && arrived.status).toBe(502)
  })

  it('leaves an ordinary error alone', () => {
    const arrived = received(new TypeError('fetch failed'))
    expect(arrived.name).toBe('TypeError')
    expect(isProviderOperationError(arrived)).toBe(false)
  })
})

// A synchronous reference is answered while the peer is stopped dead in `Atomics.wait`, so anything
// that delays the reply stops a whole thread. On the host that thread runs the node: every route
// goes quiet and the broker stops getting heartbeats, which is why one wedged plugin used to read as
// the entire node being unreachable.
describe('plugin RPC synchronous replies', () => {
  it('answers while one of the plugin\'s own handlers is still waiting on the host', async () => {
    const { port1, port2 } = new MessageChannel()
    const worker = new Worker(new URL('./__fixtures__/rpcWorker.ts', import.meta.url), {
      workerData: { port: port2 },
      transferList: [port2],
    })
    const host = new PluginRpcEndpoint(port1, () => 'async')
    try {
      const plugin = host.decode(
        await new Promise((resolve) => port1.once('message', resolve)),
        'plugin',
      ) as { slow(wait: () => Promise<void>): Promise<string>; pure(): string; quick(): Promise<string> }

      // Park a handler inside the worker on a host call that cannot finish yet. That is the state
      // the deadlock needed: the worker owes the host an answer it can only give once the host runs
      // again, and the host is about to stop running.
      let waiting = false
      void plugin.slow(async () => {
        waiting = true
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      })
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(waiting).toBe(true)

      expect(plugin.pure()).toBe('pure')
    } finally {
      await worker.terminate()
    }
  })
})

// The same plugin, two unrelated routes. Calls used to run one at a time, so a route waiting on a
// slow provider stopped every other route on that plugin, and the fan-out's retries queued behind the
// request that had already timed out.
describe('plugin RPC concurrency', () => {
  it('answers a second call while the first is still waiting', async () => {
    const { port1, port2 } = new MessageChannel()
    const worker = new Worker(new URL('./__fixtures__/rpcWorker.ts', import.meta.url), {
      workerData: { port: port2 },
      transferList: [port2],
    })
    const host = new PluginRpcEndpoint(port1, () => 'async')
    try {
      const plugin = host.decode(
        await new Promise((resolve) => port1.once('message', resolve)),
        'plugin',
      ) as { slow(wait: () => Promise<void>): Promise<string>; quick(): Promise<string> }

      const order: string[] = []
      const slow = plugin.slow(() => new Promise((resolve) => setTimeout(resolve, 1_000))).then(() => order.push('slow'))
      await new Promise((resolve) => setTimeout(resolve, 100))
      await plugin.quick().then(() => order.push('quick'))
      await slow

      expect(order).toEqual(['quick', 'slow'])
    } finally {
      await worker.terminate()
    }
  })
})
