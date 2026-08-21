import { networkInterfaces } from 'node:os'
import { createInterface } from 'node:readline/promises'
import type { DataRoot } from './dataRoot'

// Which hosts this node answers to besides loopback, and how the operator decides
// (docs/node-distribution.md § Reaching a node from another machine).

const ENV_VAR = 'ACORN_ADVERTISE_HOST'

export type LanCandidate = { address: string; iface: string }

// Every non-internal IPv4 this machine currently has (docs/node-distribution.md § Reaching a node
// from another machine, on why IPv6 is left out).
export function lanCandidates(): LanCandidate[] {
  const found: LanCandidate[] = []
  for (const [iface, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) found.push({ address: info.address, iface })
    }
  }
  return found
}

// The hosts to accept in a Host header, loopback aside (docs/node-distribution.md § Reaching a node
// from another machine).
export function advertisedHosts(root: Pick<DataRoot, 'advertiseHost'>): string[] {
  const raw = process.env[ENV_VAR]?.trim() || root.advertiseHost || ''
  return raw.split(',').map((host) => host.trim()).filter(Boolean)
}

// Ask once, on first boot, when there is someone at a terminal to answer
// (docs/node-distribution.md § Reaching a node from another machine).
export async function confirmAdvertiseHost(root: Pick<DataRoot, 'advertiseHost' | 'recordAdvertiseHost'>): Promise<void> {
  if (root.advertiseHost !== undefined) return
  if (process.env[ENV_VAR]?.trim()) return
  if (!process.stdin.isTTY || !process.stdout.isTTY) return

  const candidates = lanCandidates()
  if (candidates.length === 0) return

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    process.stdout.write('\nThis node is reachable from this machine only. Which address should it advertise\nso acorn on another machine can connect to it?\n\n')
    candidates.forEach((candidate, index) => {
      process.stdout.write(`  ${index + 1}) ${candidate.address.padEnd(18)}${candidate.iface}\n`)
    })
    process.stdout.write('  n) none — keep this node private to this machine\n\n')

    // Enter means "none" (docs/node-distribution.md § Reaching a node from another machine).
    const answer = (await rl.question('Choice [n]: ')).trim()
    const picked = Number.parseInt(answer, 10)
    const chosen = Number.isInteger(picked) && picked >= 1 && picked <= candidates.length ? candidates[picked - 1]!.address : ''
    root.recordAdvertiseHost(chosen)
    process.stdout.write(
      chosen
        ? `\nAdvertising ${chosen}. Change it later by editing advertiseHost in the data root's node.json.\n`
        : '\nKeeping this node private to this machine.\n',
    )
  } finally {
    rl.close()
  }
}
