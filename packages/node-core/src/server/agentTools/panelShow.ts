import { randomUUID } from 'node:crypto'
import { panelPlanSchema, panelShowInputSchema, type PanelShowResult } from '@acorn/protocol/dashboards.ts'
import { describePanelPlan } from '@acorn/dashboards-core/plan.ts'
import { panelGuide } from '@acorn/dashboards-core/panelGuide.ts'
import { describeDashboardProblem } from '@acorn/dashboards-core/projection'
import type { AppDatabase } from '../db/index.ts'
import type { Env } from '../bindings.ts'
import { dashboardContentProblems } from '../dashboards/publication.ts'
import { loadTask, projectForTask } from '../worktrees/taskWorktree.ts'
import type { DataSourceInvocation } from '../dataSources/authority.ts'
import { ToolError, type ToolContext } from './registry.ts'

// What `panel_guide` and `panel_show` do (./panelTools.ts). Nothing is stored: the plan lives in the
// tool call, and the transcript's card runs it under the owner's device.

export type PanelToolDeps = { db: AppDatabase; env: Env }

/** The task's workspace, which is the scope a Home tab and every plan the agent writes share. */
async function workspaceOf(db: AppDatabase, ctx: ToolContext): Promise<string> {
  const task = await loadTask(db, ctx.taskId)
  const project = task && (await projectForTask(db, task))
  if (!project) throw new ToolError('not_found', 'no such task')
  return project.workspaceId
}

export const guideForTask = async (deps: PanelToolDeps, ctx: ToolContext) => panelGuide(await workspaceOf(deps.db, ctx))

/** Every problem with a draft plan, as `<path>: <message>`: its shape, then the check publication
 *  runs, with sources described and the plan validated against them and no records read. */
export async function planProblems(
  env: Env,
  workspaceId: string,
  plan: unknown,
  invocation: DataSourceInvocation,
): Promise<string[]> {
  const parsed = panelPlanSchema.safeParse(plan)
  if (!parsed.success) return parsed.error.issues.map((issue) => `/${issue.path.join('/')}: ${issue.message}`)
  return (await dashboardContentProblems(env, { workspaceId }, parsed.data, invocation)).map(describeDashboardProblem)
}

export async function showPanel(deps: PanelToolDeps, raw: unknown, ctx: ToolContext): Promise<PanelShowResult> {
  const input = panelShowInputSchema.parse(raw)
  // As the Node, because a task token can't spend the person's connection (the data source tools do
  // the same).
  const problems = await planProblems(deps.env, await workspaceOf(deps.db, ctx), input.plan, {
    principal: { kind: 'internal', scope: 'service', userId: ctx.userLogin },
    signal: ctx.signal ?? new AbortController().signal,
  })
  if (problems.length) throw new ToolError('bad_request', problems.join('\n'))
  const parsed = panelPlanSchema.parse(input.plan)
  return {
    panelId: input.panelId ?? `panel-${randomUUID().slice(0, 8)}`,
    shownAt: Date.now(),
    description: describePanelPlan(parsed),
  }
}
