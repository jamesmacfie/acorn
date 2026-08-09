import type { PluginRailItem, Task, TaskLinkSeed, TaskSeed } from '@acorn/protocol/api.ts'
import type { SourcePromotion } from '../../registries/sources'
import { addTaskLink, createTask } from '../../tasks/mutations'

export type DescriptorPromotionServices = {
  create(seed: TaskSeed): Promise<Task>
  link(taskId: string, link: TaskLinkSeed): Promise<unknown>
}

const defaultServices: DescriptorPromotionServices = {
  create: createTask,
  link: addTaskLink,
}

const linkFor = (item: PluginRailItem): TaskLinkSeed | undefined => item.task?.link

// Host-owned promotion for declarative sources. The plugin supplies only row data; ordering and
// partial-failure behavior are the same for every tracker because the host owns both mutations.
export function descriptorPromotion(
  pluginId: string,
  services: DescriptorPromotionServices = defaultServices,
): SourcePromotion<PluginRailItem> {
  return {
    canPromote: (_item, context) => !!context.projectId,
    prepare: (item, context) => ({
      origin: `${pluginId}:item`,
      projectId: context.projectId,
      title: item.task?.title ?? item.title,
      branch: item.task?.branch ?? context.branch,
    }),
    create: services.create,
    afterCreate: async (task, item) => {
      const link = linkFor(item)
      if (link) await services.link(task.id, link)
    },
    attachToCurrentTask: async (taskId, item) => {
      const link = linkFor(item)
      if (!link) throw new Error('This item did not provide a task link.')
      await services.link(taskId, link)
    },
  }
}
