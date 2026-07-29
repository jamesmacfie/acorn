import { describe, expect, it } from 'vitest'
import {
  SERVICE_PROTOCOL_VERSION,
  ServiceRpcError,
  ServiceRpcPeer,
  type ServiceMessage,
  type ServiceMessageTransport,
} from './serviceProtocol'

function pair(): [ServiceMessageTransport, ServiceMessageTransport] {
  const left = new Set<(message: unknown) => void>()
  const right = new Set<(message: unknown) => void>()
  return [
    {
      send: (message) => queueMicrotask(() => right.forEach((listener) => listener(message))),
      subscribe: (listener) => {
        left.add(listener)
        return () => void left.delete(listener)
      },
    },
    {
      send: (message) => queueMicrotask(() => left.forEach((listener) => listener(message))),
      subscribe: (listener) => {
        right.add(listener)
        return () => void right.delete(listener)
      },
    },
  ]
}

describe('service process RPC', () => {
  it('supports concurrent bidirectional requests', async () => {
    const [mainTransport, serviceTransport] = pair()
    const main = new ServiceRpcPeer(mainTransport)
    const service = new ServiceRpcPeer(serviceTransport)
    main.register('desktop.preview-current-url', (payload) => {
      const taskId = (payload as { taskId: unknown }).taskId
      return `https://${String(taskId)}.test`
    })
    service.register('service.preview-rules', async (payload) => {
      const taskId = (payload as { taskId: unknown }).taskId
      return [
        { id: String(taskId), enabled: true, urlPattern: '*', trigger: 'load', action: { type: 'fill', selector: '#q', value: 'x' } },
      ]
    })

    await expect(service.request('desktop.preview-current-url', { taskId: 'task-1' })).resolves.toBe('https://task-1.test')
    await expect(main.request<unknown[]>('service.preview-rules', { taskId: 'task-1' })).resolves.toHaveLength(1)
    main.close()
    service.close()
  })

  it('rejects pending requests when the peer closes', async () => {
    const [mainTransport] = pair()
    const main = new ServiceRpcPeer(mainTransport)
    const pending = main.request('service.stop', {}, 10_000)
    main.close('process exited')
    await expect(pending).rejects.toMatchObject({ code: 'service_closed' })
  })

  it('ignores messages from another protocol version', async () => {
    let listener: ((message: unknown) => void) | undefined
    const sent: ServiceMessage[] = []
    const peer = new ServiceRpcPeer({
      send: (message) => sent.push(message),
      subscribe: (next) => ((listener = next), () => undefined),
    })
    listener?.({ protocol: SERVICE_PROTOCOL_VERSION + 1, kind: 'request', id: 'bad', method: 'service.stop', payload: {} })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sent).toEqual([])
    peer.close()
  })

  it('returns a stable unavailable error for unknown handlers', async () => {
    const [mainTransport, serviceTransport] = pair()
    const main = new ServiceRpcPeer(mainTransport)
    const service = new ServiceRpcPeer(serviceTransport)
    const error = await service.request('desktop.preview-evict', { taskId: 't' }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ServiceRpcError)
    expect(error).toMatchObject({ code: 'method_unavailable' })
    main.close()
    service.close()
  })
})
