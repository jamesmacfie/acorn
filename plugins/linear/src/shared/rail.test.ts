import { describe, expect, it } from 'vitest'
import type { LinearProjectIssue } from './api'
import { linearRailItem, linearRailItemId, parseLinearRailItemId } from './rail'

const ISSUE: LinearProjectIssue = {
  integrationId: 'linear:acme',
  identifier: 'ENG-42',
  title: 'Ship it',
  url: 'https://linear.app/acme/issue/ENG-42',
  state: { name: 'In Progress', type: 'started', color: '#55f' },
  assignee: 'Ada',
  branchName: 'ada/eng-42-ship-it',
  priority: 1,
  priorityLabel: 'Urgent',
  updatedAt: 20,
  labels: [{ id: 'l1', name: 'bug', color: '#f00' }],
}

describe('Linear descriptor rows', () => {
  it('round-trips connection and issue identities without delimiter ambiguity', () => {
    const id = linearRailItemId({ connectionId: ISSUE.integrationId, identifier: ISSUE.identifier })
    expect(id).toBe('linear%3Aacme:ENG-42')
    expect(parseLinearRailItemId(id)).toEqual({ connectionId: 'linear:acme', identifier: 'ENG-42' })
    expect(parseLinearRailItemId('not-a-target')).toBeNull()
    expect(parseLinearRailItemId('%broken:value')).toBeNull()
  })

  it('carries the same promotion seed the compiled source produced, branch included', () => {
    // The branch is the interesting field: a Linear issue names its own, so the row answers what
    // rollbar's has to leave to the host modal.
    expect(linearRailItem(ISSUE)).toEqual({
      id: 'linear%3Aacme:ENG-42',
      title: 'Ship it',
      fields: ['ENG-42', 'In Progress', 'Ada', 'Urgent'],
      badge: 'bug',
      task: {
        origin: 'linear',
        title: 'ENG-42 Ship it',
        branch: 'ada/eng-42-ship-it',
        link: {
          connectionId: 'linear:acme',
          identifier: 'ENG-42',
          ref: { displayId: 'ENG-42', url: 'https://linear.app/acme/issue/ENG-42' },
        },
      },
    })
  })

  it('falls back to the lower-cased identifier when Linear suggests no branch', () => {
    const row = linearRailItem({ ...ISSUE, branchName: null, labels: [] })
    expect(row.task?.branch).toBe('eng-42')
    // Omitted rather than empty: the host renders a badge whenever the key is present.
    expect('badge' in row).toBe(false)
  })
})
