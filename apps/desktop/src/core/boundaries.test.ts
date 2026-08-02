import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Architecture boundary enforcement for the core/plugins/app layout (docs/plugins.md). This makes
// the boundary executable for future contributors instead of leaving it as a convention.
//
// HARD invariants (must be zero — the plugin model's guarantees):
//   - nothing in core/ or plugins/ imports app/ (the composition root is a leaf; app imports them)
//   - the client↔node process boundary holds (renderer never imports server/main, and vice versa)
//
// TARGET invariants for continued decoupling:
//   - core imports no plugin implementation
//   - plugins import no other plugin's internals
//
// BASELINED debt toward those target invariants (cross-feature coupling that predates foldering — features importing each other
// directly instead of through the pane/command/capability/state registries the earlier phases
// created). These are the "earlier seam not yet adopted" couplings; the move surfaced them. The
// baseline is a SHRINKING ledger: the test fails on any NEW coupling, and fails if a listed one is
// removed without deleting its baseline entry — so the list can only go down. Each edge should be
// replaced with capability/registry adoption or a corrected ownership boundary, not another
// exemption.
//
// Test files are exempt from every rule: tests legitimately compose across layers.

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css']
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])(\.[^'"]*)\1/g
const NODE_PROCS = new Set(['server', 'main', 'service', 'mcp'])

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(e.name)) out.push(p)
  }
  return out
}

function resolveSpec(fromAbs: string, spec: string): string | null {
  const abs = resolve(dirname(fromAbs), spec)
  if (existsSync(abs) && statSync(abs).isFile()) return abs
  for (const ext of EXTS) if (existsSync(abs + ext)) return abs + ext
  for (const ext of EXTS) { const i = join(abs, 'index' + ext); if (existsSync(i)) return i }
  return null
}

type Cat = { layer: string; plugin: string | null; proc: string | undefined }
function categorize(rel: string): Cat {
  const seg = rel.split('/')
  return { layer: seg[0], plugin: seg[0] === 'plugins' ? seg[1] : null, proc: seg[0] === 'plugins' ? seg[2] : seg[1] }
}
const isTest = (rel: string) => /\.test\.tsx?$/.test(rel)

type Edge = { from: string; to: string; kind: 'core→plugin' | 'plugin→plugin' | '→app' | 'process' }
function scan(): Edge[] {
  const edges: Edge[] = []
  for (const f of walk(SRC)) {
    const relF = relative(SRC, f)
    if (isTest(relF)) continue
    const src = categorize(relF)
    const text = readFileSync(f, 'utf8')
    let m: RegExpExecArray | null
    while ((m = IMPORT_RE.exec(text))) {
      const targetAbs = resolveSpec(f, m[2])
      if (!targetAbs) continue
      const relT = relative(SRC, targetAbs)
      if (relT.startsWith('..')) continue
      const tgt = categorize(relT)
      const edge = `${relF} => ${relT}`
      if ((src.layer === 'core' || src.layer === 'plugins') && tgt.layer === 'app') edges.push({ from: relF, to: relT, kind: '→app' })
      if (src.proc === 'client' && tgt.proc && NODE_PROCS.has(tgt.proc)) edges.push({ from: relF, to: relT, kind: 'process' })
      if (src.proc && NODE_PROCS.has(src.proc) && tgt.proc === 'client') edges.push({ from: relF, to: relT, kind: 'process' })
      if (src.layer === 'core' && tgt.layer === 'plugins') edges.push({ from: relF, to: relT, kind: 'core→plugin' })
      if (src.layer === 'plugins' && tgt.layer === 'plugins' && tgt.plugin !== src.plugin) edges.push({ from: relF, to: relT, kind: 'plugin→plugin' })
      void edge
    }
  }
  return edges
}

function localGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  for (const file of walk(SRC)) {
    const dependencies: string[] = []
    const text = readFileSync(file, 'utf8')
    let match: RegExpExecArray | null
    while ((match = IMPORT_RE.exec(text))) {
      const target = resolveSpec(file, match[2])
      if (target && !relative(SRC, target).startsWith('..')) dependencies.push(target)
    }
    graph.set(file, dependencies)
  }
  return graph
}

function reachableFrom(roots: string[], graph: Map<string, string[]>): string[] {
  const visited = new Set<string>()
  const pending = [...roots]
  while (pending.length) {
    const file = pending.pop()
    if (!file || visited.has(file)) continue
    visited.add(file)
    pending.push(...(graph.get(file) ?? []))
  }
  return [...visited]
}

