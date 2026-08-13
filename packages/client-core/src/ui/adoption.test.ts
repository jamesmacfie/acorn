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
  it('no call site hand-writes a retired shared class', () => {
    // `action-error` was the worst of these: 32 files reached for it and only the GitHub plugin's
    // stylesheet defined it, so the shell's error messages were unstyled whenever that plugin was
    // off. The Alert primitive owns it now and both github rules are gone.
    const retired = /class="[^"]*\b(overlay-btn|integration-key-input|ui-form-field|query-gate-\w+|action-error)\b/
    const offenders = tsx().filter((f) => retired.test(readFileSync(f, 'utf8'))).map(rel)
    expect(offenders).toEqual([])
  })

  // Files fully converted to the primitive components. Add a file here when you migrate it; the
  // list may only grow. It is deliberately not "all files" — migration is incremental by design.
  const CONVERTED = [
    'packages/client-core/src/settings/AppearanceSettings.tsx',
    'plugins/changes/src/client/agentToolRenderer.tsx',
    'plugins/agents/src/client/AgentCenter.tsx',
    'plugins/agents/src/client/AgentComposer.tsx',
    'plugins/agents/src/client/AgentContextPickerModal.tsx',
    'plugins/agents/src/client/AgentEventCard.tsx',
    'plugins/agents/src/client/AgentMentionTextarea.tsx',
    'plugins/agents/src/client/AgentPane.tsx',
    'plugins/agents/src/client/AgentRequestCard.tsx',
    'plugins/agents/src/client/AgentTaskSidebar.tsx',
    'plugins/agents/src/client/AgentTranscript.tsx',
    'plugins/agents/src/client/AgentUsageIndicator.tsx',
    'plugins/agents/src/client/AgentUsageSection.tsx',
    'plugins/agents/src/client/ManagedAgentMarkdown.tsx',
    'plugins/agents/src/client/QueuedAgentTurns.tsx',
    'plugins/agents/src/client/sourceContribution.tsx',
    'plugins/agents/src/client/toolRendererRegistry.tsx',
    // Tier-1 of the 2026-08 design-system migration: Alert, EmptyState, StatusDot, Checkbox,
    // ConfirmButton/createArmedConfirm, Popover/createAnchoredPopover. These files cleared the bar as
    // a side effect of losing their bespoke error banners, empty states, status dots and checkboxes.
    //
    // Files that gained a primitive but still hand-write a <button> elsewhere are NOT here: the
    // ledger means "fully converted", and listing a partly-converted file would spend the signal.
    'packages/client-core/src/editor/DocumentSurface.tsx',
    'packages/client-core/src/node/NodeChip.tsx',
    'packages/client-core/src/settings/AgentToolsSettings.tsx',
    'packages/client-core/src/settings/PluginsSettings.tsx',
    'packages/client-core/src/settings/SecuritySettings.tsx',
    'packages/client-core/src/ui/tips.tsx',
    'plugins/database/src/frame/app.tsx',
    'plugins/docker/src/client/DockerSettings.tsx',
    'plugins/github/src/client/ComparePreview.tsx',
    'plugins/github/src/client/DiffForPull.tsx',
    'plugins/github/src/client/DiffView.tsx',
    'plugins/github/src/client/GithubImporter.tsx',
    'plugins/github/src/client/Shortcuts.tsx',
    'plugins/http/src/frame/HttpVariables.tsx',
    'plugins/http/src/frame/RequestTabs.tsx',
    'plugins/http/src/frame/ResponseView.tsx',
    'plugins/linear/src/frame/app.tsx',
    'plugins/rollbar/src/frame/RollbarItemView.tsx',
    'plugins/rollbar/src/frame/app.tsx',
    // Tier-2 migration: Menu, Toolbar, Chip, Tooltip (the promoted attribute protocol), Toast,
    // DescriptionList, CollapsibleSection, SegmentedControl/ToggleButton, Input kind, Kbd.
    'packages/client-core/src/plugins/frames/PluginFrame.tsx',
    'packages/client-core/src/ui/CollapsibleSection.tsx',
    'packages/client-core/src/ui/Popover.tsx',
    'plugins/database/src/frame/index.tsx',
    'plugins/docker/src/client/DockerTaskPane.tsx',
    'plugins/http/src/frame/index.tsx',
    'plugins/linear/src/frame/index.tsx',
    'plugins/rollbar/src/frame/index.tsx',
    'plugins/terminal/src/client/slotContribution.tsx',
    // Tier-3 migration: Card, DocumentTabs, TreeRow, FindBar, Drawer, SplitHandle/createSplitDrag,
    // CodeBlock, Meter, KeyValueEditor, Table, Composer, PaletteSurface.
    'apps/desktop/src/app/client/CommandPalette.tsx',
    'packages/client-core/src/palette/WorkspacePalette.tsx',
    'packages/client-core/src/plugins/frames/DocumentOverFrame.tsx',
    'packages/client-core/src/ui/Composer.tsx',
    'packages/client-core/src/ui/Drawer.tsx',
    'packages/client-core/src/ui/FindBar.tsx',
    'packages/client-core/src/ui/KeyValueEditor.tsx',
    'plugins/editor/src/client/EditorPane.tsx',
    'plugins/editor/src/client/FilePalette.tsx',
    'plugins/editor/src/client/FileTree.tsx',
    'plugins/github/src/client/DiffToolbar.tsx',
    'plugins/onboarding/src/client/OnboardingWizard.tsx',
    'plugins/http/src/frame/RequestTabs.tsx',
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
