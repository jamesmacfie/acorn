import { execFileSync } from 'node:child_process'
import type { TerminalProfile } from '../shared/terminal'
import { agentProfileRegistry, type AgentProfileContribution } from './agentProfiles'

// Built-in agent profiles (vNext §8). The user-editable `agent_profiles` table is a later
// enhancement — these cover shell + the common coding agents. `command` is the binary we look for
// on PATH (or $SHELL for the shell profile); we never install it.
export type ProfileDef = AgentProfileContribution
export const listProfileDefs = (): ProfileDef[] => agentProfileRegistry.list()

export const getProfile = (id: string | undefined): ProfileDef => agentProfileRegistry.get(id ?? 'shell') ?? agentProfileRegistry.require('shell')
export const requireProfile = (id: string): ProfileDef => agentProfileRegistry.require(id)

export const resolveCommand = (p: ProfileDef): string => (p.command === '$SHELL' ? process.env.SHELL || '/bin/zsh' : p.command)

// Is a command resolvable on PATH? macOS-only (vNext §15), so `which` is fine. ponytail: no cache —
// only called when the UI lists profiles / a session is created.
export function onPath(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export const tmuxAvailable = (): boolean => onPath('tmux')

// The shell profile is always available; agents only if their command is on PATH (vNext §8).
export const profileAvailable = (p: ProfileDef): boolean => (p.kind === 'shell' ? true : onPath(p.command))

// `tmuxMissing`: the profile prefers the durable tmux backend but tmux isn't on PATH, so sessions
// silently degrade to node-pty (resolveBackend) and won't survive an app restart — surfaced as a
// hint in the drawer's profile menu rather than hidden.
export const listProfiles = (): TerminalProfile[] => {
  const tmux = tmuxAvailable()
  return listProfileDefs().map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    available: profileAvailable(p),
    tmuxMissing: p.backendPreference === 'tmux' && !tmux ? true : undefined,
  }))
}
