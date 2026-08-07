import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { agentProfileRegistry } from '@acorn/node-core/main/agentProfiles/index.ts'
import { agentToolContributions } from '@acorn/node-core/server/agentTools/registry.ts'
import { makeTestDb } from '@acorn/node-core/testkit/db.ts'
import { wireAgentTools } from '../../src/wiring/agentToolsWiring'

const HERE = dirname(fileURLToPath(import.meta.url))

// Comments STRIPPED before scanning, and this is the whole reason the helper exists.
//
// The scanner inspects source text and must recognize real composition calls. A commented-out call must
// not satisfy an assertion or hide a divergence between standalone and desktop composition. CLAUDE.md
// documents the same constraint for
// boundaries.test.ts, whose scanner deliberately does NOT strip comments; there the false POSITIVE is loud
// and immediate, so leaving them in is the safer trade. Here the failure runs the other way — a stripped
// comment can only produce a false negative, i.e. a test that fails until the call is real — so stripping is
// the safer trade.
//
// Line and block comments only. Good enough because the needles are call expressions and import specifiers,
// and the one construct that would break a regex like this (a `//` inside a string literal) does not appear
// in either composition root.
const sourceOf = (relative: string): string =>
  readFileSync(join(HERE, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')

const standalone = sourceOf('../../src/server/standalone.ts')
const runtime = sourceOf('../../src/service/runtime.ts')

describe('the standalone entry performs the same app-layer wirings as the supervised one', () => {
  it.each([
    ["../wiring/agentProfiles'", 'agent profiles (claude, codex, aider)'],
    ['wireAgentTools(', "core's own agent tools"],
    ['closeListener(', 'stopping the listener FIRST'],
    ['drainWithDeadline(', 'a bounded drain (docs/architecture-overview.md § Shutdown)'],
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

})
