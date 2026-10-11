import { describe, expect, it } from 'vitest'
import type { DashboardDisplayRow, DashboardDisplaySchema } from './display'
import {
  isMapped,
  mappedColumnId,
  panelFieldsFor,
  panelSchema,
  sourceFieldFor,
  statusValuesOf,
  unionRows,
  withMappedValue,
  type PanelSourcePage,
} from './mapping'
import type { PanelMapping, PanelProjectionSource } from './model'
import { boardColumns, shapeRows, UNGROUPED_COLUMN_ID } from './shaping'

// The mapping layer, which is what makes a panel cross-source. The editor that drives it cannot be
// rendered here, because vitest runs in node with no Solid plugin, so everything that can actually be
// wrong lives in these functions and is checked here.
//
// The two source schemas below are modelled on the real ones, trimmed. github declares its status statically and linear
// folds the workspace's own state names into its response. That difference is why the scenario is hard and why it is
// worth testing against.

const githubSchema: DashboardDisplaySchema = {
  fields: [
    { id: 'title', name: 'Title', type: 'text', role: 'title' },
    { id: 'repo', name: 'Repository', type: 'text' },
    {
      id: 'status',
      name: 'Status',
      type: 'enum',
      role: 'status',
      values: [
        { id: 'draft', label: 'Draft', tone: 'muted' },
        { id: 'open', label: 'Open', tone: 'accent' },
        { id: 'ready', label: 'Ready to merge', tone: 'ok' },
      ],
    },
    { id: 'author', name: 'Author', type: 'person', role: 'assignee' },
    { id: 'updated', name: 'Updated', type: 'datetime', role: 'updated' },
    { id: 'url', name: 'Link', type: 'link', role: 'url' },
  ],
}

const linearSchema: DashboardDisplaySchema = {
  fields: [
    { id: 'title', name: 'Title', type: 'text', role: 'title' },
    { id: 'identifier', name: 'Issue', type: 'text' },
    {
      id: 'state',
      name: 'Status',
      type: 'enum',
      role: 'status',
      values: [
        { id: 'unstarted', label: 'Todo', tone: 'muted' },
        { id: 'started', label: 'In progress', tone: 'accent' },
        { id: 'completed', label: 'Done', tone: 'ok' },
      ],
    },
    { id: 'assignee', name: 'Assignee', type: 'person', role: 'assignee' },
    { id: 'updated', name: 'Updated', type: 'datetime', role: 'updated' },
    { id: 'url', name: 'Link', type: 'link', role: 'url' },
  ],
}

const githubQuery: PanelProjectionSource = { pluginId: 'github', sourceId: 'pulls-mine' }
const linearQuery: PanelProjectionSource = { pluginId: 'linear', sourceId: 'issues-mine' }

const row = (query: PanelProjectionSource, id: string, values: DashboardDisplayRow['values']): DashboardDisplayRow => ({
  id,
  values,
  pluginId: query.pluginId,
  sourceId: query.sourceId,
})

const github: PanelSourcePage = {
  source: githubQuery,
  schema: githubSchema,
  rows: [
    row(githubQuery, '1', { title: 'Fix the parser', repo: 'acme/app', status: 'open', author: 'ada', updated: 300 }),
    row(githubQuery, '2', { title: 'Bump deps', repo: 'acme/app', status: 'ready', author: 'ada', updated: 100 }),
  ],
}

const linear: PanelSourcePage = {
  source: linearQuery,
  schema: linearSchema,
  rows: [
    row(linearQuery, 'ENG-7', {
      title: 'Ship the board',
      identifier: 'ENG-7',
      state: 'started',
      assignee: 'grace',
      updated: 200,
    }),
    row(linearQuery, 'ENG-9', {
      title: 'Write it up',
      identifier: 'ENG-9',
      state: 'completed',
      assignee: 'grace',
      updated: 400,
    }),
  ],
}

const sources = [github, linear]

/** The user's own four columns, which is the point of the derived enum. */
const todoColumns = [
  { id: 'c1', label: 'Todo', tone: 'muted' as const },
  { id: 'c2', label: 'Doing', tone: 'accent' as const },
  { id: 'c3', label: 'Waiting', tone: 'warn' as const },
  { id: 'c4', label: 'Done', tone: 'ok' as const },
]

const todoBoard: PanelMapping = {
  columns: todoColumns,
  bySource: {
    'github:pulls-mine': { c2: { values: ['open'] }, c3: { values: ['ready'] } },
    'linear:issues-mine': { c1: { values: ['unstarted'] }, c2: { values: ['started'] }, c4: { values: ['completed'] } },
  },
}

