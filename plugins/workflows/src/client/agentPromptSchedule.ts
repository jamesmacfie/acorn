import type { AgentPromptSchedules } from '@acorn/plugin-api/client'
import { emptyDefinition } from './editor/draft'
import { workflowApi } from './workflowsClient'

type Api = Pick<
  typeof workflowApi,
  | 'createDef'
  | 'deleteDef'
  | 'preparePublication'
  | 'publish'
  | 'scheduleDefaults'
  | 'saveSchedule'
  | 'approveSchedule'
  | 'deleteSchedule'
>

/** A kept dashboard panel's scheduled refresh (docs/dashboards/supplied-rows.md § Keeping it up to date):
 *  a one-step agent workflow in the project, published, and a schedule that runs it approved at the
 *  cadence the person confirmed. A step that fails takes back the ones before it. */
export async function scheduleAgentPrompt(
  input: Parameters<AgentPromptSchedules['schedule']>[0],
  api: Api = workflowApi,
): Promise<{ undo(): Promise<void> }> {
  const row = await api.createDef({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    def: { ...emptyDefinition(input.name), steps: [{ name: 'refresh', kind: 'agent', prompt: input.prompt }] },
  })
  let scheduleId: string | undefined
  const undo = async () => {
    if (scheduleId) await api.deleteSchedule(scheduleId)
    await api.deleteDef(row.id)
  }
  try {
    const prepared = await api.preparePublication({ id: row.id, revision: row.revision })
    const published = await api.publish(prepared.id)
    if (published.state !== 'complete') throw new Error(published.error ?? "Couldn't publish the refresh workflow.")
    const { timezone } = await api.scheduleDefaults()
    const schedule = await api.saveSchedule({
      name: input.name,
      projectId: input.projectId,
      workflowId: row.id,
      timezone,
      cadence: input.cadence,
    })
    scheduleId = schedule.id
    await api.approveSchedule(schedule.id, 'process-current', false)
    return { undo }
  } catch (error) {
    await undo().catch(() => {})
    throw error
  }
}
