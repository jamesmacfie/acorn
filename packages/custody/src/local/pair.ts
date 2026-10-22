import { hostname } from 'node:os'
import { createInterface } from 'node:readline/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { askToPair, collectPairing, PairingBusyError, probeNode, pairWithNode } from '../broker/nodePairing'
import { pairedNode, type FleetNode, type FleetStore } from '../broker/fleetStore'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { nodeAddress } from '@acorn/protocol/relay.ts'
import type { PairResult } from '@acorn/protocol/node.ts'

const COLLECT_EVERY_MS = 1_000

// `address` is a direct endpoint or a relay route, as a person types it.
export async function pairInteractively(
  address: string,
  fleet: FleetStore,
  node: { label: string; local: boolean; deviceName?: string },
): Promise<FleetNode> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('This Node is not paired. Run the same command in an interactive terminal to pair it.')
  const probe = await probeNode(address)
  if (!probe.compatible)
    throw new Error(
      `${nodeAddress(probe)} speaks acorn protocol ${probe.protocolVersion}; upgrade whichever side is older.`,
    )
  const deviceName = node.deviceName ?? `acorn on ${hostname()}`
  const words = fingerprintPhrase(probe.fingerprint) ?? probe.fingerprint
  process.stderr.write(
    `\n  ${nodeAddress(probe)}\n  Identity      ${words}\n\n  Compare these words with the node's boot output.\n`,
  )
  // The Node on this computer can ask a paired client to allow this one, so nobody has to copy a
  // code across (docs/api-reference/transport.md § Pairing by approval). The code prompt stays open
  // beside the wait, for a Node no paired client is watching.
  const ask = node.local
    ? await askToPair(probe, deviceName).catch((error: unknown) => {
        if (error instanceof PairingBusyError)
          process.stderr.write(`\n  ${error.message} Run acorn again, or type a pairing code.\n`)
        return null
      })
    : null
  if (ask)
    process.stderr.write(
      `\n  Allow this in Acorn on this computer. It shows: ${ask.phrase}\n  Or type a pairing code.\n`,
    )

  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  const done = new AbortController()
  const typed = prompt.question('  Pairing code: ', { signal: done.signal }).then((answer) => {
    const code = answer.trim()
    if (!code) throw new Error('Nothing was paired.')
    return pairWithNode(probe, { code, deviceName })
  })
  const allowed = ask ? waitForApproval(probe, ask.secret, done.signal) : new Promise<never>(() => {})
  // Whichever loses is aborted below, and its rejection is nobody's.
  typed.catch(() => {})
  allowed.catch(() => {})
  let result: PairResult
  try {
    result = await Promise.race([typed, allowed])
  } finally {
    done.abort()
    prompt.close()
  }
  return fleet.remember(pairedNode(probe, result, node), result.deviceToken)
}

// Resolves once the owner allows the ask. A denial or an expiry says so and then never resolves, so
// the code prompt beside it is still the way in.
async function waitForApproval(
  probe: Parameters<typeof collectPairing>[0],
  secret: string,
  signal: AbortSignal,
): Promise<PairResult> {
  for (;;) {
    let result: PairResult | null
    try {
      result = await collectPairing(probe, secret)
    } catch {
      if (signal.aborted) throw signal.reason
      process.stderr.write('\n  The request was denied or has expired. Type a pairing code instead.\n  Pairing code: ')
      return new Promise<never>(() => {})
    }
    if (result) {
      process.stderr.write('\n')
      return result
    }
    await sleep(COLLECT_EVERY_MS, undefined, { signal })
  }
}