const ids = (result: readonly DashboardDisplayRow[]) => result.map((entry) => entry.id)

describe('when the mapping layer applies at all', () => {
  it('leaves a single collection with no columns completely alone', () => {
    expect(isMapped([githubQuery], undefined)).toBe(false)
    expect(panelSchema([github], undefined)).toEqual(githubSchema)
    // Rows pass through verbatim: same ids, same field names, no rewriting.
    expect(unionRows([github], undefined)).toEqual(github.rows)
  })

  it('applies on the second source, or on invented columns over one', () => {
    expect(isMapped([githubQuery, linearQuery], undefined)).toBe(true)
    expect(isMapped([githubQuery], { columns: todoColumns })).toBe(true)
    expect(isMapped([githubQuery], { fields: {} })).toBe(false)
  })
})

describe('field mapping is pre-filled from the declared ROLES', () => {
  it('resolves a panel field to the role by default and to the override when there is one', () => {
    expect(sourceFieldFor(linear, 'status', undefined)).toBe('state')
    expect(sourceFieldFor(linear, 'title', { fields: { 'linear:issues-mine': { title: 'identifier' } } })).toBe(
      'identifier',
    )
    // `''` is "this source has nothing here", which is a different answer from an absent key.
    expect(sourceFieldFor(linear, 'assignee', { fields: { 'linear:issues-mine': { assignee: '' } } })).toBeUndefined()
  })
})

describe('the panel-local schema', () => {
  it('is the role vocabulary, with the user’s columns as the status field’s values', () => {
    const schema = panelSchema(sources, todoBoard)
    expect(schema.fields.map((field) => field.id)).toEqual(['title', 'status', 'assignee', 'updated', 'url', 'source'])
    expect(schema.fields.find((field) => field.id === 'status')?.values).toEqual(todoColumns)
  })

  it('drops a panel field no source can fill', () => {
    const noPeople: PanelSourcePage = {
      ...github,
      schema: { fields: githubSchema.fields.filter((f) => f.role !== 'assignee') },
    }
    const schema = panelSchema(
      [noPeople, { ...linear, schema: { fields: linearSchema.fields.filter((f) => f.role !== 'assignee') } }],
      todoBoard,
    )
    expect(schema.fields.map((field) => field.id)).not.toContain('assignee')
  })

  it('declares no values at all until the user has invented columns', () => {
    const schema = panelSchema(sources, undefined)
    expect(schema.fields.find((field) => field.id === 'status')?.values).toBeUndefined()
  })

  it('keeps one source’s own field names and status words when it is mapped without columns', () => {
    // A mapping with a field override and no columns still maps the panel. Dropping the source's declared
    // values here would draw a status as its raw id on a grey dot.
    const mapped: PanelMapping = { fields: { 'linear:issues-mine': { assignee: 'assignee' } } }
    const schema = panelSchema([linear], mapped)
    expect(schema.fields.find((field) => field.id === 'status')?.values).toEqual(linearSchema.fields[2]!.values)
    expect(schema.fields.find((field) => field.id === 'title')?.name).toBe('Title')
    const renamed = panelSchema(
      [
        {
          ...linear,
          schema: { fields: linearSchema.fields.map((f) => (f.id === 'state' ? { ...f, name: 'State' } : f)) },
        },
      ],
      mapped,
    )
    expect(renamed.fields.find((field) => field.id === 'status')?.name).toBe('State')
  })
})

