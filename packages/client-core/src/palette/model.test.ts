import { describe, expect, it } from 'vitest'
import { composeItems, fuzzyFilter, fuzzyScore, type PaletteItem } from './model'

// Rows now arrive pre-built from `paletteRows` contributions, so these are the shapes plugins/terminal and
// plugins/workflows produce. composeItems no longer knows what a run target or a workflow is; what it still
// owns — and what these assert — is the ORDER of the assembled list.
const runRow = (id: string, running = false): PaletteItem =>
  ({ kind: 'run', id: `run:${id}`, label: `${running ? 'Stop' : 'Run'}: ${id}`, hint: 'pnpm dev', running })
const layoutRow = (id: string): PaletteItem =>
  ({ kind: 'layout', id: `layout:${id}`, label: `Layout: ${id}`, hint: 'open panes + start target' })

describe('composeItems', () => {
  it('orders errors → contributed rows → actions with stable ids', () => {
    const items = composeItems({
      rows: [runRow('dev'), runRow('stack', true), layoutRow('review')],
      errors: [{ source: 'repo', message: 'run.bad is missing command' }],
      actions: [{ id: 'action:terminal', label: 'New terminal' }],
    })
    expect(items.map((i) => i.kind)).toEqual(['error', 'run', 'run', 'layout', 'action'])
    expect(items[0].label).toContain('config error (repo)')
    expect(items[1].label).toBe('Run: dev')
    expect(items[2].label).toBe('Stop: stack')
    expect(items[3].id).toBe('layout:review')
  })

  it('appends switch-workspace then Go-to-task rows last, with prefixed ids', () => {
    const items = composeItems({
      rows: [runRow('dev')],
      errors: [],
      actions: [{ id: 'action:archive', label: 'Archive task' }],
      workspaces: [{ id: 'ws1', label: 'Switch workspace: Core' }],
      tasks: [{ id: 'abc', label: 'Go to task: fix login', hint: 'runn/runn' }],
    })
    expect(items.map((i) => i.kind)).toEqual(['run', 'action', 'workspace', 'task'])
    expect(items[3]).toMatchObject({ kind: 'task', id: 'task:abc', hint: 'runn/runn' })
  })

  it('keeps contributed row order, so a source cannot be reordered by kind', () => {
    // The palette concatenates sources in `order`, and composeItems must not resort them: terminal's run and
    // layout rows come before workflows' rows because that is the order the palette produced them in.
    const items = composeItems({ rows: [layoutRow('review'), runRow('dev')], errors: [], actions: [] })
    expect(items.map((i) => i.id)).toEqual(['layout:review', 'run:dev'])
  })
})

describe('fuzzy filter', () => {
  const items = composeItems({
    rows: [runRow('dev'), runRow('seed')],
    errors: [],
    actions: [
      { id: 'a1', label: 'New terminal' },
      { id: 'a2', label: 'Archive task' },
      { id: 'a3', label: 'Maximise pane' },
    ],
  })
  it('matches subsequences and ranks contiguous/word-start hits higher', () => {
    const out = fuzzyFilter(items, 'dev')
    expect(out[0].label).toBe('Run: dev')
    expect(fuzzyFilter(items, 'term')[0].label).toBe('New terminal')
    expect(fuzzyFilter(items, 'zzz')).toEqual([])
  })
  it('empty query returns everything unfiltered', () => {
    expect(fuzzyFilter(items, ' ')).toEqual(items)
  })
  it('fuzzyScore rejects non-subsequences', () => {
    expect(fuzzyScore('abc', 'a-b')).toBeNull()
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
})
