import { describe, expect, it } from 'vitest'
import type { Task, Workspace } from '@acorn/protocol/api.ts'
import { planWorkspaceViewTransition } from './workspaceViewTransition'

const workspace = (id: string, owner: string, name: string): Workspace => ({
  id,
  name: id,
  isDefault: false,
  sort: 0,
  icon: null,
  color: null,
  repos: [{ owner, name, sort: 0 }],
})

const task = (id: string, repoOwner: string, repoName: string): Task => ({
  id,
  title: id,
  icon: null,
  origin: 'local',
  repoOwner,
  repoName,
  branch: id,
  worktreePath: null,
  pullNumber: null,
  status: 'active',
  parentId: null,
  sort: 0,
  links: [],
})

const acorn = workspace('acorn', 'jamesmacfie', 'acorn')
const runn = workspace('runn', 'Runn-Fast', 'runn')
const acornTask = task('acorn-task', 'jamesmacfie', 'acorn')
const oldRunnTask = task('old-runn-task', 'Runn-Fast', 'runn')
const selectedRunnTask = task('selected-runn-task', 'Runn-Fast', 'runn')
const tasks = [acornTask, oldRunnTask, selectedRunnTask]

describe('workspace view transitions', () => {
  it('keeps an explicit cross-workspace task jump instead of restoring an older task', () => {
    const transition = planWorkspaceViewTransition({
      previousWorkspace: acorn,
      nextWorkspace: runn,
      selectedSource: null,
      activeTaskId: selectedRunnTask.id,
      tasks,
      defaultSource: 'github',
      rememberedNextView: { taskId: oldRunnTask.id },
    })

    expect(transition.previousView).toBeUndefined()
    expect(transition.next).toEqual({ kind: 'keep-task', task: selectedRunnTask })
  })

  it('rejects a remembered task that belongs to another workspace', () => {
    const transition = planWorkspaceViewTransition({
      previousWorkspace: runn,
      nextWorkspace: acorn,
      selectedSource: null,
      activeTaskId: oldRunnTask.id,
      tasks,
      defaultSource: 'github',
      rememberedNextView: { taskId: oldRunnTask.id },
    })

    expect(transition.previousView).toEqual({ taskId: oldRunnTask.id })
    expect(transition.next).toEqual({ kind: 'restore-source', source: 'github' })
  })

  it('restores a valid remembered task during a normal workspace switch', () => {
    const transition = planWorkspaceViewTransition({
      previousWorkspace: runn,
      nextWorkspace: acorn,
      selectedSource: null,
      activeTaskId: oldRunnTask.id,
      tasks,
      defaultSource: 'github',
      rememberedNextView: { taskId: acornTask.id },
    })

    expect(transition.next).toEqual({ kind: 'restore-task', task: acornTask })
  })

  it('remembers and restores source views without involving stale task state', () => {
    const transition = planWorkspaceViewTransition({
      previousWorkspace: runn,
      nextWorkspace: acorn,
      selectedSource: 'linear',
      activeTaskId: oldRunnTask.id,
      tasks,
      defaultSource: 'github',
      rememberedNextView: { source: 'github' },
    })

    expect(transition.previousView).toEqual({ source: 'linear' })
    expect(transition.next).toEqual({ kind: 'restore-source', source: 'github' })
  })
})
