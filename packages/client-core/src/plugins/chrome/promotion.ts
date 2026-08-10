import {
  integrationsRoute,
  type IntegrationsResponse,
  type PluginRailItem,
  type Task,
  type TaskLinkSeed,
  type TaskSeed,
} from '@acorn/protocol/api.ts'
import type { SourcePromotion } from '../../registries/sources'
import { addTaskLink, createTask } from '../../tasks/mutations'
import { readJson } from '../../apiClient'
import { ownsTaskOrigin } from './ownership'

export type DescriptorPromotionServices = {
  create(seed: TaskSeed): Promise<Task>
  link(taskId: string, link: TaskLinkSeed): Promise<unknown>
  ownsConnection(pluginId: string, connectionId: string): Promise<boolean>
}

const defaultServices: DescriptorPromotionServices = {
  create: createTask,
  link: addTaskLink,
  ownsConnection: async (pluginId, connectionId) => {
    const response = await readJson<IntegrationsResponse>(integrationsRoute)
    return response.integrations.some((connection) =>
      connection.id === connectionId && connection.providerId === pluginId)
  },
}

// Host-owned promotion for declarative sources. The plugin supplies only row data; ordering and
// partial-failure behavior are the same for every tracker because the host owns both mutations.
export function descriptorPromotion(
  pluginId: string,
  overrides: Partial<DescriptorPromotionServices> = {},
): SourcePromotion<PluginRailItem> {
  const services = { ...defaultServices, ...overrides }
  // The modal calls prepare before create and then afterCreate with the same row. Remember that
  // successful ownership check so the normal path makes one host read, while attach (which has no
  // prepare step) still checks independently.
  const validated = new WeakSet<PluginRailItem>()
  const linkFor = async (item: PluginRailItem): Promise<TaskLinkSeed | undefined> => {
    const link = item.task?.link
    if (!link) return undefined
    if (!validated.has(item)) {
      if (!await services.ownsConnection(pluginId, link.connectionId)) {
        throw new Error(`Plugin '${pluginId}' returned a task link for a connection it does not own.`)
      }
      validated.add(item)
    }
    return link
  }

  return {
    canPromote: (_item, context) => !!context.projectId,
    prepare: async (item, context) => {
      await linkFor(item)
      const origin = item.task?.origin
      return {
        origin: origin && ownsTaskOrigin(pluginId, origin) ? origin : `${pluginId}:item`,
        projectId: context.projectId,
        title: item.task?.title ?? item.title,
        branch: item.task?.branch ?? context.branch,
      }
    },
    create: services.create,
    afterCreate: async (task, item) => {
      const link = await linkFor(item)
      if (link) await services.link(task.id, link)
    },
    attachToCurrentTask: async (taskId, item) => {
      const link = await linkFor(item)
      if (!link) throw new Error('This item did not provide a task link.')
      await services.link(taskId, link)
    },
  }
}
