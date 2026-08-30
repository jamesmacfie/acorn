import { describe, expect, it } from 'vitest'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import type { NodeProvidersResponse, ProvidedNode } from '@acorn/protocol/nodeProviders.ts'
import type { FleetResult, FleetRow } from './fanout'
import { creatableProviders, hasNodeProviders, mergeProvidedNodes, providerFailures } from './providedNodes'

// The fleet merge (docs/plugins.md § Node providers). Pure functions over a fan-out result, so they can
// be tested in this suite's node environment — `createFleetQuery` itself cannot run here, the same
// split `fanout.test.ts` already lives with.
//
// The behaviour worth pinning is the dedupe. Two nodes signed into one cloud account list the same
// machines, and `providerNodeId` is the control plane's id precisely so the client can tell that they
// are the same machine rather than showing it twice.

const node = (nodeId: string, extra: Partial<NodeRecord> = {}): NodeRecord => ({
  nodeId,
  label: nodeId,
  endpoint: `https://${nodeId}.example`,
  local: false,
  ...extra,
})

const provided = (providerNodeId: string, extra: Partial<ProvidedNode> = {}): ProvidedNode => ({
  providerNodeId,
  nodeId: null,
  label: providerNodeId,
  endpoint: null,
  fingerprint: null,
  state: 'ready',
  ...extra,
})

const answer = (nodeId: string, data: NodeProvidersResponse): FleetRow<NodeProvidersResponse> => ({
  nodeId,
  node: node(nodeId),
  data,
  freshness: 'live',
})

const result = (...rows: FleetRow<NodeProvidersResponse>[]): FleetResult<NodeProvidersResponse> => ({ rows, unavailable: [] })

const cloud = { id: 'cloud:machines', label: 'Acme Cloud', verbs: ['create', 'destroy', 'start', 'stop'] as const }

describe('mergeProvidedNodes', () => {
  it('unions what every node answered, carrying which node listed each row', () => {
    const merged = mergeProvidedNodes(
      result(
        answer('node-a', { providers: [{ ...cloud, verbs: [...cloud.verbs] }], nodes: [{ ...provided('m-1'), providerId: cloud.id }], failures: [] }),
        answer('node-b', { providers: [{ id: 'file:file', label: 'From a file', verbs: [] }], nodes: [{ ...provided('f-1'), providerId: 'file:file' }], failures: [] }),
      ),
      [],
    )
    expect(merged.map((row) => [row.providerNodeId, row.sourceNodeId, row.providerLabel])).toEqual([
      ['m-1', 'node-a', 'Acme Cloud'],
      ['f-1', 'node-b', 'From a file'],
    ])
    // The verbs travel with the provider that listed the row, so a UI never offers a button the
    // provider behind that particular row did not declare.
    expect(merged[0]!.verbs).toEqual(['create', 'destroy', 'start', 'stop'])
    expect(merged[1]!.verbs).toEqual([])
  })

  it('shows one row when two nodes list the same machine, and asks the first one', () => {
    const both = { providers: [{ ...cloud, verbs: [...cloud.verbs] }], nodes: [{ ...provided('m-1'), providerId: cloud.id }], failures: [] }
    const merged = mergeProvidedNodes(result(answer('node-a', both), answer('node-b', both)), [])
    expect(merged).toHaveLength(1)
    // Fleet order, not completion order: the row does not reshuffle when the other node answers faster,
    // and the verbs go to a stable target.
    expect(merged[0]!.sourceNodeId).toBe('node-a')
  })

  it('does not confuse two providers that use the same node id', () => {
    const merged = mergeProvidedNodes(
      result(answer('node-a', {
        providers: [{ ...cloud, verbs: [] }, { id: 'file:file', label: 'From a file', verbs: [] }],
        nodes: [{ ...provided('m-1'), providerId: cloud.id }, { ...provided('m-1'), providerId: 'file:file' }],
        failures: [],
      })),
      [],
    )
    // Deduped on the pair, not on `providerNodeId` alone: two control planes number their nodes
    // independently and both may say `m-1`.
    expect(merged).toHaveLength(2)
  })

  it('marks a row already in this fleet, by provenance and by node id', () => {
    const rows = [
      { ...provided('m-1'), providerId: cloud.id },
      { ...provided('m-2', { nodeId: 'node-z' }), providerId: cloud.id },
      { ...provided('m-3'), providerId: cloud.id },
    ]
    const merged = mergeProvidedNodes(
      result(answer('node-a', { providers: [{ ...cloud, verbs: [] }], nodes: rows, failures: [] })),
      [
        // Adopted through the provider: matched on provenance, which works even for a node with no
        // acorn id yet.
        node('node-y', { provider: { providerId: cloud.id, providerNodeId: 'm-1', sourceNodeId: 'node-a' } }),
        // Paired by hand, and the provider happens to list it: matched on the acorn id.
        node('node-z'),
      ],
    )
    expect(merged.map((row) => row.adoptedAs)).toEqual(['node-y', 'node-z', null])
  })
})

describe('the provider summaries a fleet surface draws from', () => {
  it('offers one create target per provider, deduped across the nodes that report it', () => {
    const withCreate = { providers: [{ ...cloud, verbs: [...cloud.verbs] }], nodes: [], failures: [] }
    const noCreate = { providers: [{ id: 'file:file', label: 'From a file', verbs: [] }], nodes: [], failures: [] }
    const targets = creatableProviders(result(answer('node-a', withCreate), answer('node-b', withCreate), answer('node-c', noCreate)))
    expect(targets.map((target) => [target.id, target.sourceNodeId])).toEqual([[cloud.id, 'node-a']])
  })

  it('reports a provider that could not answer, and stays hidden when there is no provider at all', () => {
    const failing = result(answer('node-a', { providers: [{ ...cloud, verbs: [] }], nodes: [], failures: [{ providerId: cloud.id, reason: 'timed out' }] }))
    expect(providerFailures(failing)).toEqual([{ providerId: cloud.id, reason: 'timed out' }])
    expect(hasNodeProviders(failing)).toBe(true)
    // An install with no cloud plugin: every node answers an empty list, and the whole section is
    // hidden rather than drawn empty.
    expect(hasNodeProviders(result(answer('node-a', { providers: [], nodes: [], failures: [] })))).toBe(false)
  })
})
