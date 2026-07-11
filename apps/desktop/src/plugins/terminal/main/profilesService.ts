import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { z } from 'zod'
import { agentProfileRegistry } from '../../../core/main/agentProfiles'
import type { TerminalProfileSchema } from '../../../core/shared/publicApi/terminal'

// Terminal profiles (docs/public-api.md). Availability depends on the profile's
// executable being installed; tmux-backed profiles also need tmux. Results are memoized — PATH does
// not change within an app run.

const exec = promisify(execFile)
type TerminalProfile = z.infer<typeof TerminalProfileSchema>

const onPath = new Map<string, Promise<boolean>>()
function commandExists(cmd: string): Promise<boolean> {
  let found = onPath.get(cmd)
  if (!found) {
    found = exec('which', [cmd])
      .then(() => true)
      .catch(() => false)
    onPath.set(cmd, found)
  }
  return found
}

export class TerminalProfilesService {
  async list(): Promise<TerminalProfile[]> {
    const tmuxOk = await commandExists('tmux')
    return Promise.all(
      agentProfileRegistry.list().map(async (p) => {
        const bin = p.command.trim().split(/\s+/)[0]
        const available = await commandExists(bin)
        const profile: TerminalProfile = { id: p.id, label: p.label, kind: p.kind, available }
        if (p.backendPreference === 'tmux') profile.tmuxMissing = !tmuxOk
        return profile
      }),
    )
  }
}