describe('`source` as a panel-local field', () => {
  // A row's source is provenance, not a field, so it becomes a field where fields already grow and
  // every downstream feature works without a chart special case. See docs/dashboards/panels.md § Provenance,
  // and what a row may not claim.

  it('appears on a multi-source panel as an ordinary enum over the panel’s own source keys', () => {
    const field = panelSchema(sources, todoBoard).fields.find((entry) => entry.id === 'source')!
    expect(field.type).toBe('enum')
    expect(field.values).toEqual([
      { id: 'github:pulls-mine', label: 'github' },
      { id: 'linear:issues-mine', label: 'linear' },
    ])
    // No tone anywhere: provenance is identity, not status. github is not "ok" and linear is not
    // "warn". The chart's series ramp colours these; the status vocabulary does not.
    expect(field.values!.every((value) => value.tone === undefined)).toBe(true)
  })

  it('names the collection too where one plugin provides two of the panel’s sources', () => {
    const second: PanelProjectionSource = { pluginId: 'github', sourceId: 'reviews' }
    const field = panelSchema([github, { ...github, source: second }], todoBoard).fields.find(
      (entry) => entry.id === 'source',
    )!
    expect(field.values?.map((value) => value.label)).toEqual(['github · pulls-mine', 'github · reviews'])
  })

  it('does not appear over one source — a split with one value is a no-op nobody should be offered', () => {
    const single = panelSchema([github], { columns: todoColumns })
    expect(single.fields.map((field) => field.id)).not.toContain('source')
    expect(unionRows([github], { columns: todoColumns })[0].values.source).toBeUndefined()
  })

  it('is fed by the host’s stamp on every row, never by a mapping row', () => {
    const united = unionRows(sources, todoBoard)
    expect(united.map((entry) => entry.values.source)).toEqual([
      'github:pulls-mine',
      'github:pulls-mine',
      'linear:issues-mine',
      'linear:issues-mine',
    ])
    // The matrix has no row for it: there is nothing to answer, so nothing is offered.
    expect(panelFieldsFor(todoBoard).map((field) => field.id)).not.toContain('source')
  })

  it('groups, filters and projects like any other enum, with no code that knows what it is', () => {
    const schema = panelSchema(sources, todoBoard)
    const united = unionRows(sources, todoBoard)
    const field = schema.fields.find((entry) => entry.id === 'source')!
    expect(boardColumns(united, field).map((column) => [column.label, column.rows.length])).toEqual([
      ['github', 2],
      ['linear', 2],
    ])
    const onlyLinear = shapeRows(united, schema, {
      filters: [{ field: 'source', op: 'eq', value: 'linear:issues-mine' }],
    })
    expect(onlyLinear.every((entry) => entry.pluginId === 'linear')).toBe(true)
  })
})

describe('the union', () => {
  it('interleaves two providers’ rows by a panel-local datetime — a datetime is a datetime everywhere', () => {
    const schema = panelSchema(sources, todoBoard)
    const sorted = shapeRows(unionRows(sources, todoBoard), schema, { sort: [{ field: 'updated', direction: 'desc' }] })
    expect(ids(sorted)).toEqual([
      'linear:issues-mine:ENG-9', // 400
      'github:pulls-mine:1', //     300
      'linear:issues-mine:ENG-7', // 200
      'github:pulls-mine:2', //     100
    ])
    expect(sorted.map((entry) => entry.pluginId)).toEqual(['linear', 'github', 'linear', 'github'])
  })

  it('qualifies row ids by source, because two providers may both answer “1”', () => {
    const clash: PanelSourcePage = { ...linear, rows: [row(linearQuery, '1', { title: 'Clash', state: 'started' })] }
    const united = unionRows([github, clash], todoBoard)
    expect(new Set(ids(united)).size).toBe(united.length)
  })

  it('carries each row’s panel-local fields from that source’s own field names', () => {
    const united = unionRows(sources, todoBoard)
    const fromLinear = united.find((entry) => entry.pluginId === 'linear')!
    expect(fromLinear.values.title).toBe('Ship the board')
    expect(fromLinear.values.assignee).toBe('grace')
    // `identifier` has no role and therefore no panel-local home, which is the recorded ceiling.
    expect(fromLinear.values.identifier).toBeUndefined()
  })

  it('keeps the row’s declared action, which is what routes a click to the OWNING plugin', () => {
    const withAction: PanelSourcePage = {
      ...github,
      rows: [{ ...github.rows[0], action: { verb: 'openUrl', url: 'https://example.com/1' } }],
    }
    expect(unionRows([withAction, linear], todoBoard)[0].action).toEqual({
      verb: 'openUrl',
      url: 'https://example.com/1',
    })
  })

  it('keeps the task the row named, and the id the plugin gave it, beside the qualified one', () => {
    // The two halves an `openPane` click needs: which task to go to, and which row to select once
    // there. `id` is qualified by source, since two providers may both call a row `1`, so the plugin's
    // own id has to survive separately or the pane is handed an id it has never seen.
    const withTask: PanelSourcePage = {
      ...github,
      rows: [
        {
          ...github.rows[0],
          taskId: '0f1a4d5e-4a0e-4a3c-8f6b-2f5f4b7a1c9d',
          action: { verb: 'openPane', pane: 'agents' },
        },
      ],
    }
    const united = unionRows([withTask, linear], todoBoard)[0]
    expect(united.taskId).toBe('0f1a4d5e-4a0e-4a3c-8f6b-2f5f4b7a1c9d')
    expect(united.sourceRowId).toBe(github.rows[0].id)
    expect(united.id).not.toBe(github.rows[0].id)
  })
})

