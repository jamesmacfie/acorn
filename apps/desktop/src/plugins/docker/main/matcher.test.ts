import { describe, expect, it } from 'vitest'
import { defaultOverrides } from './dockerConfig'
import { branchSlug, containerMatchesTask, type MatchableContainer } from './matcher'

const container = (over: Partial<MatchableContainer> = {}): MatchableContainer => ({
  name: 'web-1',
  composeProject: null,
  composeWorkingDir: null,
  labels: {},
  ...over,
})

const WT = '/Users/x/worktrees/Runn-Fast-runn-fix-activejob-deserialization'

describe('containerMatchesTask', () => {
  it('matches when the compose working_dir equals or sits inside the task worktree', () => {
    const task = { worktreePath: WT, branch: 'runn-fix-activejob-deserialization' }
    expect(containerMatchesTask(container({ composeWorkingDir: WT }), task)).toBe(true)
    expect(containerMatchesTask(container({ composeWorkingDir: `${WT}/` }), task)).toBe(true)
    expect(containerMatchesTask(container({ composeWorkingDir: `${WT}/subdir` }), task)).toBe(true)
    expect(containerMatchesTask(container({ composeWorkingDir: `${WT}-other` }), task)).toBe(false)
    expect(containerMatchesTask(container({ composeWorkingDir: '/elsewhere' }), task)).toBe(false)
  })

  it('falls back to the branch slug in the name or compose project', () => {
    const task = { worktreePath: null, branch: 'fix/activejob-error' }
    expect(branchSlug(task.branch)).toBe('fix-activejob-error')
    expect(containerMatchesTask(container({ name: 'runn-fix-activejob-error-web-1' }), task)).toBe(true)
    expect(containerMatchesTask(container({ composeProject: 'runn_fix-activejob-error-ab12' }), task)).toBe(true)
    expect(containerMatchesTask(container({ name: 'unrelated' }), task)).toBe(false)
  })

  it('refuses to slug-match short/generic branch names', () => {
    const task = { worktreePath: null, branch: 'main' }
    expect(containerMatchesTask(container({ name: 'maintenance-web' }), task)).toBe(false)
  })

  it('prefers working_dir over the slug (no false positive from an unrelated slug hit)', () => {
    const task = { worktreePath: WT, branch: 'zz' }
    expect(containerMatchesTask(container({ composeWorkingDir: WT, name: 'anything' }), task)).toBe(true)
  })

  it('honours [docker] overrides: compose_project, match_labels, match_name=false', () => {
    const task = { worktreePath: null, branch: 'fix/activejob-error' }
    expect(containerMatchesTask(container({ composeProject: 'runn' }), task, { ...defaultOverrides, composeProject: 'runn' })).toBe(true)
    expect(containerMatchesTask(
      container({ labels: { 'acorn.task': 'fix-activejob-error' } }),
      task,
      { ...defaultOverrides, matchLabels: ['acorn.task'] },
    )).toBe(true)
    expect(containerMatchesTask(
      container({ name: 'runn-fix-activejob-error-web-1' }),
      task,
      { ...defaultOverrides, matchName: false },
    )).toBe(false)
  })
})
