import { execFileSync } from 'node:child_process'
import type { TerminalProfile } from '@acorn/protocol/terminal.ts'
import { agentProfileRegistry, type AgentProfileContribution } from './agentProfiles'

// Built-in agent profiles (docs/terminal-and-agents.md), covering shell plus the common coding
// agents. `command` is the binary we look for on PATH, or $SHELL for the shell profile. We never
// install it.
export type ProfileDef = AgentProfileContribution
export const listProfileDefs = (): ProfileDef[] => agentProfileRegistry.list()

export const getProfile = (id: string | undefined): ProfileDef => agentProfileRegistry.get(id ?? 'shell') ?? agentProfileRegistry.require('shell')
export const requireProfile = (id: string): ProfileDef => agentProfileRegistry.require(id)

export const resolveCommand = (p: ProfileDef): string => (p.command === '$SHELL' ? process.env.SHELL || '/bin/zsh' : p.command)

export function onPath(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export const tmuxAvailable = (): boolean => onPath('tmux')

// The shell profile is always available; agents only if their command is on PATH (docs/terminal-and-agents.md).
export const profileAvailable = (p: ProfileDef): boolean => (p.kind === 'shell' ? true : onPath(p.command))

// A profile that cannot be opened interactively is not a terminal, whatever else it can do. One that
// only answers a single prompt reaches the Generate lists through `aiArgv` instead
// (./modelProviders/harnessRuntime.ts), so leaving it out here costs it nothing and spares whoever
// picked it a command that exits with a usage error.
export const interactiveProfile = (p: ProfileDef): boolean => p.interactive !== false

// `tmuxMissing` means the profile prefers the durable tmux backend but tmux is not on PATH, so
// sessions degrade to node-pty and do not survive an app restart. The profile menu shows it as a
// hint.
export const listProfiles = (): TerminalProfile[] => {
  const tmux = tmuxAvailable()
  return listProfileDefs().filter(interactiveProfile).map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    available: profileAvailable(p),
    tmuxMissing: p.backendPreference === 'tmux' && !tmux ? true : undefined,
  }))
}
