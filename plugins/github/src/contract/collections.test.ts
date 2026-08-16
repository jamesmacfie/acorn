import { describe, expect, it } from 'vitest'
import { pluginCollectionResponseSchema } from '@acorn/protocol/collections.ts'
import { pullsCollectionPage, pullStatus, type PullCollectionSource } from './collections'

const pull = (over: Partial<PullCollectionSource> = {}): PullCollectionSource => ({
  owner: 'acme',
  repo: 'web',
  number: 42,
  title: 'Fix the checkout',
  draft: false,
  author: 'ada',
  updatedAt: 1_700_000_000_000,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  autoMergeEnabled: false,
  ...over,
})

describe('github pull requests as a collection', () => {
  it('answers a page the host schema accepts', () => {
    // Half of the phase-1 acceptance test: one field vocabulary has to fit both providers. This is the
    // GitHub half; plugins/linear/src/shared/collections.test.ts is the other.
    const parsed = pluginCollectionResponseSchema.safeParse(pullsCollectionPage([pull()]))
    expect(parsed.success).toBe(true)
  })

  it('exercises every one of the seven field types from one provider', () => {
    // Not decoration: a type nobody fills is a rendering rule nobody has checked, and the whole budget
    // argument rests on each of the seven earning its place. `duration` and `badge` are absent because
    // neither provider needed them.
    const types = pullsCollectionPage([pull()]).schema.fields.map((field) => field.type)
    expect([...new Set(types)].sort())
      .toEqual(['boolean', 'datetime', 'enum', 'link', 'number', 'person', 'text'])
  })

  it('folds three mirror columns into the one status the vocabulary allows', () => {
    // GitHub says "what state is this PR in" three times — `state`, `draft` and `mergeStateStatus` —
    // and the wire allows one enum per field. Deciding what a status IS is the plugin's job, and it
    // reads better than the mirror does.
    expect(pullStatus(pull({ draft: true, mergeStateStatus: 'CLEAN' }))).toBe('draft')
    expect(pullStatus(pull({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }))).toBe('conflicts')
    expect(pullStatus(pull({ mergeStateStatus: 'BLOCKED' }))).toBe('blocked')
    expect(pullStatus(pull({ mergeStateStatus: 'BEHIND' }))).toBe('behind')
    expect(pullStatus(pull({ mergeStateStatus: 'UNSTABLE' }))).toBe('unstable')
    expect(pullStatus(pull({ mergeStateStatus: 'CLEAN' }))).toBe('ready')
    // Silence is not "mergeable". A repo whose PR detail has never been fetched holds no merge state,
    // and inventing `ready` from that would tell someone a branch is safe when nothing has checked.
    expect(pullStatus(pull({ mergeable: null, mergeStateStatus: null }))).toBe('open')

    const declared = pullsCollectionPage([]).schema.fields.find((field) => field.role === 'status')
    expect(declared?.values?.map((value) => value.id))
      .toEqual(['draft', 'open', 'unstable', 'behind', 'blocked', 'conflicts', 'ready'])
  })

  it('keys a row by repository as well as number', () => {
    // A board mixing two repositories dedupes by row id, and PR #42 exists in both of them.
    const [row] = pullsCollectionPage([pull()]).rows
    expect(row?.id).toBe('acme/web#42')
    expect(row?.action).toEqual({ verb: 'openUrl', url: 'https://github.com/acme/web/pull/42' })
  })
})
