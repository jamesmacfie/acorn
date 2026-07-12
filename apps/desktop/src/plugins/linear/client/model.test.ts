import { describe, expect, it } from 'vitest'
import type { LinearProjectIssue } from '../../../core/shared/api'
import {
  emptyLinearFilter,
  filterLinearIssues,
  groupLinearIssuesByState,
  linearFacets,
  priorityMeta,
  sortLinearIssues,
} from './model'

const issue = (over: Partial<LinearProjectIssue>): LinearProjectIssue => ({
  identifier: 'ENG-1',
  title: 'thing',
  url: 'https://linear.app/acme/issue/ENG-1',
  state: { name: 'Todo', type: 'unstarted', color: '#888' },
  assignee: null,
  integrationId: 'c1',
  branchName: null,
  priority: 0,
  priorityLabel: 'No priority',
  updatedAt: null,
  labels: [],
  ...over,
})

describe('linear client model', () => {
  const issues = [
    issue({ identifier: 'ENG-142', title: 'Terminal scroll bug', priority: 1, updatedAt: 300, assignee: 'james', labels: [{ id: 'l1', name: 'terminal', color: '#f00' }] }),
    issue({ identifier: 'ENG-118', title: 'Rollbar polish', priority: 3, updatedAt: 200, assignee: 'priya', labels: [{ id: 'l2', name: 'rollbar', color: '#0f0' }] }),
    issue({ identifier: 'ENG-90', title: 'Preview zoom', priority: 0, updatedAt: 100, assignee: 'james', labels: [] }),
  ]

  it('sorts by priority (urgent first, none last) then updatedAt desc', () => {
    expect(sortLinearIssues(issues).map((i) => i.identifier)).toEqual(['ENG-142', 'ENG-118', 'ENG-90'])
    // equal priority falls back to recency
    const tie = [issue({ identifier: 'A', priority: 2, updatedAt: 100 }), issue({ identifier: 'B', priority: 2, updatedAt: 500 })]
    expect(sortLinearIssues(tie).map((i) => i.identifier)).toEqual(['B', 'A'])
  })

  it('case-insensitive title search', () => {
    expect(filterLinearIssues(issues, { ...emptyLinearFilter, search: 'rollbar' }).map((i) => i.identifier)).toEqual(['ENG-118'])
  })

  it('identifier search tolerates the # prefix', () => {
    expect(filterLinearIssues(issues, { ...emptyLinearFilter, search: '#142' }).map((i) => i.identifier)).toEqual(['ENG-142'])
    expect(filterLinearIssues(issues, { ...emptyLinearFilter, search: 'eng-90' }).map((i) => i.identifier)).toEqual(['ENG-90'])
  })

  it('filters by assignee and label', () => {
    expect(filterLinearIssues(issues, { ...emptyLinearFilter, assignee: 'james' }).map((i) => i.identifier)).toEqual(['ENG-142', 'ENG-90'])
    expect(filterLinearIssues(issues, { ...emptyLinearFilter, label: 'rollbar' }).map((i) => i.identifier)).toEqual(['ENG-118'])
  })

  it('groups by state type in board order, preserving input order within a group', () => {
    const list = [
      issue({ identifier: 'B1', state: { name: 'Backlog', type: 'backlog', color: '#888' } }),
      issue({ identifier: 'S1', state: { name: 'In Progress', type: 'started', color: '#0f0' } }),
      issue({ identifier: 'S2', state: { name: 'In Review', type: 'started', color: '#0f0' } }),
    ]
    const groups = groupLinearIssuesByState(list)
    expect(groups.map((g) => g.key)).toEqual(['started', 'backlog'])
    expect(groups[0].label).toBe('In Progress')
    expect(groups[0].issues.map((i) => i.identifier)).toEqual(['S1', 'S2'])
  })

  it('facets are de-duped and sorted', () => {
    const f = linearFacets(issues)
    expect(f.assignees).toEqual(['james', 'priya'])
    expect(f.labels).toEqual(['rollbar', 'terminal'])
  })

  it('maps priority to a level + label', () => {
    expect(priorityMeta(1)).toEqual({ level: 'urgent', label: 'Urgent' })
    expect(priorityMeta(4, 'Low')).toEqual({ level: 'low', label: 'Low' })
    expect(priorityMeta(0)).toEqual({ level: 'none', label: 'No priority' })
    expect(priorityMeta(null)).toEqual({ level: 'none', label: 'No priority' })
    expect(priorityMeta(2, 'High')).toEqual({ level: 'high', label: 'High' })
  })
})
