import type { AgentPromptSchedules } from '@acorn/plugin-api/client'
import { emptyDefinition } from './editor/draft'
import { workflowApi } from './workflowsClient'

type Api = Pick<
  typeof workflowApi,
  | 'createDef'
  | 'deleteDef'
  | 'preparePublication'
  | 'publish'
  | 'triggerDefaults'
  | 'saveTrigger'
  | 'approveTrigger'
  | 'deleteTrigger'
>

/** A kept dashboard panel's scheduled refresh (docs/dashboards/supplied-rows.md § Keeping it up to date):
 *  a one-step agent workflow in the project, published, and a clock trigger that runs it approved at
 *  the cadence the person confirmed. A step that fails takes back the ones before it. */
export async function scheduleAgentPrompt(
  input: Parameters<AgentPromptSchedules['schedule']>[0],
  api: Api = workflowApi,
): Promise<{ undo(): Promise<void> }> {
  const row = await api.createDef({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    def: { ...emptyDefinition(input.name), steps: [{ name: 'refresh', kind: 'agent', prompt: input.prompt }] },
  })
  let triggerId: string | undefined
  const undo = async () => {
    if (triggerId) await api.deleteTrigger(triggerId)
    await api.deleteDef(row.id)
  }
  try {
    const prepared = await api.preparePublication({ id: row.id, revision: row.revision })
    const published = await api.publish(prepared.id)
    if (published.state !== 'complete') throw new Error(published.error ?? "Couldn't publish the refresh workflow.")
    const { timezone } = await api.triggerDefaults()
    const trigger = await api.saveTrigger({
      name: input.name,
      projectId: input.projectId,
      workflowId: row.id,
      when: { kind: 'clock', timezone },
      cadence: input.cadence,
    })
    triggerId = trigger.id
    await api.approveTrigger(trigger.id, 'process-current', false)
    return { undo }
  } catch (error) {
    await undo().catch(() => {})
    throw error
  }
}
