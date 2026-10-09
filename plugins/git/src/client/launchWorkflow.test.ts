import { afterEach, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ capability: vi.fn(), toast: vi.fn(), open: vi.fn() }))
vi.mock('@acorn/plugin-api/client', () => ({ activeNodeId: () => 'node', clientCapability: calls.capability, toast: calls.toast }))
vi.mock('@acorn/plugin-workflows/contract/gitLaunch.ts', () => ({ WORKFLOW_GIT_LAUNCH: 'workflows.gitLaunch' }))

import { launchWorkflowAtCommit } from './launchWorkflow'

afterEach(() => vi.clearAllMocks())

it('sends the captured commit to the Workflows owner', () => {
  calls.capability.mockReturnValue({ open: calls.open })
  launchWorkflowAtCommit('project', 'a'.repeat(40), 'Review')
  expect(calls.open).toHaveBeenCalledWith({ nodeId: 'node', projectId: 'project', commitId: 'a'.repeat(40), title: 'Review' })
})

it('explains when Workflows is disabled', () => {
  calls.capability.mockReturnValue(undefined)
  launchWorkflowAtCommit('project', 'a'.repeat(40), 'Review')
  expect(calls.toast).toHaveBeenCalledWith('Workflows is unavailable on this Node.', { tone: 'danger' })
  expect(calls.open).not.toHaveBeenCalled()
})
