import { execFileSync } from 'node:child_process'
import type { TerminalProfile } from '../shared/terminal'

// Built-in agent profiles (vNext §8). The user-editable `agent_profiles` table is a later
// enhancement — these cover shell + the common coding agents. `command` is the binary we look for
// on PATH (or $SHELL for the shell profile); we never install it.
export type ProfileDef = {
  id: string
  label: string
  kind: 'shell' | 'agent'
  command: string // '$SHELL' sentinel for the shell profile
  backendPreference: 'node-pty' | 'tmux'
  // vNext §12 Phase 5 seam. 'pty' is the universal transport (xterm ↔ PTY) and the only one
  // implemented. Structured transports (JSON-RPC / ACP-like / MCP-like / SDK-native) are
  // deliberately NOT built yet — no concrete agent targets one, so a runtime now would be
  // speculative dead code. When a real structured agent appears, add 'structured' here and branch
  // on it where the PTY is spawned in terminal.ts; PTY stays the fallback.
  transport: 'pty'
}

export const BUILTIN_PROFILES: ProfileDef[] = [
  { id: 'shell', label: 'Shell', kind: 'shell', command: '$SHELL', backendPreference: 'node-pty', transport: 'pty' },
  { id: 'claude-code', label: 'Claude Code', kind: 'agent', command: 'claude', backendPreference: 'tmux', transport: 'pty' },
  { id: 'codex', label: 'Codex', kind: 'agent', command: 'codex', backendPreference: 'tmux', transport: 'pty' },
  { id: 'aider', label: 'Aider', kind: 'agent', command: 'aider', backendPreference: 'tmux', transport: 'pty' },
]

export const getProfile = (id: string | undefined): ProfileDef => BUILTIN_PROFILES.find((p) => p.id === id) ?? BUILTIN_PROFILES[0]

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
  return BUILTIN_PROFILES.map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    available: profileAvailable(p),
    tmuxMissing: p.backendPreference === 'tmux' && !tmux ? true : undefined,
  }))
}
