import { describe, expect, it } from 'vitest'
import type { Task, Workspace } from '@acorn/protocol/api.ts'
import { planWorkspaceViewTransition, viewToRemember } from './workspaceViewTransition'

const workspace = (id: string, projectId: string, name: string): Workspace => ({
  id,
  name: id,
  isDefault: false,
  sort: 0,
  projects: [{ id: projectId, name, sort: 0 }],
})

const task = (id: string, projectId: string, _projectName: string): Task => ({
  id,
  title: id,
  icon: null,
  origin: 'local',
  projectId,
  github: null,
  branch: id,
  worktreePath: null,
  pullNumber: null,
  status: 'active',
  parentId: null,
  sort: 0,
  links: [],
})

const acorn = workspace('acorn', 'project-acorn', 'acorn')
const runn = workspace('runn', 'project-runn', 'runn')
const acornTask = task('acorn-task', 'project-acorn', 'acorn')
const oldRunnTask = task('old-runn-task', 'project-runn', 'runn')
const selectedRunnTask = task('selected-runn-task', 'project-runn', 'runn')
const tasks = [acornTask, oldRunnTask, selectedRunnTask]

describe('workspace view transitions', () => {
  it('keeps an explicit cross-workspace task jump instead of restoring an older task', () => {
    const transition = planWorkspaceViewTransition({
      workspace: runn,
      selectedSource: null,
      activeTaskId: selectedRunnTask.id,
      tasks,
      defaultSource: 'github',
      rememberedView: { taskId: oldRunnTask.id },
    })

    expect(transition).toEqual({ kind: 'keep-task', task: selectedRunnTask })
  })

  it('rejects a remembered task that belongs to another workspace', () => {
    const transition = planWorkspaceViewTransition({
      workspace: acorn,
      selectedSource: null,
      activeTaskId: oldRunnTask.id,
      tasks,
      defaultSource: 'github',
      rememberedView: { taskId: oldRunnTask.id },
    })

    expect(transition).toEqual({ kind: 'restore-source', source: 'github' })
  })

  it('restores a valid remembered task during a normal workspace switch', () => {
    const transition = planWorkspaceViewTransition({
      workspace: acorn,
      selectedSource: null,
      activeTaskId: oldRunnTask.id,
      tasks,
      defaultSource: 'github',
      rememberedView: { taskId: acornTask.id },
    })

    expect(transition).toEqual({ kind: 'restore-task', task: acornTask })
  })

  it('restores a remembered source without involving stale task state', () => {
    const transition = planWorkspaceViewTransition({
      workspace: acorn,
      selectedSource: 'linear',
      activeTaskId: oldRunnTask.id,
      tasks,
      defaultSource: 'github',
      rememberedView: { source: 'github' },
    })

    expect(transition).toEqual({ kind: 'restore-source', source: 'github' })
  })

  it('restores the page a source was on, unless its project has left the workspace', () => {
    const plan = (path: string) => planWorkspaceViewTransition({
      workspace: acorn,
      selectedSource: null,
      activeTaskId: null,
      tasks,
      defaultSource: 'home',
      rememberedView: { source: 'github', path },
    })

    expect(plan('/p/project-acorn/pulls/12')).toEqual({ kind: 'restore-source', source: 'github', path: '/p/project-acorn/pulls/12' })
    expect(plan('/p/project-runn/pulls/12')).toEqual({ kind: 'restore-source', source: 'github' })
  })
})

describe('what a workspace remembers', () => {
  it('records a source with the page it is on', () => {
    expect(viewToRemember(acorn, 'github', null, '/p/project-acorn/pulls/12'))
      .toEqual({ source: 'github', path: '/p/project-acorn/pulls/12' })
    expect(viewToRemember(acorn, 'home', null, '/')).toEqual({ source: 'home' })
  })

  it('records a task only in the workspace that owns it', () => {
    expect(viewToRemember(acorn, null, acornTask, '/t/acorn-task')).toEqual({ taskId: acornTask.id })
    // Mid-jump: the incoming task is selected while the route still names the workspace being left.
    expect(viewToRemember(acorn, null, selectedRunnTask, '/p/project-acorn')).toBeUndefined()
  })
})
