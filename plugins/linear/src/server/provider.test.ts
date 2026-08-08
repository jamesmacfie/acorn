import { describe, expect, it } from 'vitest'
import { linearNodeToDetail, linearSummaryOf } from './provider'

describe('linear provider normalization', () => {
  it('normalizes detail fields, activity, labels, and related issues', () => {
    const detail = linearNodeToDetail({
      id: 'issue-1', identifier: 'ENG-42', title: 'Fix login', url: 'https://linear.app/acme/issue/ENG-42',
      description: 'Body', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z',
      state: { name: 'In Progress', type: 'started', color: '#fff' }, assignee: { name: 'Jo' },
      creator: { name: 'Sam' }, labels: { nodes: [{ id: 'bug', name: 'Bug', color: '#f00' }] },
      history: { nodes: [{
        id: 'h1', createdAt: '2026-01-02T01:00:00Z', actor: { name: 'Sam' }, botActor: null,
        fromState: null, toState: { name: 'In Progress', color: '#fff' }, fromAssignee: null, toAssignee: null,
        addedLabelIds: ['bug'], removedLabelIds: null, fromTitle: null, toTitle: null,
      }] },
      comments: { nodes: [{ id: 'c1', body: 'Looks good', createdAt: '2026-01-03T00:00:00Z', user: null, parent: null }] },
      relations: { nodes: [{ id: 'r1', type: 'blocks', relatedIssue: { id: 'issue-2', identifier: 'ENG-43', title: 'Ship it', state: null } }] },
      inverseRelations: { nodes: [] },
    })

    expect(detail).toMatchObject({
      id: 'issue-1', identifier: 'ENG-42', assignee: 'Jo', creator: 'Sam',
      createdAt: Date.parse('2026-01-02T00:00:00Z'), updatedAt: Date.parse('2026-01-03T00:00:00Z'),
      labels: [{ id: 'bug', name: 'Bug', color: '#f00' }],
      comments: [{ id: 'c1', author: null, parentId: null }],
      relations: [{ id: 'r1', kind: 'blocks', label: 'Blocks', issue: { identifier: 'ENG-43' } }],
    })
    expect(detail.activity).toEqual([
      { id: 'created', actor: 'Sam', text: 'created the issue', createdAt: Date.parse('2026-01-02T00:00:00Z'), icon: 'created' },
      { id: 'h1:1', actor: 'Sam', text: 'moved to In Progress', createdAt: Date.parse('2026-01-02T01:00:00Z'), icon: 'state', color: '#fff' },
      { id: 'h1:2', actor: 'Sam', text: 'added label Bug', createdAt: Date.parse('2026-01-02T01:00:00Z'), icon: 'label' },
    ])
  })

  it('derives the summary from normalized detail without leaking detail fields', () => {
    const summary = linearSummaryOf({
      id: 'issue-1', identifier: 'ENG-42', title: 'Fix login', url: 'https://linear.app/acme/issue/ENG-42',
      state: { name: 'Done', type: 'completed', color: '#0f0' }, assignee: 'Jo', description: null,
      comments: [], activity: [], labels: [], createdAt: null, updatedAt: null, creator: null,
      priority: null, priorityLabel: null, estimate: null, dueDate: null, branchName: null, team: null,
      project: null, cycle: null, attachments: [], parent: null, children: [], relations: [],
    })
    expect(summary).toEqual({ identifier: 'ENG-42', title: 'Fix login', url: 'https://linear.app/acme/issue/ENG-42', state: { name: 'Done', type: 'completed', color: '#0f0' }, assignee: 'Jo' })
  })
})
