import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Primitive adoption ledger.
//
// The failure mode this exists to prevent is a six-month half-migration: two ways to write a
// button, no way to tell which files are done, and no signal when a new one regresses. Progress
// here is monotone and visible in one list, and a regression is a test failure rather than a
// reviewer noticing.
//
// Same shrinking-baseline idiom as core/boundaries.test.ts.

const SRC = fileURLToPath(new URL('../../..', import.meta.url))

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : [])

const tsx = () => [...walk(join(SRC, 'core')), ...walk(join(SRC, 'plugins')), ...walk(join(SRC, 'app'))]
const rel = (p: string) => p.slice(SRC.length + 1)

describe('primitive adoption', () => {
  // Classes the primitives own outright. Nothing may spell them by hand any more; the CSS rules
  // they used to point at have been deleted, so a stray usage renders unstyled.
  it('no call site hand-writes a retired shared class', () => {
    const retired = /class="[^"]*\b(overlay-btn|integration-key-input|ui-form-field|query-gate-\w+)\b/
    const offenders = tsx().filter((f) => retired.test(readFileSync(f, 'utf8'))).map(rel)
    expect(offenders).toEqual([])
  })

  // Files fully converted to the primitive components. Add a file here when you migrate it; the
  // list may only grow. It is deliberately not "all files" — migration is incremental by design.
  const CONVERTED = [
    'core/client/settings/AppearanceSettings.tsx',
    'plugins/changes/client/agentToolRenderer.tsx',
    'plugins/agents/client/AgentCenter.tsx',
    'plugins/agents/client/AgentComposer.tsx',
    'plugins/agents/client/AgentContextPickerModal.tsx',
    'plugins/agents/client/AgentEventCard.tsx',
    'plugins/agents/client/AgentMentionTextarea.tsx',
    'plugins/agents/client/AgentPane.tsx',
    'plugins/agents/client/AgentRequestCard.tsx',
    'plugins/agents/client/AgentTaskSidebar.tsx',
    'plugins/agents/client/AgentTranscript.tsx',
    'plugins/agents/client/AgentUsageIndicator.tsx',
    'plugins/agents/client/AgentUsageSection.tsx',
    'plugins/agents/client/ManagedAgentMarkdown.tsx',
    'plugins/agents/client/QueuedAgentTurns.tsx',
    'plugins/agents/client/sourceContribution.tsx',
    'plugins/agents/client/toolRendererRegistry.tsx',
  ]

  it.each(CONVERTED)('%s uses primitives, not raw controls', (file) => {
    const text = readFileSync(join(SRC, file), 'utf8')
    expect(text, 'raw <button>').not.toMatch(/<button(?:\s|>)/)
    expect(text, 'raw <select>').not.toMatch(/<select(?:\s|>)/)
    expect(text, 'raw <textarea>').not.toMatch(/<textarea(?:\s|>)/)
    expect(text, 'raw class="ui-input"').not.toMatch(/class="ui-input"/)
  })

  // Every primitive must keep appending props.class — that passthrough is what makes migration
  // incremental (a converted call site can carry its old bespoke class and look identical).
  it('primitives append props.class rather than replacing it', () => {
    const text = readFileSync(join(SRC, 'core/client/ui/primitives.tsx'), 'utf8')
    const classAttrs = [...text.matchAll(/class=\{cx\(([^)]*)\)\}/g)].map((m) => m[1])
    expect(classAttrs.length).toBeGreaterThan(0)
    for (const attr of classAttrs) expect(attr).toContain('.class')
  })
})
