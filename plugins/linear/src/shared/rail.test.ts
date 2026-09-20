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
      fields: ['ENG-42', 'In Progress'],
      icon: 'circle-dot',
      short: 'ENG-42',
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

  it('adds a workspace column only when the list spans more than one connection', () => {
    // Two connected workspaces can both hold an ENG-42, so the caller names the workspace for every
    // row in a merged list. With one connection the column would repeat a single answer down the list.
    expect(linearRailItem(ISSUE).fields).toEqual(['ENG-42', 'In Progress'])
    expect(linearRailItem(ISSUE, 'Work').fields).toEqual(['ENG-42', 'In Progress', 'Work'])
  })

  it('marks the row from Linear\'s own state vocabulary, not the name a team chose', () => {
    // `state.type` is a fixed API value; `state.name` is whatever the workspace called that column.
    // The glyph is the only thing a collapsed row has room for beside the key, so it cannot depend on
    // a team's spelling. Every name in the map is in the host's eager icon set, which the census
    // cannot check for us because it only scans names spelled in the client tree.
    expect(linearRailItem({ ...ISSUE, state: { name: 'Triage', type: 'triage', color: '#000' } }).icon).toBe('circle-question-mark')
    expect(linearRailItem({ ...ISSUE, state: { name: 'Someday', type: 'backlog', color: '#000' } }).icon).toBe('circle-dashed')
    expect(linearRailItem({ ...ISSUE, state: { name: 'Anything at all', type: 'started', color: '#000' } }).icon).toBe('circle-dot')
    expect(linearRailItem({ ...ISSUE, state: null }).icon).toBe(undefined)
  })

  it('falls back to the lower-cased identifier when Linear suggests no branch', () => {
    const row = linearRailItem({ ...ISSUE, branchName: null, labels: [] })
    expect(row.task?.branch).toBe('eng-42')
  })
})
