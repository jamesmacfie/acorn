import { describe, expect, it } from 'vitest'
import type { BridgePageTask } from '@acorn/protocol/extensionBridge.ts'
import { pageTasks } from './taskPages'

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
const matched = (url: string | undefined) => pageTasks(tasks, url).map(({ task, source }) => `${task.id}:${source}`)

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