// --- baselined cross-feature couplings (see header). Sorted; shrink over time, never grow. ---
const BASELINE_CORE_TO_PLUGIN = [
  'core/client/App.tsx => plugins/github/client/ComparePreview.tsx',
  'core/client/App.tsx => plugins/github/client/CreatePullForm.tsx',
  'core/client/App.tsx => plugins/github/client/DiffView.tsx',
  'core/client/App.tsx => plugins/github/client/PullDetail.tsx',
  'core/client/App.tsx => plugins/github/client/PullList.tsx',
  'core/client/App.tsx => plugins/onboarding/client/OnboardingModal.tsx',
  'core/client/App.tsx => plugins/terminal/client/TerminalPanel.tsx',
  'core/client/palette/CommandPalette.tsx => plugins/agents/client/workflowClient.ts',
  'core/client/palette/CommandPalette.tsx => plugins/terminal/client/recipes.ts',
  'core/client/palette/CommandPalette.tsx => plugins/terminal/client/runClient.ts',
  'core/client/tasks/TaskView.tsx => plugins/terminal/client/runClient.ts',
  'core/client/tasks/TaskView.tsx => plugins/terminal/client/terminalClient.ts',
]
const BASELINE_PLUGIN_TO_PLUGIN = [
  'plugins/agents/client/AgentTaskSidebar.tsx => plugins/terminal/client/terminalClient.ts',
  'plugins/changes/client/ChangesPane.tsx => plugins/github/client/diff/DiffRows.tsx',
  'plugins/changes/client/ChangesPane.tsx => plugins/github/client/diff/model.ts',
  'plugins/context/client/ContextPane.tsx => plugins/memory/client/MemorySection.tsx',
  'plugins/context/client/ContextPane.tsx => plugins/notes/client/notesClient.ts',
  'plugins/database/client/DatabasePane.tsx => plugins/editor/client/monacoSetup.ts',
  // NOTE: notes → context is gone (the shared size formatters moved to core/client/lib/formatSize).
  // That edge closed the only context ↔ notes cycle; keep it closed.
  'plugins/github/client/PullDetail.tsx => plugins/linear/client/LinearIssuePanel.tsx',
  'plugins/github/client/PullDetail.tsx => plugins/linear/client/scanLinearRefs.ts',
  'plugins/github/client/PullList.tsx => plugins/linear/client/scanLinearRefs.ts',
  'plugins/memory/main/knowledgeIpc.ts => plugins/notes/main/notes.ts',
  'plugins/preview/client/PreviewTaskPane.tsx => plugins/terminal/client/runClient.ts',
  'plugins/workflows/client/WorkflowsSettings.tsx => plugins/agents/client/workflowClient.ts',
]

describe('architecture boundaries', () => {
  const edges = scan()
  const graph = localGraph()
  const seen = (kind: Edge['kind']) => [...new Set(edges.filter((e) => e.kind === kind).map((e) => `${e.from} => ${e.to}`))].sort()

  it('nothing in core/ or plugins/ imports app/ (composition root is a leaf)', () => {
    expect(seen('→app')).toEqual([])
  })

  it('the client↔node process boundary holds', () => {
    expect(seen('process')).toEqual([])
  })

  it('the utility-service dependency graph is Electron-free', () => {
    const serviceRoot = resolve(SRC, 'app/service/index.ts')
    const electronImports = reachableFrom([serviceRoot], graph)
      .filter((file) => /\bfrom\s*['"]electron['"]|\bimport\s*\(\s*['"]electron['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
      .sort()
    expect(electronImports).toEqual([])
  })

  it('Electron main cannot reach service-owned runtime engines', () => {
    const mainRoot = resolve(SRC, 'app/main/electron.ts')
    const forbidden = new Set([
      'core/main/bindings.ts',
      'core/main/server.ts',
      'core/main/wsHub.ts',
      'plugins/database/main/database.ts',
      'plugins/docker/main/dockerService.ts',
      'plugins/terminal/main/terminal.ts',
      'plugins/workflows/main/workflowRunner.ts',
    ])
    const reached = reachableFrom([mainRoot], graph)
      .map((file) => relative(SRC, file))
      .filter((file) => forbidden.has(file))
      .sort()
    expect(reached).toEqual([])
  })

  it('core→plugin coupling matches the shrinking baseline (no new; remove entry when a coupling is fixed)', () => {
    expect(seen('core→plugin')).toEqual([...BASELINE_CORE_TO_PLUGIN].sort())
  })

  it('plugin→plugin coupling matches the shrinking baseline (no new; remove entry when a coupling is fixed)', () => {
    expect(seen('plugin→plugin')).toEqual([...BASELINE_PLUGIN_TO_PLUGIN].sort())
  })
})
