import type { AgentToolContribution } from '@acorn/plugin-api/node'
import {
  agentCancelInputSchema,
  agentPromptInputSchema,
  agentReadInputSchema,
  agentSpawnInputSchema,
  agentWaitInputSchema,
} from '../../shared/delegationSchemas'
import type { AgentDelegationService } from './service'

export function delegationTools(service: AgentDelegationService): AgentToolContribution[] {
  return [
    {
      name: 'agent_spawn',
      description: 'Start a directly owned managed agent on this task and return its durable ids immediately.',
      input: agentSpawnInputSchema,
      scope: 'task',
      risk: 'execute',
      requiresSession: true,
      when: (context) => service.canSpawn(context),
      whenDescription: 'Available to signed terminal and managed sessions, except workflow-owned managed sessions.',
      handler: (input, context) => service.spawn(agentSpawnInputSchema.parse(input), context),
    },
    {
      name: 'agent_prompt',
      description: 'Queue another durable turn for a directly owned delegated agent.',
      input: agentPromptInputSchema,
      scope: 'task',
      risk: 'execute',
      requiresSession: true,
      handler: (input, context) => service.prompt(agentPromptInputSchema.parse(input), context),
    },
    {
      name: 'agent_wait',
      description: 'Wait up to 30 seconds for an explicit condition on a directly owned delegated agent.',
      input: agentWaitInputSchema,
      scope: 'task',
      risk: 'execute',
      requiresSession: true,
      handler: (input, context) => service.wait(agentWaitInputSchema.parse(input), context),
    },
    {
      name: 'agent_read',
      description: 'Read a bounded page of useful output from a directly owned delegated agent.',
      input: agentReadInputSchema,
      scope: 'task',
      risk: 'execute',
      requiresSession: true,
      handler: (input, context) => service.read(agentReadInputSchema.parse(input), context),
    },
    {
      name: 'agent_cancel',
      description: 'Cancel the active or named turn of a directly owned delegated agent without deleting its history.',
      input: agentCancelInputSchema,
      scope: 'task',
      risk: 'execute',
      requiresSession: true,
      handler: (input, context) => service.cancel(agentCancelInputSchema.parse(input), context),
    },
  ]
}
