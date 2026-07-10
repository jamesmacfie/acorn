import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Architecture boundary enforcement for the Phase 10 core/plugins/app foldering (docs/next
// extensibility §6, phase-10-foldering §5). This is the import rule that makes the boundary real
// for future contributors, not just true at the moment of the move.
//
// HARD invariants (must be zero — the plugin model's guarantees):
//   - nothing in core/ or plugins/ imports app/ (the composition root is a leaf; app imports them)
//   - the client↔node process boundary holds (renderer never imports server/main, and vice versa)
//
// BASELINED debt (cross-feature coupling that predates foldering — features importing each other
// directly instead of through the pane/command/capability/state registries the earlier phases
// created). These are the "earlier seam not yet adopted" couplings; the move surfaced them. The
// baseline is a SHRINKING ledger: the test fails on any NEW coupling, and fails if a listed one is
// removed without deleting its baseline entry — so the list can only go down. Each is a candidate
// for capability/registry adoption (Phase 4/5/6 follow-through), tracked, not hidden.
//
// Test files are exempt from every rule: tests legitimately compose across layers.

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css']
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])(\.[^'"]*)\1/g
const NODE_PROCS = new Set(['server', 'main', 'mcp'])

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

// --- baselined cross-feature couplings (see header). Sorted; shrink over time, never grow. ---
const BASELINE_CORE_TO_PLUGIN = [
  'core/client/App.tsx => plugins/github/client/ComparePreview.tsx',
  'core/client/App.tsx => plugins/github/client/CreatePullForm.tsx',
  'core/client/App.tsx => plugins/github/client/DiffView.tsx',
  'core/client/App.tsx => plugins/github/client/PullDetail.tsx',
  'core/client/App.tsx => plugins/github/client/PullList.tsx',
  'core/client/App.tsx => plugins/github/client/RepoPicker.tsx',
  'core/client/App.tsx => plugins/github/client/mutations.ts',
  'core/client/App.tsx => plugins/onboarding/client/OnboardingModal.tsx',
  'core/client/App.tsx => plugins/terminal/client/TerminalPanel.tsx',
  'core/client/App.tsx => plugins/terminal/client/sessions.ts',
  'core/client/Shortcuts.tsx => plugins/github/client/changedFiles.ts',
  'core/client/agent/reference.ts => plugins/terminal/client/sessions.ts',
  'core/client/agent/reference.ts => plugins/terminal/client/terminalClient.ts',
  'core/client/palette/CommandPalette.tsx => plugins/agents/client/workflowClient.ts',
  'core/client/palette/CommandPalette.tsx => plugins/terminal/client/recipes.ts',
  'core/client/palette/CommandPalette.tsx => plugins/terminal/client/runClient.ts',
  'core/client/palette/CommandPalette.tsx => plugins/terminal/client/sessions.ts',
  'core/client/palette/CommandPalette.tsx => plugins/terminal/client/terminalClient.ts',
  'core/client/palette/FilePalette.tsx => plugins/editor/client/editorClient.ts',
  'core/client/palette/FilePalette.tsx => plugins/editor/client/editorState.ts',
  'core/client/persistence/scopedEviction.ts => plugins/editor/client/editorState.ts',
  'core/client/persistence/scopedEviction.ts => plugins/editor/client/editorViewState.ts',
  'core/client/persistence/scopedEviction.ts => plugins/github/client/pullList/filterState.ts',
  'core/client/persistence/scopedEviction.ts => plugins/terminal/client/sessions.ts',
  'core/client/persistence/stateSlices.ts => plugins/editor/client/editorState.ts',
  'core/client/persistence/stateSlices.ts => plugins/github/client/pullList/filterState.ts',
  'core/client/settings/IntegrationsSettings.tsx => plugins/github/client/mutations.ts',
  'core/client/settings/WorkspaceSettings.tsx => plugins/editor/client/autosave.ts',
  'core/client/settings/WorkspaceSettings.tsx => plugins/github/client/mutations.ts',
  'core/client/settings/WorkspaceSettings.tsx => plugins/terminal/client/terminalClient.ts',
  'core/client/settings/savePref.ts => plugins/github/client/mutations.ts',
  'core/client/tabs/TabRail.tsx => plugins/github/client/displayMeta.ts',
  'core/client/tabs/TabRail.tsx => plugins/github/client/mutations.ts',
  'core/client/tabs/TabRail.tsx => plugins/terminal/client/sessions.ts',
  'core/client/tabs/TabRail.tsx => plugins/terminal/client/terminalClient.ts',
  'core/client/tasks/TaskView.tsx => plugins/agents/client/AgentsPanel.tsx',
  'core/client/tasks/TaskView.tsx => plugins/github/client/mutations.ts',
  'core/client/tasks/TaskView.tsx => plugins/terminal/client/runClient.ts',
  'core/client/tasks/TaskView.tsx => plugins/terminal/client/sessions.ts',
  'core/client/tasks/TaskView.tsx => plugins/terminal/client/terminalClient.ts',
  'core/client/tasks/taskStatus.ts => plugins/terminal/client/terminalClient.ts',
  'core/client/ui/UserAvatar.tsx => plugins/github/client/displayMeta.ts',
  'core/client/workspaces/WorkspaceRepoAssignments.tsx => plugins/github/client/mutations.ts',
  'core/client/workspaces/WorkspaceRepoAssignments.tsx => plugins/terminal/client/terminalClient.ts',
  'core/main/archive.ts => plugins/terminal/main/terminalUtils.ts',
  'core/main/taskWorktree.ts => plugins/terminal/main/runConfig.ts',
  'core/main/worktrees.ts => plugins/terminal/main/terminalUtils.ts',
]
const BASELINE_PLUGIN_TO_PLUGIN = [
  'plugins/agents/client/AgentsPanel.tsx => plugins/terminal/client/sessions.ts',
  'plugins/agents/client/AgentsPanel.tsx => plugins/terminal/client/terminalClient.ts',
  'plugins/agents/client/model.ts => plugins/terminal/client/terminalClient.ts',
  'plugins/agents/client/workflowClient.ts => plugins/terminal/client/terminalClient.ts',
  'plugins/agents/main/agentSend.ts => plugins/terminal/main/terminalUtils.ts',
  'plugins/changes/client/ChangesPane.tsx => plugins/github/client/diff/DiffRows.tsx',
  'plugins/changes/client/ChangesPane.tsx => plugins/github/client/diff/model.ts',
  'plugins/changes/client/ChangesPane.tsx => plugins/github/client/displayMeta.ts',
  'plugins/changes/client/ChangesPane.tsx => plugins/github/client/mutations.ts',
  'plugins/changes/client/ChangesPane.tsx => plugins/github/client/shiki.ts',
  'plugins/changes/client/ChangesPane.tsx => plugins/terminal/client/sessions.ts',
  'plugins/changes/client/ChangesPane.tsx => plugins/terminal/client/terminalClient.ts',
  'plugins/context/client/ContextPane.tsx => plugins/memory/client/MemoryTray.tsx',
  'plugins/context/client/ContextPane.tsx => plugins/notes/client/notesClient.ts',
  'plugins/context/client/ContextPane.tsx => plugins/terminal/client/sessions.ts',
  'plugins/context/client/ContextPane.tsx => plugins/terminal/client/terminalClient.ts',
  'plugins/database/client/DatabasePane.tsx => plugins/editor/client/monacoSetup.ts',
  'plugins/database/client/DatabasePane.tsx => plugins/terminal/client/theme.ts',
  'plugins/editor/client/EditorPane.tsx => plugins/terminal/client/theme.ts',
  'plugins/github/client/PullDetail.tsx => plugins/linear/client/LinearIssuePanel.tsx',
  'plugins/github/client/PullDetail.tsx => plugins/linear/client/scanLinearRefs.ts',
  'plugins/github/client/PullList.tsx => plugins/linear/client/scanLinearRefs.ts',
  'plugins/github/client/mutations.ts => plugins/terminal/client/terminalClient.ts',
  'plugins/linear/client/LinearBrowse.tsx => plugins/github/client/mutations.ts',
  'plugins/linear/client/LinearIssuePanel.tsx => plugins/github/client/displayMeta.ts',
  'plugins/linear/client/LinearIssuePanel.tsx => plugins/github/client/mutations.ts',
  'plugins/memory/main/knowledgeIpc.ts => plugins/notes/main/notes.ts',
  'plugins/memory/main/knowledgeIpc.ts => plugins/terminal/main/terminalUtils.ts',
  'plugins/notes/client/NotesPane.tsx => plugins/editor/client/autosave.ts',
  'plugins/preview/client/PreviewTaskPane.tsx => plugins/terminal/client/runClient.ts',
  'plugins/preview/client/PreviewTaskPane.tsx => plugins/terminal/client/terminalClient.ts',
  'plugins/terminal/client/theme.ts => plugins/github/client/shiki.ts',
  'plugins/terminal/main/terminal.ts => plugins/agents/main/agentSend.ts',
  'plugins/workflows/client/WorkflowsSettings.tsx => plugins/agents/client/workflowClient.ts',
  'plugins/workflows/client/WorkflowsSettings.tsx => plugins/terminal/client/terminalClient.ts',
]

describe('architecture boundaries', () => {
  const edges = scan()
  const seen = (kind: Edge['kind']) => [...new Set(edges.filter((e) => e.kind === kind).map((e) => `${e.from} => ${e.to}`))].sort()

  it('nothing in core/ or plugins/ imports app/ (composition root is a leaf)', () => {
    expect(seen('→app')).toEqual([])
  })

  it('the client↔node process boundary holds', () => {
    expect(seen('process')).toEqual([])
  })

  it('core→plugin coupling matches the shrinking baseline (no new; remove entry when a coupling is fixed)', () => {
    expect(seen('core→plugin')).toEqual([...BASELINE_CORE_TO_PLUGIN].sort())
  })

  it('plugin→plugin coupling matches the shrinking baseline (no new; remove entry when a coupling is fixed)', () => {
    expect(seen('plugin→plugin')).toEqual([...BASELINE_PLUGIN_TO_PLUGIN].sort())
  })
})
