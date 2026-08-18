import { describe, expect, it } from 'vitest'
import { pluginCollectionResponseSchema } from '@acorn/protocol/collections.ts'
import { parsePullInvolvement, pullsCollectionPage, pullsSearchQuery, pullStatus, type PullCollectionSource } from './collections'

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

  it('asks GitHub who "me" is instead of storing it', () => {
    // `@me` is why neither the route nor the mirror needs the connected login: GitHub resolves it against
    // the token, so the answer follows a reconnection without a migration.
    expect(pullsSearchQuery('review-requested')).toBe('is:pr is:open archived:false review-requested:@me')
    expect(pullsSearchQuery('assigned')).toBe('is:pr is:open archived:false assignee:@me')
    expect(pullsSearchQuery('authored')).toBe('is:pr is:open archived:false author:@me')
  })

  it('lets the repo param narrow the search, and refuses anything that is not one', () => {
    expect(pullsSearchQuery('assigned', 'acme/web')).toContain('repo:acme/web')
    // The guard that matters: this string is interpolated into a query GitHub parses, so a space would
    // otherwise smuggle in a second qualifier. Dropped means "search wider", never "search elsewhere".
    expect(pullsSearchQuery('assigned', 'acme/web is:draft')).not.toContain('repo:')
    expect(pullsSearchQuery('assigned', 'acme')).not.toContain('repo:')
    expect(pullsSearchQuery('assigned', '')).not.toContain('repo:')
  })

  it('reads several involvements from one param, and drops what it does not know', () => {
    // The param is a comma-joined set because "assigned to me OR waiting on my review" is one question
    // and GitHub's qualifiers only AND — so the route runs one search per entry and unions them.
    expect(parsePullInvolvement('assigned,review-requested')).toEqual(['review-requested', 'assigned'])
    // Declaration order out, whatever order they were ticked in: one set of choices is one query string,
    // so two panels with the same answer share a cache key.
    expect(parsePullInvolvement('authored,review-requested')).toEqual(['review-requested', 'authored'])
    // A param is opaque to the host and a saved panel outlives this build, so an unknown entry is
    // dropped and an empty list falls back to the mirror read rather than erroring.
    expect(parsePullInvolvement('mentioned')).toEqual([])
    expect(parsePullInvolvement('assigned,mentioned')).toEqual(['assigned'])
    expect(parsePullInvolvement('')).toEqual([])
  })

  it('keys a row by repository as well as number', () => {
    // A board mixing two repositories dedupes by row id, and PR #42 exists in both of them.
    const [row] = pullsCollectionPage([pull()]).rows
    expect(row?.id).toBe('acme/web#42')
    expect(row?.action).toEqual({ verb: 'openUrl', url: 'https://github.com/acme/web/pull/42' })
  })
})
