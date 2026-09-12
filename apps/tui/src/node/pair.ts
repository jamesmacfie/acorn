import { hostname } from 'node:os'
import { createInterface } from 'node:readline/promises'
import { probeNode, pairWithNode } from '@acorn/custody/broker/nodePairing.ts'
import type { FleetNode, FleetStore } from '@acorn/custody/broker/fleetStore.ts'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'

// Pairing from a terminal: the desktop's three steps, drawn as three lines of text.
//
// It runs before the renderer starts, so it owns the terminal outright and asks with plain stdin.
// That is not a lesser version of the desktop's dialog — the whole point of step two is that a person
// reads six words off one screen and compares them with another, and a prompt is as good a place to
// read them as a modal (packages/custody/src/broker/nodePairing.ts says why each step exists).

/** Probe `endpoint`, show its identity for the owner to confirm, spend a pairing code, and remember
 *  the node. Throws with the reason on any of the three.
 *
 *  `local` is the caller's, because loopback is not the question: it means "the node this machine's
 *  data root holds", which is the one row `homeNode()` prefers and the one whose token is scoped by
 *  the store rather than by a nodeId (packages/custody/src/broker/fleetStore.ts). Pairing reaches it
 *  when a node the desktop started is running and this TUI has never held a token for it. */
export async function pairInteractively(endpoint: string, fleet: FleetStore, node: { label: string; local: boolean }): Promise<FleetNode> {
  const probe = await probeNode(endpoint)
  if (!probe.compatible) {
    throw new Error(`${probe.endpoint} speaks acorn protocol ${probe.protocolVersion}; this build speaks a different one. Upgrade whichever is older.`)
  }

  const words = fingerprintPhrase(probe.fingerprint) ?? probe.fingerprint
  console.log('')
  console.log(`  ${probe.endpoint}`)
  console.log(`  Identity      ${words}`)
  console.log('')
  console.log('  Check those words match what the node printed at its own boot. If they do not,')
  console.log('  something is intercepting this connection: press Enter with no code.')
  console.log('')

  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const code = (await prompt.question('  Pairing code: ')).trim()
  prompt.close()
  if (!code) throw new Error('Nothing was paired.')

  const result = await pairWithNode(probe, { code, deviceName: `acorn on ${hostname()}` })
  return fleet.remember(
    {
      nodeId: result.nodeId,
      label: node.label,
      endpoint: probe.endpoint,
      fingerprint: probe.fingerprint,
      certPem: probe.certPem,
      deviceId: result.device.id,
      local: node.local,
    },
    result.deviceToken,
  )
}
