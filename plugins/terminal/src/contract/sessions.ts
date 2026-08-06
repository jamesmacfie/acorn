// terminal.sessions — spawn a PTY session in a task's worktree and enumerate the live ones
// (docs/vNext/plugins.md § Cross-plugin collaboration).
//
// Part of the terminal plugin's CONTRACT: id and signature only, nothing executable.
//
// It exists for exactly one consumer, and only because that consumer became a plugin. plugins/agents'
// terminal handoff hands a provider session over to a real shell: it spawns a PTY running the
// provider's `resume` command and then, on the way back, asks whether that PTY is still running. Both
// halves used to live in apps/node/src/wiring/managedAgentsWiring.ts, which could reach into
// `terminalBridgeSlot` because an APP may import any plugin. Once the handoff moved into agents' own
// init that stopped being true, and the two remaining options were a non-contract import of another
// plugin's route module — a genuine coupling edge — or this.
//
// Two methods, not the TerminalBridge's eight. `kill`, `interrupt`, `remove`, `resize`, `profiles` and
// `sendToAgent` are the renderer's vocabulary and no plugin needs them; publishing them would invite a
// second consumer to start driving another plugin's PTYs. `sendToAgent` in particular is already its
// own capability (contract/sendToAgent.ts) precisely so the delivery primitive is separable from
// session control.
//
// Both types come from @acorn/protocol, so this file names nothing from the plugin's internals — the
// rule the contract-purity boundary test enforces.
import { capabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'
import type { CreateOpts, TerminalSession } from '@acorn/protocol/terminal.ts'

export type TerminalSessions = {
  // Spawns the PTY. The engine re-derives the cwd from `taskId` — creating the task's worktree if this
  // is its first use — so a caller supplies intent (task, profile, command, title) and never a path.
  create(opts: CreateOpts): Promise<TerminalSession>
  // Every session the engine currently knows about, running or exited. The handoff's return path reads
  // `status` and `agentSessionId` off these to refuse re-taking control while the shell is still live.
  list(): Promise<TerminalSession[]>
}

export const TERMINAL_SESSIONS = capabilityId<TerminalSessions>('terminal.sessions')
