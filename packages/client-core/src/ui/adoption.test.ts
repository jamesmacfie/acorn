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

const walk = (dir: string, ext: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? (e.name === 'node_modules' || e.name === 'dist' || e.name === '.acorn' ? [] : walk(join(dir, e.name), ext))
      : e.name.endsWith(ext) ? [join(dir, e.name)] : [])

const ROOTS = ['packages/client-core/src', 'plugins', 'apps/desktop/src']
const under = (ext: string) => () =>
  ROOTS.map((r) => join(SRC, r)).filter(existsSync).flatMap((d) => walk(d, ext))
const tsx = under('.tsx')
const allCss = under('.css')
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

  // A primitive spreads its OWN data-attributes after `rest`, so a call site that writes the raw
  // attribute instead of the prop is silently overridden — `<Button data-size="sm">` rendered at
  // md, and nobody could see it in review or in tsc (ComponentProps<'button'> accepts any data-*).
  // The +TASK button in every integration browse sat at full control height for exactly this.
  it('no call site passes a primitive its own data-attribute instead of the prop', () => {
    const owned = /<(?:Button|Badge|Chip|Row|Input|Select|Textarea|Spinner|Toolbar|SegmentedControl|ToggleButton|Card|Alert)\b[^>]*\sdata-(?:size|tone|variant|shape|dashed|icon-only|width|kind|invalid)=/
    const offenders = tsx().filter((f) => owned.test(readFileSync(f, 'utf8'))).map(rel)
    expect(offenders).toEqual([])
  })

  // A class handed to a primitive lands on the SAME element as the primitive's own class, so it
  // competes with `.ui-x` at (0,1,0) — which it ties and wins on order — but LOSES outright to
  // `.ui-x[data-variant='…']` at (0,2,0). cssHygiene.test.ts already bans the bare shape for Card;
  // this is the general rule, and it is checked against what each call site actually renders.
  //
  // Three bugs in one week: docker's filter strip lost its padding to `.ui-toolbar[data-size='sm']`,
  // Modern repainted every solid button because its pack rule outranked the variant, and eight more
  // strips had silently lost their gap. None of it is visible in review or to tsc.
  const CSS_CLASH = (() => {
    // What each primitive emits unconditionally (the `?? 'default'` in primitives.tsx).
    const DEFAULTS: Record<string, Record<string, string>> = {
      'ui-btn': { variant: 'outline', tone: 'neutral', size: 'md' },
      'ui-input': { size: 'md', width: 'full' },
      'ui-toolbar': { variant: 'bar', size: 'md' },
      'ui-alert': { tone: 'danger', variant: 'inline' },
      'ui-badge': { tone: 'neutral', shape: 'tag', size: 'sm' },
      'ui-chip': { tone: 'neutral', size: 'sm' },
      'section-header': { level: 'pane' },
    }
    const COMPONENT: Record<string, string> = {
      Button: 'ui-btn', Input: 'ui-input', Select: 'ui-input', Textarea: 'ui-input',
      Toolbar: 'ui-toolbar', Alert: 'ui-alert', Badge: 'ui-badge', Chip: 'ui-chip',
      Card: 'ui-card', Row: 'ui-row', EmptyState: 'ui-empty', Table: 'ui-table',
      CodeBlock: 'ui-code', Meter: 'ui-meter', SegmentedControl: 'ui-segments',
      Tabs: 'ui-tabs', SectionHeader: 'section-header',
    }
    const FLAGS = ['iconOnly', 'dashed', 'invalid', 'mono', 'busy']
    const VALUED = ['variant', 'tone', 'size', 'width', 'kind', 'shape', 'level']
    const attrName = (prop: string) => (prop === 'iconOnly' ? 'icon-only' : prop.toLowerCase())

    // Every (class, primitive, emitted attributes) triple in the app.
    const sites = new Map<string, { base: string; attrs: Record<string, string> }[]>()
    const open = new RegExp(`<(${Object.keys(COMPONENT).join('|')})\\b((?:[^<>]|\\{[^{}]*\\})*?)/?>`, 'gs')
    for (const file of tsx()) {
      for (const m of readFileSync(file, 'utf8').matchAll(open)) {
        const cls = /\bclass="([^"]+)"/.exec(m[2])
        if (!cls) continue
        const base = COMPONENT[m[1]]
        const attrs: Record<string, string> = { ...(DEFAULTS[base] ?? {}) }
        for (const prop of VALUED) {
          const set = new RegExp(`\\b${prop}="([^"]+)"`).exec(m[2])
          if (set) attrs[attrName(prop)] = set[1]
        }
        for (const flag of FLAGS) if (new RegExp(`\\b${flag}(?=[\\s/>])`).test(m[2])) attrs[attrName(flag)] = ''
        for (const name of cls[1].split(/\s+/)) {
          if (!sites.has(name)) sites.set(name, [])
          sites.get(name)!.push({ base, attrs })
        }
      }
    }

    // Every `.ui-x[data-…]` rule in primitives.css, with the properties it declares.
    const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')
    const declared = (body: string) => new Set([...body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map((d) => d[1]))
    const attrRules: { base: string; needs: [string, string | undefined][]; props: Set<string> }[] = []
    const primitives = strip(readFileSync(join(SRC, 'packages/client-core/src/styles/primitives.css'), 'utf8'))
    for (const rule of primitives.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const props = declared(rule[2])
      for (const selector of rule[1].split(',')) {
        const m = /^\s*\.(ui-[\w-]+|section-header)((?:\[data-[\w-]+(?:='[^']*')?\])+)\s*$/.exec(selector)
        if (!m) continue
        const needs = [...m[2].matchAll(/\[data-([\w-]+)(?:='([^']*)')?\]/g)].map((a) => [a[1], a[2]] as [string, string | undefined])
        attrRules.push({ base: m[1], needs, props })
      }
    }

    const offenders: string[] = []
    for (const file of allCss()) {
      const text = strip(readFileSync(file, 'utf8'))
      for (const rule of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const props = declared(rule[2])
        for (const selector of rule[1].split(',')) {
          const m = /^\s*\.([\w-]+)\s*$/.exec(selector)
          if (!m) continue
          for (const site of sites.get(m[1]) ?? []) {
            for (const attrRule of attrRules) {
              if (attrRule.base !== site.base) continue
              if (!attrRule.needs.every(([a, v]) => a in site.attrs && (v === undefined || site.attrs[a] === v))) continue
              const clash = [...props].filter((prop) => attrRule.props.has(prop))
              if (clash.length) offenders.push(`${rel(file)} .${m[1]} loses ${clash.sort().join(', ')} to .${site.base}`)
            }
          }
        }
      }
    }
    return [...new Set(offenders)].sort()
  })

  it('a class handed to a primitive is compounded with it, so the primitive cannot outrank it', () => {
    expect(CSS_CLASH()).toEqual([])
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
    // Tier-4: the Button/Select sweep. Every raw <select> in the app became the Select primitive,
    // and every ACTION button became Button — the row/tab/menu-item buttons Button's own note
    // excludes stayed as they were, which is why some heavily-converted files are still absent.
    'apps/desktop/src/app/client/App.tsx',
    'apps/desktop/src/app/client/TaskView.tsx',
    'packages/client-core/src/configTrust/ConfigTrustDialog.tsx',
    'packages/client-core/src/modelProviders/ModelConnectionPicker.tsx',
    'packages/client-core/src/node/FleetHome.tsx',
    'packages/client-core/src/node/NodeGate.tsx',
    'packages/client-core/src/plugins/PluginApprovalDialog.tsx',
    'packages/client-core/src/plugins/PluginTrustDialog.tsx',
    'packages/client-core/src/plugins/chrome/ChromeSourcePanel.tsx',
    'packages/client-core/src/plugins/frames/PluginOverlay.tsx',
    'packages/client-core/src/plugins/frames/PluginWebview.tsx',
    'packages/client-core/src/registries/willPhase.tsx',
    'packages/client-core/src/settings/McpSettings.tsx',
    'packages/client-core/src/settings/NodeDevices.tsx',
    'packages/client-core/src/settings/SchedulesSettings.tsx',
    'packages/client-core/src/settings/ShortcutsSettings.tsx',
    'packages/client-core/src/settings/WorkspaceExternalProjects.tsx',
    'packages/client-core/src/tasks/TaskPaneHost.tsx',
    'packages/client-core/src/ui/ContributionBoundary.tsx',
    'packages/client-core/src/workspaces/WorkspaceProjectAssignments.tsx',
    'plugins/agents/src/client/AgentPricingSettings.tsx',
    'plugins/context/src/client/ContextPane.tsx',
    'plugins/github/src/client/CreatePullForm.tsx',
    'plugins/http/src/frame/app.tsx',
    'plugins/onboarding/src/client/GithubConnect.tsx',
    'plugins/preview/src/client/PreviewPane.tsx',
    'plugins/terminal/src/client/TerminalPanel.tsx',
    'plugins/terminal/src/client/TerminalSettings.tsx',
    'plugins/workflows/src/client/WorkflowsSettings.tsx',
  ]

  it.each(CONVERTED)('%s uses primitives, not raw controls', (file) => {
    const text = readFileSync(join(SRC, file), 'utf8')
    expect(text, 'raw <button>').not.toMatch(/<button(?:\s|>)/)
    expect(text, 'raw <select>').not.toMatch(/<select(?:\s|>)/)
    expect(text, 'raw <textarea>').not.toMatch(/<textarea(?:\s|>)/)
    expect(text, 'raw class="ui-input"').not.toMatch(/class="ui-input"/)
  })

  // Every primitive must keep appending the caller's class — that passthrough is what makes
  // migration incremental (a converted call site can carry its old bespoke class and look
  // identical).
  //
  // Matched as `.*Class` rather than the literal `.class` because a primitive that renders more than
  // one element needs more than one class prop: ListDetail draws a container and two columns, so its
  // passthroughs are `class`, `listClass` and `detailClass`. The receiver varies too — a primitive
  // that splitProps() reads `own.class`. The invariant is that every cx() takes a caller-supplied
  // class, not that they are all spelled the same.
  it('primitives append the caller class rather than replacing it', () => {
    const text = readFileSync(join(SRC, 'packages/client-core/src/ui/primitives.tsx'), 'utf8')
    const classAttrs = [...text.matchAll(/class=\{cx\(([^)]*)\)\}/g)].map((m) => m[1])
    expect(classAttrs.length).toBeGreaterThan(0)
    for (const attr of classAttrs) expect(attr).toMatch(/\.\w*[Cc]lass\b/)
  })
})
