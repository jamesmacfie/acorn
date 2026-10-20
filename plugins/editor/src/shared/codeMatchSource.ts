import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { EDITOR_FILE_TARGET } from './fileTarget'

// One record per ripgrep match in the project folders in scope (docs/editor/find-in-files.md).

/** The longest matched line a record keeps. */
export const MATCH_TEXT_CHARS = 200

const EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'md',
  'css',
  'scss',
  'html',
  'vue',
  'svelte',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'cs',
  'php',
  'sh',
  'sql',
  'yml',
  'yaml',
  'toml',
]

const fields: (Omit<DataSourceDescription['fields'][number], 'pointer' | 'origin'> & {
  key: string
  type: 'string' | 'number'
})[] = [
  { key: 'project', type: 'string', label: 'Project' },
  { key: 'projectName', type: 'string', label: 'Project name' },
  { key: 'path', type: 'string', label: 'File', display: { kind: 'text', role: 'title' } },
  {
    key: 'folder',
    type: 'string',
    label: 'Folder',
    description: "The file's first two folders in its project, or . for the project folder itself.",
  },
  {
    key: 'extension',
    type: 'string',
    label: 'File type',
    description: 'The file name extension without its dot, or empty when it has none.',
    display: { kind: 'enum' },
    query: { operators: ['eq', 'in'], sortable: false },
    choices: { kind: 'static', values: EXTENSIONS.map((id) => ({ id, label: id })) },
  },
  { key: 'line', type: 'number', label: 'Line', display: { kind: 'number' } },
  {
    key: 'text',
    type: 'string',
    label: 'Text',
    description: `The matched line, cut to ${MATCH_TEXT_CHARS} characters.`,
  },
]

const source: PanelPlan['sources'][number] = {
  id: 'matches',
  label: 'Code matches',
  role: 'primary',
  reference: {
    kind: 'inline',
    bindings: {},
    content: {
      name: 'Code matches',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      sourceParameters: {},
      // The person changes the pattern; TODO is the question asked most.
      query: {
        source: { pluginId: 'editor', sourceId: 'code-matches' },
        scope: { parameters: { pattern: 'TODO' } },
        sort: [],
      },
    },
  },
}
const column = (
  id: string,
  label: string,
  type: PanelPlan['columns'][number]['type'],
): PanelPlan['columns'][number] => ({
  id,
  label,
  type,
  bind: { matches: { field: `/${id}` } },
})
const plan = (title: string, rest: Omit<PanelPlan, 'version' | 'title' | 'time' | 'sources'>): PanelPlan => ({
  version: 2,
  title,
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [source],
  ...rest,
})
const countBy = (
  id: string,
  label: string,
  type: PanelPlan['columns'][number]['type'],
): Omit<PanelPlan, 'version' | 'title' | 'time' | 'sources'> => ({
  columns: [column(id, label, type)],
  stages: [{ op: 'summarize', by: [{ column: id }], measures: [{ id: 'matches', label: 'Matches', kind: 'count' }] }],
  sort: [{ column: 'matches', direction: 'desc' }],
  view: { kind: 'chart', shape: 'bar', x: id, aggregate: 'sum', field: 'matches' },
})

const codeMatchStarterPlans: PanelPlan[] = [
  plan('Matches by folder', countBy('folder', 'Folder', 'text')),
  plan('Matches by file type', countBy('extension', 'File type', 'enum')),
  plan('Every match', {
    columns: [
      column('path', 'File', 'text'),
      column('line', 'Line', 'number'),
      column('text', 'Text', 'text'),
      column('projectName', 'Project', 'text'),
    ],
    stages: [],
    view: { kind: 'list' },
    actions: { press: { kind: 'record', prefer: 'pane' }, buttons: [] },
  }),
]

export const codeMatchSourceDescription: DataSourceDescription = {
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(fields.map(({ key, type }) => [key, { type }])),
    required: fields.map(({ key }) => key),
  },
  fields: fields.map(({ key, type: _type, ...field }) => ({
    pointer: `/${key}`,
    origin: 'declared' as const,
    ...field,
  })),
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pattern: { type: 'string' },
      regex: { type: 'boolean' },
      glob: { type: 'string' },
      caseSensitive: { type: 'boolean' },
    },
    required: ['pattern'],
  },
  parameterFields: [
    {
      pointer: '/pattern',
      label: 'Pattern',
      description: 'The text to find, such as TODO. It is a regular expression only when Regular expression is on.',
      origin: 'declared',
    },
    { pointer: '/regex', label: 'Regular expression', origin: 'declared' },
    {
      pointer: '/glob',
      label: 'File names',
      description: 'Search only files whose name matches this glob, such as *.ts or *.{ts,tsx}.',
      origin: 'declared',
    },
    { pointer: '/caseSensitive', label: 'Match case', origin: 'declared' },
  ],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all', 'any'] },
  coverage: { kind: 'snapshot' },
  starterPlans: codeMatchStarterPlans,
  targets: [{ kind: EDITOR_FILE_TARGET }],
  consistency: `One row per match of the pattern in the project folders in scope, read from disk when the panel runs, skipping what .gitignore lists and hidden files. Each row holds the matched line, cut to ${MATCH_TEXT_CHARS} characters: code already on this device. A read stops at 5,000 matches or 30 seconds, newest-modified files first, and then says it is incomplete.`,
}
