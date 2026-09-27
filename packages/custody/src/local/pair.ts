import { hostname } from 'node:os'
import { createInterface } from 'node:readline/promises'
import { probeNode, pairWithNode } from '../broker/nodePairing'
import type { FleetNode, FleetStore } from '../broker/fleetStore'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'

export async function pairInteractively(endpoint: string, fleet: FleetStore, node: { label: string; local: boolean }): Promise<FleetNode> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('This node is not paired. Run acorn --node URL in a terminal to pair it.')
  const probe = await probeNode(endpoint)
  if (!probe.compatible) throw new Error(`${probe.endpoint} speaks acorn protocol ${probe.protocolVersion}; upgrade whichever side is older.`)
  const words = fingerprintPhrase(probe.fingerprint) ?? probe.fingerprint
  process.stderr.write(`\n  ${probe.endpoint}\n  Identity      ${words}\n\n  Compare these words with the node's boot output.\n`)
  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  const code = (await prompt.question('  Pairing code: ')).trim()
  prompt.close()
  if (!code) throw new Error('Nothing was paired.')
  const result = await pairWithNode(probe, { code, deviceName: `acorn on ${hostname()}` })
  return fleet.remember({
    nodeId: result.nodeId,
    label: node.label,
    endpoint: probe.endpoint,
    fingerprint: probe.fingerprint,
    certPem: probe.certPem,
    deviceId: result.device.id,
    local: node.local,
  }, result.deviceToken)
}
