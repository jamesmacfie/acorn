import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { agentProfileRegistry } from '@acorn/node-core/main/agentProfiles/index.ts'
import { agentToolContributions } from '@acorn/node-core/server/agentTools/registry.ts'
import { configTrustBridgeSlot } from '@acorn/node-core/server/routes/configTrust.ts'
import { makeTestDb } from '@acorn/node-core/server/routes/testDb.ts'
import { wireAgentTools } from '../../src/wiring/agentToolsWiring'
import { wireConfigTrust } from '../../src/wiring/configTrustWiring'

// Phase 4 exit criterion: "a remote task's terminal/agent/preview work end-to-end over the LAN". A remote
// node boots from `src/server/standalone.ts`, and three app-layer wirings the SUPERVISED root does were
// simply absent there — no error, just a node that answers with less than the local one:
//
//   - no claude/codex/aider profiles, so launching an agent had nothing to launch;
//   - none of core's own six agent tools, so an agent saw a smaller MCP surface depending on how its node
//     was started;
//   - no config-trust bridge, so `/v2/core/tasks/:id/config-trust` answered 503 and a remote task could
//     never acknowledge its repo config — leaving every gated workflow on that node unusable.
//
// This is the same class of divergence Phase 3 found on this exact path with the `issues` context section,
// which is why it gets a file rather than a comment.
//
// Two halves, and both are needed. The behavioural half proves each wiring actually populates what it
// claims; the SOURCE half proves the standalone entry performs them, which no import of that module can
// check — it is a top-level script that opens a data root and binds a listener, so importing it in a unit
// test would start a node.

const HERE = dirname(fileURLToPath(import.meta.url))
const standalone = readFileSync(join(HERE, '../../src/server/standalone.ts'), 'utf8')
const runtime = readFileSync(join(HERE, '../../src/service/runtime.ts'), 'utf8')

describe('the standalone entry performs the same app-layer wirings as the supervised one', () => {
  it.each([
    ["../wiring/agentProfiles'", 'agent profiles (claude, codex, aider)'],
    ['wireAgentTools(', "core's own agent tools"],
    ['wireConfigTrust(', 'the config-trust bridge'],
  ])('names %s — %s', (needle) => {
    // Asserted against BOTH roots, so the check is "the two agree" rather than a list this file invents.
    // If the supervised root ever stops doing one of these, this fails and asks for a decision instead of
    // silently ratcheting the standalone entry down to match.
    expect(runtime).toContain(needle)
    expect(standalone).toContain(needle)
  })
})

describe('what each wiring populates', () => {
  it('registers the three built-in agent profiles beside core\'s shell', async () => {
    // A plain import, because that module IS the registration (apps/node/src/wiring/agentProfiles.ts is a
    // module body, deliberately, so a composition root joins by importing it).
    await import('../../src/wiring/agentProfiles')
    const ids = agentProfileRegistry.list().map((profile) => profile.id).sort()
    expect(ids).toContain('claude-code')
    expect(ids).toContain('codex')
    expect(ids).toContain('aider')
    // Core's own, which self-registers — its presence is what made the absence of the other three quiet
    // rather than fatal: a standalone node offered exactly one profile and looked like it worked.
    expect(ids).toContain('shell')
  })

  it("registers core's own agent tools under the 'core' owner", () => {
    const db = makeTestDb()
    try {
      wireAgentTools({ db: db.db })
      const names = agentToolContributions().map((tool) => tool.name)
      // The context-read group and the two repo reads — the tools with no plugin to move to
      // (apps/node/src/wiring/agentToolsWiring.ts states why each one stays).
      for (const name of ['task_context', 'linked_issues', 'repo_info']) expect(names).toContain(name)
    } finally {
      db.cleanup()
    }
  })

  it('fills the config-trust bridge, which otherwise answers 503', () => {
    const db = makeTestDb()
    try {
      configTrustBridgeSlot.set(null)
      expect(configTrustBridgeSlot.get()).toBeNull()
      wireConfigTrust(db.db)
      expect(configTrustBridgeSlot.get()).not.toBeNull()
    } finally {
      configTrustBridgeSlot.set(null)
      db.cleanup()
    }
  })
})
