import { describe, expect, it } from 'vitest'
import type { BridgePageTask } from '@acorn/protocol/extensionBridge.ts'
import { appTask, pageTasks } from './taskPages'

const pr: BridgePageTask = {
  id: 't1',
  title: 'Fix billing rounding',
  branch: 'fix/billing-rounding',
  projectId: 'p1',
  pages: [{ origin: 'https://github.com', pathPrefix: '/acme/runn/pull/482', source: 'github' }],
}
const issue: BridgePageTask = {
  id: 't2',
  title: 'Linear issue',
  branch: null,
  projectId: 'p1',
  pages: [{ origin: 'https://linear.app', pathPrefix: '/acme/issue/ENG-42/fix-it', source: 'linear' }],
}
const tasks = [pr, issue]
const matched = (url: string | undefined) => pageTasks(tasks, url).map(({ task, page }) => `${task.id}:${page.source}`)

describe('pages matched to tasks', () => {
  it("matches a task's exact address, with a trailing slash, a query, or a fragment", () => {
    expect(matched('https://github.com/acme/runn/pull/482')).toEqual(['t1:github'])
    expect(matched('https://github.com/acme/runn/pull/482/')).toEqual(['t1:github'])
    expect(matched('https://github.com/acme/runn/pull/482?w=1#discussion_r1')).toEqual(['t1:github'])
    expect(matched('https://linear.app/acme/issue/ENG-42/fix-it')).toEqual(['t2:linear'])
  })

  it("matches a pull request's tabs, and no other pull request", () => {
    expect(matched('https://github.com/acme/runn/pull/482/files')).toEqual(['t1:github'])
    expect(matched('https://github.com/acme/runn/pull/482/checks?check_run_id=9')).toEqual(['t1:github'])
    expect(matched('https://github.com/acme/runn/pull/4821')).toEqual([])
    expect(matched('https://github.com/acme/runn/pull/48')).toEqual([])
    expect(matched('https://github.com/acme/runn/pulls')).toEqual([])
  })

  it("matches a pull request under another capitalisation of its repository, and only GitHub's", () => {
    expect(matched('https://github.com/Acme/Runn/pull/482')).toEqual(['t1:github'])
    expect(matched('https://github.com/ACME/runn/pull/482/files')).toEqual(['t1:github'])
    expect(matched('https://github.com/Acme/Runn/pull/4821')).toEqual([])
    expect(matched('https://linear.app/ACME/issue/ENG-42/fix-it')).toEqual([])
  })

  it('matches any code host the Node marks, whatever the case of its path', () => {
    const page = { origin: 'https://gitlab.test', pathPrefix: '/group/repo/-/merge_requests/12', source: 'gitlab-test' }
    const mr: BridgePageTask = { ...issue, id: 't3', pages: [{ ...page, caseInsensitive: true }] }
    const unmarked: BridgePageTask = { ...issue, id: 't4', pages: [page] }
    const ids = (url: string) => pageTasks([mr, unmarked], url).map(({ task }) => task.id)
    expect(ids('https://gitlab.test/Group/Repo/-/merge_requests/12')).toEqual(['t3'])
    expect(ids('https://gitlab.test/group/repo/-/merge_requests/12/diffs')).toEqual(['t3', 't4'])
  })

  it('needs the exact origin', () => {
    expect(matched('http://github.com/acme/runn/pull/482')).toEqual([])
    expect(matched('https://gist.github.com/acme/runn/pull/482')).toEqual([])
  })

  it('matches nothing for a page with no readable address', () => {
    expect(matched(undefined)).toEqual([])
    expect(matched('not an address')).toEqual([])
  })

  it('lists every task that holds the page', () => {
    const twin = { ...pr, id: 't3', projectId: 'p2' }
    expect(pageTasks([pr, twin], 'https://github.com/acme/runn/pull/482').map(({ task }) => task.id)).toEqual([
      't1',
      't3',
    ])
  })
})

describe('the app a plugin published for a task', () => {
  const stack: BridgePageTask = {
    id: 't4',
    title: 'Fix billing rounding',
    branch: 'fix/billing-rounding',
    projectId: 'p1',
    pages: [
      {
        origin: 'https://runn-05ea41.runn.localhost:5104',
        pathPrefix: '/',
        source: 'runn',
        status: { label: 'Runn stack', state: 'running', tone: 'ok' },
      },
    ],
  }

  it('covers every page on its exact origin, port included', () => {
    expect(appTask([pr, stack], 'https://runn-05ea41.runn.localhost:5104/planner?x=1')?.task.id).toBe('t4')
    expect(appTask([pr, stack], 'https://runn-05ea41.runn.localhost:5105/')).toBeNull()
    expect(appTask([pr, stack], 'http://runn-05ea41.runn.localhost:5104/')).toBeNull()
  })

  it("isn't an item page, which only the panel and the chip show", () => {
    expect(appTask([pr, stack], 'https://github.com/acme/runn/pull/482')).toBeNull()
  })
})
