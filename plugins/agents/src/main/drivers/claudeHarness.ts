// Claude Code as a launch spec, which is the whole of what used to be `claudeDriver.ts`.
//
// It is the first tier-1 harness and the proof that the generic driver is real: everything the old
// driver did beyond describing the spawn — the ACP connection, the normalizer, the session lifecycle —
// was never Claude's, and this file is what was left once that was taken away.
//
// `id` is `claude` and `profileId` is `claude-code`. They differ only because both were minted before
// this seam existed and both are persisted: the first on every session row, the second on session rows
// and workflow steps alike (docs/managed-agents.md § Harnesses).
import { createRequire } from 'node:module'
import { probeClaudeAuthentication } from './authProbe'
import type { HarnessLaunchSpec } from './harness'

const nodeRequire = createRequire(import.meta.url)

export const claudeHarness: HarnessLaunchSpec = {
  id: 'claude',
  profileId: 'claude-code',
  label: 'Claude Code',
  glyph: 'C',
  spawn: {
    // Resolved host-side, not from a plugin directory: the adapter is a dependency of the desktop
    // bundle (apps/desktop/package.json), so `createRequire` is the only thing that can find it. A
    // contributed harness shipping its own adapter gets the same `entry` form with its installed
    // package directory joined on instead.
    entry: () => nodeRequire.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js'),
    // The adapter drives the `claude` CLI and needs to be told where it is.
    requires: { command: 'claude', env: 'CLAUDE_CODE_EXECUTABLE' },
  },
  envPassthrough: ['CLAUDE_CODE_*'],
  // The CLI reloads a session from its own store, which is what `--resume` and the terminal handoff
  // both rely on. Compaction is the CLI's `/compact`, but it is not requested through ACP, so it stays
  // undeclared until the adapter carries it.
  quirks: { sessionPersistence: true },
  probeAuth: probeClaudeAuthentication,
}
