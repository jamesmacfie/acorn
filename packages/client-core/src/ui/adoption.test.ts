import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

// Anchored on the workspace root rather than a fixed hop to a src/ dir: renderer code is spread
// across packages/client-core and the plugin/app packages now, and a relative hop breaks on every
// move. Ledger entries below are workspace-root-relative for the same reason.
const SRC = (() => {
  let dir = fileURLToPath(new URL('.', import.meta.url))
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Could not locate the workspace root from adoption.test.ts')
    dir = parent
  }
})()

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : [])

const tsx = () =>
  [join(SRC, 'packages/client-core/src'), join(SRC, 'plugins'), join(SRC, 'apps/desktop/src')]
    .filter(existsSync)
    .flatMap(walk)
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
    'packages/client-core/src/settings/AppearanceSettings.tsx',
    'apps/desktop/src/plugins/changes/client/agentToolRenderer.tsx',
    'apps/desktop/src/plugins/agents/client/AgentCenter.tsx',
    'apps/desktop/src/plugins/agents/client/AgentComposer.tsx',
    'apps/desktop/src/plugins/agents/client/AgentContextPickerModal.tsx',
    'apps/desktop/src/plugins/agents/client/AgentEventCard.tsx',
    'apps/desktop/src/plugins/agents/client/AgentMentionTextarea.tsx',
    'apps/desktop/src/plugins/agents/client/AgentPane.tsx',
    'apps/desktop/src/plugins/agents/client/AgentRequestCard.tsx',
    'apps/desktop/src/plugins/agents/client/AgentTaskSidebar.tsx',
    'apps/desktop/src/plugins/agents/client/AgentTranscript.tsx',
    'apps/desktop/src/plugins/agents/client/AgentUsageIndicator.tsx',
    'apps/desktop/src/plugins/agents/client/AgentUsageSection.tsx',
    'apps/desktop/src/plugins/agents/client/ManagedAgentMarkdown.tsx',
    'apps/desktop/src/plugins/agents/client/QueuedAgentTurns.tsx',
    'apps/desktop/src/plugins/agents/client/sourceContribution.tsx',
    'apps/desktop/src/plugins/agents/client/toolRendererRegistry.tsx',
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
    const text = readFileSync(join(SRC, 'packages/client-core/src/ui/primitives.tsx'), 'utf8')
    const classAttrs = [...text.matchAll(/class=\{cx\(([^)]*)\)\}/g)].map((m) => m[1])
    expect(classAttrs.length).toBeGreaterThan(0)
    for (const attr of classAttrs) expect(attr).toContain('.class')
  })
})
