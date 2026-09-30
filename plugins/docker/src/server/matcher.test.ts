import { describe, expect, it } from 'vitest'
import { defaultOverrides } from './dockerConfig'
import { branchSlug, containerBelongsToTask, containerMatchesTask, type MatchableContainer } from './matcher'

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

  it('refuses foreign or invalid explicit working dirs despite every matching display hint', () => {
    const task = { worktreePath: WT, branch: 'fix/activejob-error' }
    for (const dir of ['/foreign', `${WT}-other`, '', 'relative', `${WT}/../foreign`]) {
      const c = container({ composeWorkingDir: dir, composeProject: 'configured', name: 'fix-activejob-error', labels: { task: 'fix-activejob-error' } })
      expect(containerMatchesTask(c, task, { composeProject: 'configured', matchLabels: ['task'], matchName: true }), dir).toBe(false)
    }
  })
})

describe('containerBelongsToTask', () => {
  it.each([
    [WT, WT, true], [WT, `${WT}/./services/`, true], [WT, `${WT}-other`, false],
    [WT, `${WT}/nested/../../foreign`, false], [WT, 'relative/path', false],
    [WT, null, false], [null, WT, false], ['', WT, false], ['relative', 'relative/sub', false],
    ['/', '/foreign', false], [WT, `${WT}\0/child`, false],
    ['C:\\Worktrees\\Task', 'c:/worktrees/task/service/', true],
    ['C:\\Worktrees\\Task', 'C:\\Worktrees\\Task-other', false],
    ['C:\\Worktrees\\Task', 'C:\\Worktrees\\Task\\..\\foreign', false],
    ['C:\\Worktrees\\Task', 'C:Worktrees\\Task', false],
    ['C:\\Worktrees\\Task', 'D:\\Worktrees\\Task', false],
    ['C:\\Worktrees\\Task', 'C:\\Worktrees\\Task\\ambiguous.\\service', false],
    ['C:\\Worktrees\\Task', '\\\\?\\C:\\Worktrees\\Task', false],
    ['\\\\.\\C:\\Worktrees\\Task', '\\\\.\\C:\\Worktrees\\Task\\service', false],
    ['\\\\host\\share\\task', '//HOST/share/task/service', true],
    ['\\\\host\\share\\task', '//host/share/task-other', false],
    ['\\\\host\\share\\task', '//other/share/task', false],
    ['\\\\host\\share\\task', '//host/share/task/../foreign', false],
  ])('root %s and daemon path %s => %s', (worktreePath, composeWorkingDir, expected) => {
    expect(containerBelongsToTask(container({ composeWorkingDir }), { worktreePath, branch: 'matching-branch' })).toBe(expected)
  })

  it('does not grant authority to missing-metadata display hints', () => {
    const c = container({ name: 'matching-branch', composeProject: 'matching-branch', labels: { task: 'matching-branch' } })
    expect(containerMatchesTask(c, { worktreePath: WT, branch: 'matching-branch' })).toBe(true)
    expect(containerBelongsToTask(c, { worktreePath: WT, branch: 'matching-branch' })).toBe(false)
  })
})
