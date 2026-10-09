import { afterEach, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ capability: vi.fn(), toast: vi.fn(), open: vi.fn(), task: vi.fn(), nodeId: 'node' as string | null }))
vi.mock('@acorn/plugin-api/client', () => ({ activeNodeId: () => calls.nodeId, clientCapability: calls.capability, toast: calls.toast, requestTaskLaunch: calls.task }))
vi.mock('@acorn/plugin-workflows/contract/gitLaunch.ts', () => ({ WORKFLOW_GIT_LAUNCH: 'workflows.gitLaunch' }))

import { commitActionRequest, launchWorkflowAtCommit, sameGitActionScope, worktreeActionRequest } from './launchWorkflow'

afterEach(() => { vi.clearAllMocks(); calls.nodeId = 'node' })

it('sends the captured commit to the Workflows owner', () => {
  calls.capability.mockReturnValue({ open: calls.open })
  launchWorkflowAtCommit('node', 'project', 'a'.repeat(40), 'Review')
  expect(calls.open).toHaveBeenCalledWith({ nodeId: 'node', projectId: 'project', commitId: 'a'.repeat(40), title: 'Review' })
})

it('explains when Workflows is disabled', () => {
  calls.capability.mockReturnValue(undefined)
  launchWorkflowAtCommit('node', 'project', 'a'.repeat(40), 'Review')
  expect(calls.toast).toHaveBeenCalledWith('Workflows is unavailable on this Node.', { tone: 'danger' })
  expect(calls.open).not.toHaveBeenCalled()
})

it('refuses a menu action after its Node or project changes', () => {
  expect(sameGitActionScope('node', 'project', 'other-project')).toBe(false)
  calls.nodeId = 'other-node'
  expect(sameGitActionScope('node', 'project', 'project')).toBe(false)
  expect(calls.toast).toHaveBeenCalledTimes(2)
  expect(calls.open).not.toHaveBeenCalled()
})

it('keeps a branch-tip menu pinned and refuses it after a project switch', () => {
  let projectId = 'project'
  const select = vi.fn()
  const commit = { id: 'a'.repeat(40), subject: 'Pinned tip', refs: ['refs/heads/main'], parents: [] }
  const request = commitActionRequest(commit as Parameters<typeof commitActionRequest>[0], 'node', projectId, () => projectId, select)
  projectId = 'other-project'
  for (const action of request.actions) action.run()
  expect(calls.task).not.toHaveBeenCalled()
  expect(calls.open).not.toHaveBeenCalled()
  expect(select).not.toHaveBeenCalled()

  projectId = 'project'
  calls.capability.mockReturnValue({ open: calls.open })
  request.actions.find((action) => action.id === 'task:refs/heads/main')?.run()
  request.actions.find((action) => action.id === 'workflow:refs/heads/main')?.run()
  expect(calls.task).toHaveBeenCalledWith({ nodeId: 'node', projectId: 'project', title: 'Pinned tip', baseCommit: commit.id })
  expect(calls.open).toHaveBeenCalledWith({ nodeId: 'node', projectId: 'project', commitId: commit.id, title: 'Pinned tip' })
})

it('refuses stale worktree attachment and Open task callbacks', () => {
  let projectId = 'project'
  const view = vi.fn()
  const openTask = vi.fn()
  const row = { id: 'worktree', path: '/fixture/checkout', branch: 'feature', owners: [], main: false, missing: false, locked: false }
  const attach = worktreeActionRequest(row, 'node', projectId, () => projectId, openTask, view)
  const owned = worktreeActionRequest({ ...row, owners: [{ id: 'task-1', title: 'Task', projectId }] },
    'node', projectId, () => projectId, openTask, view)
  projectId = 'other-project'
  attach.actions.find((action) => action.id === 'view')?.run()
  attach.actions.find((action) => action.id === 'attach')?.run()
  owned.actions.find((action) => action.id === 'open')?.run()
  expect(view).not.toHaveBeenCalled()
  expect(calls.task).not.toHaveBeenCalled()
  expect(openTask).not.toHaveBeenCalled()
  calls.nodeId = 'other-node'
  owned.actions.find((action) => action.id === 'open')?.run()
  expect(openTask).not.toHaveBeenCalled()
  calls.nodeId = 'node'
  projectId = 'project'
  attach.actions.find((action) => action.id === 'attach')?.run()
  owned.actions.find((action) => action.id === 'open')?.run()
  expect(calls.task).toHaveBeenCalledWith({ nodeId: 'node', projectId: 'project', title: 'feature', worktreePath: row.path })
  expect(openTask).toHaveBeenCalledWith('task-1')
})
