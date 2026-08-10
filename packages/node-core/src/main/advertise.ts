import { networkInterfaces } from 'node:os'
import { createInterface } from 'node:readline/promises'
import type { DataRoot } from './dataRoot'

// Which hosts this node answers to besides loopback, and how the operator decides.
//
// Binding beyond 127.0.0.1 puts a service that runs PTYs, spawns agents and executes repo-configured
// commands onto a network. That is a decision, not a lookup, so nothing here infers it: a node
// advertises an address because someone said so, either by answering the first-boot question or by
// setting ACORN_ADVERTISE_HOST. A machine with three interfaces and a VPN has no "obvious" answer to
// guess at, and guessing wrong fails as a bare 403 from the Host guard (main/server.ts) with nothing
// to debug against.

const ENV_VAR = 'ACORN_ADVERTISE_HOST'

export type LanCandidate = { address: string; iface: string }

// Every non-internal IPv4 this machine currently has. IPv6 is omitted deliberately: the value ends up
// in a URL the operator types and in a Host header comparison, and bracketed v6 literals are a worse
// first experience than the v4 address that every one of these machines also has.
export function lanCandidates(): LanCandidate[] {
  const found: LanCandidate[] = []
  for (const [iface, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) found.push({ address: info.address, iface })
    }
  }
  return found
}

// The hosts to accept in a Host header, loopback aside. Env beats the recorded answer so a service
// manager or a container can set it without touching the data root — and so an operator who has
// answered "none" can still override for one run without editing node.json.
export function advertisedHosts(root: Pick<DataRoot, 'advertiseHost'>): string[] {
  const raw = process.env[ENV_VAR]?.trim() || root.advertiseHost || ''
  // Comma-separated because a machine reached by both an IP and a hostname is a real case and the
  // alternative is two settings that must agree.
  return raw.split(',').map((host) => host.trim()).filter(Boolean)
}

// Ask once, on first boot, when there is someone at a terminal to answer.
//
// Returns without asking when: the operator has already answered (including "none" — '' is a recorded
// answer, which is what keeps this from reappearing every boot), the env var has decided it, there is
// no TTY (launchd, systemd, Docker, the e2e harness), or this machine has no network address to offer.
// The last case deliberately does not record: a laptop booted off the network should still get asked
// once it is plugged in.
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

    // Enter means "none". Exposing this service is one deliberate keystroke away, never the thing that
    // happens because someone held down return through an installer.
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
