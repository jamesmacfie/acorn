import { addNode, type WorkflowDraft } from './draft'
import { stepIdentity } from '../../shared/workflowIdentity'

/** Inserts one reviewed draft edit. The owner configures the item agent in the For each inspector. */
export function addAiList(draft: WorkflowDraft): WorkflowDraft {
  const planned = addNode(draft, 'agent', 'Plan with AI')
  const plan = planned.def.steps.at(-1)!
  plan.name = 'Plan with AI'
  plan.prompt = 'List the work as items with a stable id and a title. Return an empty array when there is no work.'
  plan.schema = {
    type: 'object', required: ['items'], properties: {
      items: { type: 'array', items: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } } },
    },
  }
  const mapped = addNode(planned, 'workflow-map', 'For each planned item')
  const each = mapped.def.steps.at(-1)!
  each.name = 'For each planned item'
  each.items = { step: stepIdentity(plan), pointer: '/items' }
  each.agent = { prompt: 'Complete the work described by the current item. Verify the result and report what changed.', onFailure: 'continue' }
  each.itemKey = '/id'
  each.title = { template: '${title}', bindings: { title: { address: { from: 'item', pointer: '/title' } } } }
  return mapped
}
