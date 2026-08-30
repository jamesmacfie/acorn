import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contentLinkRegistry, type Task } from '@acorn/plugin-api/client'
import type { Pull, PullDetail, TaskPullRelation } from '../../shared/api'
import { githubContentLinkContributions } from '../contentLinks'
import { buildTaskPullTabs, pullRefKey, taskPullTabTooltip } from './taskPullTabs'

const primary = { owner: 'Acme', repo: 'Widget', number: '100' }
const task = {
  id: 'task-current', title: 'Current', pullNumber: 100, github: { owner: 'acme', name: 'widget' }, links: [],
} as unknown as Task
const pull = (number: number, headRef: string, baseRef: string): Pull => ({
  number, title: `Pull ${number}`, state: 'open', draft: false, author: null, headRef, baseRef,
  updatedAt: null, mergeable: null, mergeStateStatus: null, autoMergeEnabled: false,
})
const detail = {
  pull: { ...pull(100, 'feature', 'main'), body: '<p>See https://github.com/acme/widget/pull/101 and https://github.com/Other/Repo/pull/7</p>', headSha: 'sha' },
  labels: [], requestedReviewers: [], commits: [], checks: [], threads: [], reviews: [],
  comments: [{ id: 'c1', author: null, body: 'Also https://github.com/acme/widget/pull/250', createdAt: null }],
} satisfies PullDetail

let dispose: Array<() => void> = []
beforeAll(() => { dispose = githubContentLinkContributions.map((item) => contentLinkRegistry.register(item).dispose) })
afterAll(() => dispose.forEach((fn) => fn()))

describe('task pull tabs', () => {
  it('combines durable, stack, mention, task, and agent evidence without duplicating pulls', () => {
    const relations: TaskPullRelation[] = [{
      pull: { owner: 'acme', repo: 'widget', number: '150' }, role: 'related', provenance: 'agent',
      sessionId: 'session-1', requestId: 'request-1',
    }]
    const linkedTask = {
      id: 'task-child', title: 'Child task', pullNumber: 101, github: { owner: 'ACME', name: 'WIDGET' }, links: [],
    } as unknown as Task
    const tabs = buildTaskPullTabs({
      task,
      primary,
      relations,
      openPulls: [
        pull(100, 'feature', 'main'),
        pull(101, 'follow-up', 'feature'),
        pull(102, 'final', 'follow-up'),
        pull(99, 'main', 'release'),
        pull(300, 'unrelated', 'other'),
      ],
      primaryDetail: detail,
      tasks: [task, linkedTask],
    })
    const byKey = new Map(tabs.map((tab) => [pullRefKey(tab.pull), tab]))

    expect(tabs[0].relationship).toBe('primary')
    expect(byKey.get('acme/widget#150')).toMatchObject({
      relationship: 'related',
      creatingAgent: { taskId: 'task-current', sessionId: 'session-1', requestId: 'request-1' },
    })
    expect(byKey.get('acme/widget#101')).toMatchObject({
      relationship: 'discovered',
      linkedTasks: [{ id: 'task-child', title: 'Child task' }],
    })
    expect(byKey.get('acme/widget#101')?.evidence).toEqual(expect.arrayContaining([
      { kind: 'stack', anchorPullNumber: 100, direction: 'child' },
      { kind: 'mention', sourcePullNumber: 100, surface: 'description' },
    ]))
    expect(byKey.get('acme/widget#102')?.evidence).toContainEqual({ kind: 'stack', anchorPullNumber: 101, direction: 'child' })
    expect(byKey.get('acme/widget#99')?.evidence).toContainEqual({ kind: 'stack', anchorPullNumber: 100, direction: 'parent' })
    expect(byKey.get('other/repo#7')?.evidence).toContainEqual({ kind: 'mention', sourcePullNumber: 100, surface: 'description' })
    expect(byKey.get('acme/widget#250')?.evidence).toContainEqual({ kind: 'mention', sourcePullNumber: 100, surface: 'comment' })
    expect(byKey.has('acme/widget#300')).toBe(false)
    expect(taskPullTabTooltip(byKey.get('acme/widget#101')!, task.id)).toContain('Open in Child task')
  })

  it('keeps a pane intent as a discovered tab even before GitHub evidence is cached', () => {
    const tabs = buildTaskPullTabs({
      task, primary, relations: [], openPulls: [], tasks: [task],
      selectedIntent: { owner: 'acme', repo: 'widget', number: '404' },
    })
    expect(tabs.map((tab) => pullRefKey(tab.pull))).toEqual(['acme/widget#100', 'acme/widget#404'])
  })
})
