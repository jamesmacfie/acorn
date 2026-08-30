import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Primitive adoption ledger. See docs/ui-design.md § The closed kit for why this
// exists and how the list grew.

// Anchored on the workspace root rather than a fixed hop to a src/ dir, because renderer code is
// spread across several packages and a relative hop breaks on every move. Ledger entries below are
// workspace-root-relative for the same reason.
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
    // `action-error` was the worst of the retired classes; see docs/ui-design.md § How the
    // primitives are built. Alert owns it.
    const retired = /class="[^"]*\b(overlay-btn|integration-key-input|ui-form-field|query-gate-\w+|action-error)\b/
    const offenders = tsx().filter((f) => retired.test(readFileSync(f, 'utf8'))).map(rel)
    expect(offenders).toEqual([])
  })

  // See docs/ui-design.md § The closed kit for why a primitive spreads its own
  // data-attributes after `rest`, and the bug this test caught.
  it('no call site passes a primitive its own data-attribute instead of the prop', () => {
    const owned = /<(?:Button|Badge|Chip|Row|Input|Select|Textarea|Spinner|Toolbar|SegmentedControl|ToggleButton|Card|Alert)\b[^>]*\sdata-(?:size|tone|variant|shape|dashed|icon-only|width|kind|invalid)=/
    const offenders = tsx().filter((f) => owned.test(readFileSync(f, 'utf8'))).map(rel)
    expect(offenders).toEqual([])
  })

  // See docs/ui-design.md § The closed kit for the specificity clash this guards
  // against. cssHygiene.test.ts already bans the bare shape for Card; this is the general rule,
  // checked against what each call site actually renders.
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
    const primitives = strip(readFileSync(join(SRC, 'packages/client-core/src/infra/styles/primitives.css'), 'utf8'))
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

  // `.ui-check` lays the box beside its label with no `flex-direction` of its own, so a caller class
  // that says `column` wins on cascade order and stacks the label under the box. Docker and Terminal
  // both passed `.settings-field` and got that. CSS_CLASH above only reads the `.ui-x[data-…]` rules,
  // so it cannot see this one.
  it('no class handed to a Checkbox stacks the box above its label', () => {
    const columnClasses = new Set<string>()
    for (const file of allCss()) {
      for (const rule of readFileSync(file, 'utf8').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (!/flex-direction\s*:\s*column/.test(rule[2])) continue
        for (const selector of rule[1].split(',')) {
          const m = /^\s*\.([\w-]+)\s*$/.exec(selector)
          if (m) columnClasses.add(m[1])
        }
      }
    }
    const offenders: string[] = []
    for (const file of tsx()) {
      for (const m of readFileSync(file, 'utf8').matchAll(/<Checkbox\b((?:[^<>]|\{[^{}]*\})*?)\/?>/gs)) {
        const cls = /\bclass="([^"]+)"/.exec(m[1])
        if (!cls) continue
        const names = cls[1].split(/\s+/)
        // A later `row` class in the same list puts the direction back.
        if (names.some((n) => n.endsWith('-row'))) continue
        for (const name of names) if (columnClasses.has(name)) offenders.push(`${rel(file)} .${name}`)
      }
    }
    expect([...new Set(offenders)].sort()).toEqual([])
  })

  // ── The invariants, inverted ────────────────────────────────────────────────────────────────
  //
  // This file was a ledger: a growing list of files someone had converted, each checked for raw
  // controls. Phase 9 of the layout programme finished the conversion, so the list is gone and the
  // rules below hold for everything. A ledger only ever answers "has this file been done"; a rule
  // answers "can this be written at all", which is the question that stays useful.

  // A plugin's own components, which is what these rules are about. Test files are excluded: a
  // `.test.tsx` in a plugin package renders a region under jsdom and stubs its neighbours
  // (plugins/vitest.shared.ts § hosts), and a stub's job is to be identifiable on screen rather than
  // to be a kit node. Nothing a test file draws ever reaches a user.
  const pluginTsx = () =>
    tsx().filter((file) => rel(file).startsWith('plugins/') && !/\.test\.tsx?$/.test(file))

  it('no plugin draws a raw div or span', () => {
    // Anti-vacuity first: this rule reads a file list, and a list that came back empty — a renamed
    // directory, a changed `rel` — would make every assertion below pass by finding nothing.
    expect(pluginTsx().length).toBeGreaterThan(50)
    // The one that took the whole programme. A plugin's tree is kit nodes: `Stack` and `Inline` for
    // grouping, `Text` for a run of words, `Rectangle` for pixels somebody else owns. A raw element is
    // how a plugin used to reach a class in the host's stylesheet, and it is the one thing that cannot
    // cross to a worker — so a plugin that emits one has written something a loaded plugin could not.
    //
    // `div` and `span` only. A `section`, a `table` or an `input` inside a host component is markup
    // with meaning; a div is markup with a class.
    const raw = /<(?:div|span)[\s>/]/
    const offenders = pluginTsx().filter((file) => raw.test(readFileSync(file, 'utf8'))).map(rel)
    expect(offenders).toEqual([])
  })

  // The other two halves of the same rule — no plugin stylesheet, and no plugin mounting a Solid root
  // of its own — are arch rules, in `tools/arch/boundaries.test.ts`. They belong there because they are
  // about what a package may contain rather than about what a call site writes.

  // The class-passthrough invariant that used to live here is gone with the passthrough itself: no
  // kit node takes a `class` any more, and `ui/kit/props.test-d.ts` is what holds that now. The
  // CSS_CLASH and Checkbox checks above stay for the host's own code, which still writes elements and
  // stylesheets and can still lose a rule to a primitive's own attribute selector.
})
