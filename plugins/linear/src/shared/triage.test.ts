import { describe, expect, it } from 'vitest'
import type { LinearProjectIssue } from './api'
import { priorityMeta, priorityTone, sortLinearIssues, stateTone } from './triage'

// Ordering and the priority projection. The browse is a host-drawn rail, so there is nothing to filter
// or group.
const issue = (over: Partial<LinearProjectIssue>): LinearProjectIssue => ({
  identifier: 'ENG-1',
  title: 'thing',
  url: 'https://linear.app/acme/issue/ENG-1',
  state: null,
  assignee: null,
  integrationId: 'linear-a',
  branchName: null,
  priority: null,
  priorityLabel: null,
  updatedAt: null,
  labels: [],
  ...over,
})

describe('linear triage ordering', () => {
  it('puts urgent first and sinks "no priority" below every real one', () => {
    const ordered = sortLinearIssues([
      issue({ identifier: 'ENG-none', priority: 0 }),
      issue({ identifier: 'ENG-low', priority: 4 }),
      issue({ identifier: 'ENG-urgent', priority: 1 }),
      issue({ identifier: 'ENG-null', priority: null }),
    ])
    expect(ordered.map((entry) => entry.identifier)).toEqual(['ENG-urgent', 'ENG-low', 'ENG-none', 'ENG-null'])
  })

  it('breaks a priority tie by recency', () => {
    const ordered = sortLinearIssues([
      issue({ identifier: 'ENG-old', priority: 2, updatedAt: 10 }),
      issue({ identifier: 'ENG-new', priority: 2, updatedAt: 20 }),
    ])
    expect(ordered.map((entry) => entry.identifier)).toEqual(['ENG-new', 'ENG-old'])
  })

  it('does not mutate its input', () => {
    const input = [issue({ identifier: 'ENG-2', priority: 4 }), issue({ identifier: 'ENG-1', priority: 1 })]
    sortLinearIssues(input)
    expect(input.map((entry) => entry.identifier)).toEqual(['ENG-2', 'ENG-1'])
  })
})

describe('linear priority projection', () => {
  it('maps each level and prefers Linear’s own label', () => {
    expect(priorityMeta(1)).toEqual({ level: 'urgent', label: 'Urgent' })
    expect(priorityMeta(3, 'Medium priority')).toEqual({ level: 'medium', label: 'Medium priority' })
    expect(priorityMeta(0)).toEqual({ level: 'none', label: 'No priority' })
    expect(priorityMeta(null)).toEqual({ level: 'none', label: 'No priority' })
  })

  it('tones a state by its type and a priority by its level', () => {
    expect([
      stateTone('triage'),
      stateTone('started'),
      stateTone('completed'),
      stateTone('canceled'),
      stateTone(undefined),
    ]).toEqual(['warn', 'accent', 'ok', 'neutral', 'neutral'])
    expect([priorityTone('urgent'), priorityTone('high'), priorityTone('low')]).toEqual(['danger', 'warn', 'neutral'])
  })
})
