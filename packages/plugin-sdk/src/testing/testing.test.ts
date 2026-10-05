import { expect, it } from 'vitest'
import { defineDerivedSource, field } from '../data/index.ts'
import type * as Published from './public.ts'
import * as testing from './index.ts'
import { fixtures, testDerivedSource } from './index.ts'

type Mutual<A, B> = [A extends B ? true : never, B extends A ? true : never]
const _test: Mutual<typeof testing.testDerivedSource, typeof Published.testDerivedSource> = [true, true]
const _fixtures: Mutual<typeof testing.fixtures, typeof Published.fixtures> = [true, true]
void [_test, _fixtures]

const readiness = defineDerivedSource({
  id: 'readiness', name: 'Release readiness', singular: 'Issue', plural: 'Issues', handler: '/v1/p/release/readiness',
  inputs: { issues: { source: 'linear:issues', label: 'Issues' }, pulls: { source: 'github:pull-requests', label: 'Pull requests', optional: true } },
  fields: {
    title: field.text({ label: 'Issue', role: 'title' }),
    readiness: field.choice({ label: 'Readiness', role: 'status', choices: [
      { id: 'ready', label: 'Ready', tone: 'ok' }, { id: 'at-risk', label: 'At risk', tone: 'warn' }, { id: 'unknown', label: 'Unknown', tone: 'muted' }] }),
  },
  async query({ inputs }) {
    const issues = await inputs.issues.all()
    const pulls = await inputs.pulls?.all({ where: { state: 'open' } })
    return issues.records.map(issue => {
      const key = String(issue.data.identifier).toLowerCase()
      const pull = pulls?.records.find(record => String(record.data.headBranch).includes(key))
      return { id: issue.ref.recordId, opens: (pull ?? issue).ref,
        data: { title: String(issue.data.title), readiness: !pulls ? 'unknown' as const : pull?.data.draft === false ? 'ready' as const : 'at-risk' as const } }
    })
  },
})

it('builds input records from the real field list, with typed defaults', () => {
  const [pull] = fixtures('github:pull-requests', [{ number: 7, headBranch: 'jm/eng-1-fix' }])
  expect(pull?.ref).toEqual({ pluginId: 'github', sourceId: 'pull-requests', recordId: 'pull-requests-1' })
  expect(pull?.data).toMatchObject({ number: 7, headBranch: 'jm/eng-1-fix', title: '', draft: false, labels: [], url: 'https://example.test/pull-requests/1' })
  expect(pull?.action).toEqual({ verb: 'openUrl', url: 'https://example.test/pull-requests/1' })
  // A nested object keeps the defaults beside the fields a test sets.
  expect(fixtures('linear:issues', [{ state: { name: 'Done' } }])[0]?.data.state).toMatchObject({ name: 'Done' })
})

it('names a field the source does not have, and the one it probably meant', () => {
  expect(() => fixtures('github:pull-requests', [{ head_branch: 'x' }]))
    .toThrow('GitHub pull requests have no field `head_branch`. Did you mean `headBranch`?')
  expect(() => fixtures('github:pull-requests', [{ zzz: 1 }])).toThrow(/^GitHub pull requests have no field `zzz`\.$/)
  expect(() => fixtures('github:pull-requests', [{ number: 'seven' }])).toThrow('GitHub pull requests record 1: Value does not match number')
  expect(() => fixtures('someone:else', [])).toThrow(/no field list for someone:else/)
})

it('runs the logic over fake inputs, with an optional input skipped or given', async () => {
  const issues = fixtures('linear:issues', [{ identifier: 'ENG-1', title: 'Fix it' }, { identifier: 'ENG-2', title: 'Ship it' }])
  const skipped = await testDerivedSource(readiness, { issues })
  expect(skipped.rows.map(row => row.data.readiness)).toEqual(['unknown', 'unknown'])
  expect(skipped.rows[0]?.action).toEqual({ verb: 'openUrl', url: 'https://example.test/issues/1' })

  const pulls = fixtures('github:pull-requests', [
    { headBranch: 'jm/eng-1-fix', state: 'open', url: 'https://github.test/pull/1' },
    { headBranch: 'jm/eng-2-ship', state: 'closed' }])
  const given = await testDerivedSource(readiness, { issues, pulls })
  expect(given.rows).toMatchObject([
    { id: 'issues-1', data: { title: 'Fix it', readiness: 'ready' }, action: { verb: 'openUrl', url: 'https://github.test/pull/1' } },
    // The closed pull request didn't pass `where`, so the second issue has no match.
    { id: 'issues-2', data: { readiness: 'at-risk' } }])
  expect(given).toMatchObject({ dropped: [], completeness: { kind: 'complete' } })
})

it('drops records the app would drop, and refuses a filter the real input could not run', async () => {
  const sloppy = defineDerivedSource({ ...readiness.definition, query: async ({ inputs }) =>
    (await inputs.issues.all()).records.map(issue => ({ id: issue.ref.recordId, data: { title: issue.data.title, readiness: 'ready' } as never })) })
  const issues = fixtures('linear:issues', [{ title: 'Fine' }, {}])
  issues[1] = { ...issues[1]!, data: { ...issues[1]!.data, title: null } }
  expect(await testDerivedSource(sloppy, { issues })).toMatchObject({ rows: [{ id: 'issues-1' }],
    dropped: [{ id: 'issues-2', reason: 'Value does not match string' }], completeness: { kind: 'incomplete', cause: 'invalid-records', count: 1 } })

  const filtered = defineDerivedSource({ ...readiness.definition, query: async ({ inputs }) => {
    await inputs.issues.all({ where: { title: 'Fine' } })
    return []
  } })
  await expect(testDerivedSource(filtered, { issues })).rejects.toThrow("Linear issues can't be filtered on /title")
  await expect(testDerivedSource(readiness, {} as never)).rejects.toThrow('testDerivedSource needs records for the input issues')
})
