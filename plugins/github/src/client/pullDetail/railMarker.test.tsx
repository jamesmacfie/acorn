import { createEffect, createRoot } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/plugin-api/client'
import type { Check, Pull, PullDetail, Review } from '../../shared/api'

const seams = vi.hoisted(() => ({
  task: undefined as Partial<Task> | undefined,
  routes: [] as string[],
  detail: undefined as unknown,
}))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  taskById: () => seams.task,
  readJson: async (route: string) => {
    seams.routes.push(route)
    return seams.detail
  },
  onPluginFrame: () => () => {},
}))

const { _resetPullMarkers, prRailMarkerContribution, pullMarkers } = await import('./railMarker')

const pull = (over: Partial<Pull> = {}): PullDetail['pull'] => ({
  number: 7,
  title: 'Fix it',
  state: 'open',
  draft: false,
  author: 'dana',
  headRef: 'fix',
  baseRef: 'main',
  updatedAt: null,
  mergeable: 'MERGEABLE',
  mergeStateStatus: null,
  autoMergeEnabled: false,
  body: null,
  headSha: null,
  ...over,
})
const check = (status: string): Check => ({ name: status, status, url: null, runId: null })
const review = (author: string, state: string, submittedAt = 1): Review => ({
  id: `${author}-${state}`,
  author,
  state,
  body: null,
  submittedAt,
})
const detail = (over: Partial<PullDetail> = {}): PullDetail => ({
  pull: pull(),
  labels: [],
  reviews: [],
  requestedReviewers: [],
  comments: [],
  commits: [],
  checks: [],
  threads: [],
  ...over,
})
const byId = (markers: ReturnType<typeof pullMarkers>) => Object.fromEntries(markers.map((m) => [m.id, m]))

describe('pullMarkers', () => {
  it('gives an open pull with no checks and no decision no marks at all', () => {
    expect(pullMarkers(detail())).toEqual([])
  })

  it('rolls the checks up to one dot in the top right, pulsing while any still run', () => {
    expect(byId(pullMarkers(detail({ checks: [check('success')] }))).checks).toMatchObject({
      dotTone: 'ok',
      busy: false,
      placements: ['top-end'],
    })
    expect(byId(pullMarkers(detail({ checks: [check('failure'), check('failure')] }))).checks).toMatchObject({
      dotTone: 'bad',
      label: '2 checks failing',
    })
    expect(byId(pullMarkers(detail({ checks: [check('in_progress')] }))).checks).toMatchObject({
      dotTone: 'warn',
      busy: true,
    })
    expect(byId(pullMarkers(detail({ checks: [check('failure'), check('queued')] }))).checks).toMatchObject({
      dotTone: 'mixed',
      busy: true,
    })
  })

  it('names the reviewers behind the decision in the bottom right', () => {
    expect(
      byId(pullMarkers(detail({ reviews: [review('alice', 'APPROVED'), review('bob', 'APPROVED')] }))).review,
    ).toMatchObject({ icon: 'check', label: 'Approved by alice, bob', placements: ['bottom-end'] })
    expect(
      byId(pullMarkers(detail({ reviews: [review('alice', 'APPROVED'), review('carol', 'CHANGES_REQUESTED')] })))
        .review,
    ).toMatchObject({ icon: 'file-diff', tone: 'warn', label: 'Changes requested by carol' })
    expect(byId(pullMarkers(detail({ reviews: [review('erin', 'COMMENTED')] }))).review).toBeUndefined()
  })

  it('warns about conflicts with the base branch in the bottom left', () => {
    expect(byId(pullMarkers(detail({ pull: pull({ mergeable: 'CONFLICTING' }) }))).conflicts).toMatchObject({
      icon: 'triangle-alert',
      tone: 'danger',
      label: 'Merge conflicts with main',
      placements: ['bottom-start'],
    })
  })

  it('marks a draft in the top left alongside its other marks', () => {
    const marks = byId(pullMarkers(detail({ pull: pull({ draft: true }), checks: [check('success')] })))
    expect(marks.state).toMatchObject({ icon: 'git-pull-request-draft', label: 'Draft', placements: ['top-start'] })
    expect(marks.checks).toBeDefined()
  })

  it('shows only the state mark once the pull is merged or closed', () => {
    const busy = {
      checks: [check('failure')],
      reviews: [review('carol', 'CHANGES_REQUESTED')],
    }
    expect(pullMarkers(detail({ ...busy, pull: pull({ state: 'merged', mergeable: 'CONFLICTING' }) }))).toEqual([
      { id: 'state', label: 'Merged', icon: 'git-merge', tone: 'accent', placements: ['top-start'] },
    ])
    expect(pullMarkers(detail({ ...busy, pull: pull({ state: 'closed', draft: true }) }))).toEqual([
      { id: 'state', label: 'Closed', icon: 'git-pull-request-closed', placements: ['top-start'] },
    ])
  })
})

describe('prRailMarkerContribution', () => {
  let dispose = () => {}
  afterEach(() => {
    dispose()
    _resetPullMarkers()
    seams.routes = []
  })

  it('answers nothing, and reads nothing, for any target but the PR pane of a task with a pull', () => {
    seams.task = { id: 't1', github: { owner: 'acme', name: 'app' }, pullNumber: 7 } as Partial<Task>
    expect(prRailMarkerContribution.markers({ kind: 'task', id: 't1' })).toEqual([])
    expect(prRailMarkerContribution.markers({ kind: 'source', id: 'github' })).toEqual([])
    expect(prRailMarkerContribution.markers({ kind: 'pane', id: 'git', taskId: 't1' })).toEqual([])
    seams.task = { id: 't2', github: null, pullNumber: null } as Partial<Task>
    expect(prRailMarkerContribution.markers({ kind: 'pane', id: 'pr', taskId: 't2' })).toEqual([])
    expect(seams.routes).toEqual([])
  })

  it('reads the pull once and draws its marks when the answer lands', async () => {
    seams.task = { id: 't1', github: { owner: 'acme', name: 'app' }, pullNumber: 7 } as Partial<Task>
    seams.detail = detail({ checks: [check('failure')] })
    let ids: string[] = []
    createRoot((done) => {
      dispose = done
      createEffect(() => {
        ids = prRailMarkerContribution.markers({ kind: 'pane', id: 'pr', taskId: 't1' }).map((m) => m.id)
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ids).toEqual(['checks'])
    expect(seams.routes).toHaveLength(1)
  })
})
