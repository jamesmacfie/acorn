import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PANEL_AUTHORING_INSTRUCTIONS, panelGuideExamples } from '@acorn/dashboards-core/panelGuide.ts'
import { panelTools } from './panelTools'
import type { DashboardProblem } from '@acorn/dashboards-core/projection'

// The task lookup and the publication check are faked: under test is what the tools hand back, not
// how sources are described.
vi.mock('../worktrees/taskWorktree.ts', () => ({
  loadTask: async () => ({ id: 'task-1' }),
  projectForTask: async () => ({ id: 'project-1', workspaceId: 'ws-1' }),
}))
const problems = vi.fn<() => Promise<DashboardProblem[]>>()
vi.mock('../dashboards/publication.ts', () => ({ dashboardContentProblems: () => problems() }))

const ctx = { taskId: 'task-1', userLogin: 'owner' }
const [guide, show] = panelTools({ db: {} as never, env: {} as never })
const plan = panelGuideExamples('ws-1')[0]!.plan

describe('panel tools', () => {
  beforeEach(() => problems.mockResolvedValue([]))

  it("panel_guide hands an agent the studio's own instructions, scoped to the task's workspace", async () => {
    const result = (await guide!.handler({}, ctx)) as { instructions: string; inAChat: string[] }
    expect(result.instructions).toBe(PANEL_AUTHORING_INSTRUCTIONS)
    expect(result.inAChat.join(' ')).toContain('"ws-1"')
  })

  it('panel_show describes a valid plan and returns no records', async () => {
    const result = await show!.handler({ title: 'By author', plan }, ctx)
    expect(result).toEqual({
      panelId: expect.stringMatching(/^panel-/),
      shownAt: expect.any(Number),
      description: expect.arrayContaining(['One row per Author.']),
    })
    expect(await show!.handler({ title: 'Weekly', panelId: 'prs', plan }, ctx)).toMatchObject({ panelId: 'prs' })
  })

  it('panel_show fails with every problem and its path into the plan', async () => {
    await expect(show!.handler({ title: 'Bad', plan: { ...plan, view: { kind: 'pie' } } }, ctx)).rejects.toThrow(
      /^\/view\/kind: /,
    )
    problems.mockResolvedValue([
      { path: '/stages/1/by/0/column', message: 'Column team is unavailable.' },
      { path: '/view/x', message: 'A bar chart needs an enum or person axis.' },
    ])
    await expect(show!.handler({ title: 'Bad', plan }, ctx)).rejects.toThrow(
      '/stages/1/by/0/column: Column team is unavailable.\n/view/x: A bar chart needs an enum or person axis.',
    )
  })
})
