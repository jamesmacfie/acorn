// Claude Code as a launch spec. The generic driver owns everything past the spawn: the ACP connection,
// the normalizer, the session lifecycle.
//
// `id` is `claude` and `profileId` is `claude-code`. Both names predate this seam and both are
// persisted, the first on every session row, the second on session rows and workflow steps
// (docs/managed-agents.md § Harnesses).
import { createRequire } from 'node:module'
import { probeClaudeAuthentication } from './authProbe'
import type { HarnessLaunchSpec } from './harness'

const nodeRequire = createRequire(import.meta.url)

export const claudeHarness: HarnessLaunchSpec = {
  id: 'claude',
  profileId: 'claude-code',
  label: 'Claude Code',
  glyph: 'brand:agents/claude',
  spawn: {
    // Resolved host-side, not from a plugin directory. The adapter is a dependency of the desktop
    // bundle (apps/desktop/package.json), so only `createRequire` can find it. A contributed harness
    // uses the same `entry` form with its installed package directory joined on.
    entry: () => nodeRequire.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js'),
    // The adapter drives the `claude` CLI and needs to be told where it is.
    requires: { command: 'claude', env: 'CLAUDE_CODE_EXECUTABLE' },
  },
  envPassthrough: ['CLAUDE_CODE_*'],
  // The CLI reloads a session from its own store, which `--resume` and the terminal handoff both rely
  // on. Compaction is the CLI's `/compact`, but ACP cannot request it, so it stays undeclared until
  // the adapter carries it.
  quirks: { sessionPersistence: true },
  probeAuth: probeClaudeAuthentication,
}