describe('provenance is the HOST’s stamp and survives the whole pipeline', () => {
  it('cannot be overridden by the response body claiming a different plugin', () => {
    // The typed projection stamps provider identity before the dashboard mapping layer.
    const stamped: PanelSourcePage = {
      ...linear,
      rows: [
        { id: 'ENG-1', values: { title: 'Impostor', state: 'started' }, pluginId: 'linear', sourceId: 'issues-mine' },
      ],
    }
    const united = unionRows([github, stamped], todoBoard)
    const impostor = united.find((entry) => entry.id.endsWith('ENG-1'))!
    expect(impostor.pluginId).toBe('linear')
    expect(impostor.sourceId).toBe('issues-mine')
  })

  it('survives mapping, sorting, limiting and grouping', () => {
    const schema = panelSchema(sources, todoBoard)
    const shaped = shapeRows(unionRows(sources, todoBoard), schema, {
      sort: [{ field: 'updated', direction: 'desc' }],
      limit: 3,
    })
    expect(shaped.every((entry) => entry.pluginId && entry.sourceId)).toBe(true)
    const statusField = schema.fields.find((field) => field.id === 'status')!
    const inColumns = boardColumns(shaped, statusField).flatMap((column) => column.rows)
    expect(inColumns.map((entry) => entry.pluginId).sort()).toEqual(['github', 'linear', 'linear'])
  })
})

describe('value mapping onto the user’s own columns', () => {
  it('puts each provider’s statuses in the column the user chose', () => {
    expect(mappedColumnId(todoBoard, 'github:pulls-mine', 'open')).toBe('c2')
    expect(mappedColumnId(todoBoard, 'linear:issues-mine', 'started')).toBe('c2')
    expect(mappedColumnId(todoBoard, 'linear:issues-mine', 'completed')).toBe('c4')
    expect(mappedColumnId(todoBoard, 'github:pulls-mine', 'draft')).toBeUndefined()
  })

  it('draws the four columns the user invented, in their order, empty ones included', () => {
    const schema = panelSchema(sources, todoBoard)
    const statusField = schema.fields.find((field) => field.id === 'status')!
    const columns = boardColumns(unionRows(sources, todoBoard), statusField)
    expect(columns.map((column) => column.label)).toEqual(['Todo', 'Doing', 'Waiting', 'Done'])
    expect(columns.map((column) => column.tone)).toEqual(['muted', 'accent', 'warn', 'ok'])
    expect(columns.every((column) => column.declared)).toBe(true)
    // Doing holds one row from each provider, which is the scenario.
    expect(columns[1].rows.map((entry) => entry.pluginId).sort()).toEqual(['github', 'linear'])
  })

  it('sends an unmapped value to the catch-all rather than dropping it', () => {
    const withDraft: PanelSourcePage = {
      ...github,
      rows: [...github.rows, row(githubQuery, '3', { title: 'Half done', status: 'draft', updated: 50 })],
    }
    const schema = panelSchema([withDraft, linear], todoBoard)
    const statusField = schema.fields.find((field) => field.id === 'status')!
    const columns = boardColumns(unionRows([withDraft, linear], todoBoard), statusField)
    const catchAll = columns.find((column) => column.id === UNGROUPED_COLUMN_ID)
    expect(catchAll?.rows.map((entry) => entry.id)).toEqual(['github:pulls-mine:3'])
    // Every row still lands somewhere, the rule inherited from `boardColumns` rather than re-derived.
    expect(columns.reduce((total, column) => total + column.rows.length, 0)).toBe(5)
  })

  it('hides an unmapped value only when that destination was declared', () => {
    const withDraft: PanelSourcePage = {
      ...github,
      rows: [...github.rows, row(githubQuery, '3', { title: 'Half done', status: 'draft', updated: 50 })],
    }
    const hidden = unionRows([withDraft, linear], { ...todoBoard, unmapped: 'hidden' })
    expect(ids(hidden)).not.toContain('github:pulls-mine:3')
    expect(hidden).toHaveLength(4)
  })

  it('moves a value between columns rather than leaving it in both', () => {
    const moved = withMappedValue(todoBoard, 'github:pulls-mine', 'open', 'c4')
    expect(mappedColumnId(moved, 'github:pulls-mine', 'open')).toBe('c4')
    expect(moved.bySource?.['github:pulls-mine'].c2).toBeUndefined()
    // And the other source is untouched.
    expect(moved.bySource?.['linear:issues-mine']).toEqual(todoBoard.bySource?.['linear:issues-mine'])
  })

  it('keeps a reserved writeValue when the values under it are emptied', () => {
    // Nothing writes it yet, and the shape has to survive being edited or it isn't reserved at all.
    const reserved: PanelMapping = {
      columns: todoColumns,
      bySource: { 'github:pulls-mine': { c4: { values: ['ready'], writeValue: 'merged' } } },
    }
    const cleared = withMappedValue(reserved, 'github:pulls-mine', 'ready', undefined)
    expect(cleared.bySource?.['github:pulls-mine'].c4).toEqual({ writeValue: 'merged' })
  })
})

