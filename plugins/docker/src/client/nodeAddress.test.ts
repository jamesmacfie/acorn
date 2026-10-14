import { describe, expect, it, vi } from 'vitest'
import type { DockerPort } from '../shared/model'

const nodes = vi.hoisted(() => [
  { nodeId: 'local', label: 'This Mac', endpoint: 'https://127.0.0.1:4318', local: true },
  { nodeId: 'remote', label: 'Container Node', endpoint: 'https://build.example.com:4317', local: false },
])
vi.mock('@acorn/plugin-api/client', () => ({ nodes: () => nodes, activeNodeId: () => 'remote' }))

import { portAddress, remoteNode } from './nodeAddress'

const port = (hostIp: string | null, hostPort: number | null = 8080): DockerPort => ({
  hostIp,
  hostPort,
  containerPort: 80,
  protocol: 'tcp',
})

describe('a published port seen from this client', () => {
  it('takes the host from a remote Node endpoint', () => {
    expect(portAddress(port('0.0.0.0'))).toEqual({ url: 'http://build.example.com:8080' })
    expect(portAddress(port(null))).toEqual({ url: 'http://build.example.com:8080' })
  })

  it('says a port on the remote Node loopback opens only there or through a tunnel', () => {
    for (const hostIp of ['127.0.0.1', '::1', 'localhost'])
      expect(portAddress(port(hostIp))).toEqual({
        url: 'http://localhost:8080',
        caveat: "It's only reachable on Container Node, or through an SSH tunnel to it.",
      })
  })

  it('keeps localhost for the local Node and has no address for an unpublished port', () => {
    expect(portAddress(port('127.0.0.1'), 'local')).toEqual({ url: 'http://localhost:8080' })
    expect(portAddress(port('0.0.0.0', null))).toBeNull()
    expect(remoteNode('local')).toBeUndefined()
    expect(remoteNode()?.label).toBe('Container Node')
  })
})