describe('the value-mapping suggestion', () => {
  it('has nothing to offer for a source whose values are not known yet', () => {
    // A collection that describes itself in its answer and has not been read: no declared values, so no
    // matrix rows. The editor says so rather than showing an empty one.
    const cold: PanelSourcePage = { source: linearQuery, schema: { fields: [] }, rows: [] }
    expect(statusValuesOf(cold, undefined)).toEqual([])
    expect(statusValuesOf(linear, undefined).map((value) => value.label)).toEqual(['Todo', 'In progress', 'Done'])
  })
})

describe('the fields the user invented', () => {
  // The case the role ceiling was recorded against: github's `repo` and linear's `identifier` are both
  // text, both useful on a mixed board, and neither carries a role.
  const withRef: PanelMapping = {
    ...todoBoard,
    extraFields: [{ id: 'ref', label: 'Ref', type: 'text' }],
    fields: {
      'github:pulls-mine': { ref: 'repo' },
      'linear:issues-mine': { ref: 'identifier' },
    },
  }

  it('engages the mapping layer even over one source', () => {
    expect(isMapped([githubQuery], { extraFields: [{ id: 'ref', label: 'Ref', type: 'text' }] })).toBe(true)
    expect(isMapped([githubQuery], {})).toBe(false)
  })

  it('appears in the panel schema after the five roles, with the type the user chose', () => {
    const fields = panelSchema(sources, withRef).fields
    expect(fields.map((field) => field.id)).toEqual(['title', 'status', 'assignee', 'updated', 'url', 'ref', 'source'])
    expect(fields.find((field) => field.id === 'ref')).toEqual({ id: 'ref', name: 'Ref', type: 'text' })
  })

  it('is populated per source from the field each one was pointed at', () => {
    const rows = unionRows(sources, withRef)
    expect(rows.map((entry) => entry.values.ref)).toEqual(['acme/app', 'acme/app', 'ENG-7', 'ENG-9'])
  })

  it('has no role to fall back on, so an unanswered source leaves it empty rather than guessing', () => {
    const guessless: PanelMapping = { ...withRef, fields: { 'github:pulls-mine': { ref: 'repo' } } }
    expect(sourceFieldFor(linear, 'ref', guessless)).toBeUndefined()
    expect(unionRows(sources, guessless).map((entry) => entry.values.ref)).toEqual([
      'acme/app',
      'acme/app',
      undefined,
      undefined,
    ])
  })

  it('sorts and filters through the ordinary shaping layer, with no second path', () => {
    const rows = shapeRows(unionRows(sources, withRef), panelSchema(sources, withRef), {
      filters: [{ field: 'ref', op: 'contains', value: 'ENG' }],
    })
    expect(ids(rows)).toEqual(['linear:issues-mine:ENG-7', 'linear:issues-mine:ENG-9'])
  })
})

describe('partial availability', () => {
  it('renders one source’s rows when the other answered with nothing', () => {
    // What a failed source looks like to this layer: an empty page. The run reports why separately, as a
    // `SourceFailure` problem, so the panel says which source is missing and still draws the rest rather
    // than blanking.
    const down: PanelSourcePage = { ...linear, rows: [] }
    const united = unionRows([github, down], todoBoard)
    expect(united.map((entry) => entry.pluginId)).toEqual(['github', 'github'])

    const schema = panelSchema([github, down], todoBoard)
    const statusField = schema.fields.find((field) => field.id === 'status')!
    // The user's columns are still all four, because they belong to the panel rather than to a source.
    expect(boardColumns(united, statusField).map((column) => column.label)).toEqual([
      'Todo',
      'Doing',
      'Waiting',
      'Done',
    ])
  })

  it('keeps a source’s own field mapping usable when it answered with no schema at all', () => {
    const cold: PanelSourcePage = { source: linearQuery, schema: { fields: [] }, rows: [] }
    // `source` survives a source that answered with nothing: it is the host's stamp rather than
    // anything the source has to be able to fill, so it names both either way.
    expect(panelSchema([github, cold], todoBoard).fields.map((field) => field.id)).toEqual([
      'title',
      'status',
      'assignee',
      'updated',
      'url',
      'source',
    ])
    expect(unionRows([github, cold], todoBoard)).toHaveLength(2)
  })
})
