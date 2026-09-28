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
      description: [
        'Start another agent that you own, send it `prompt` as its first message, and return its ids at once.',
        "With isolation 'worktree' this also creates a new task with its own checkout and branch; that is how you hand a change to a separate task.",
        'When a child you started from a managed chat finishes a turn, its final message comes back to you as a new message, so you do not need to poll. From a terminal, use agent_wait and agent_read.',
        'A child can start one more level of agents; a third level is refused, and one root allows 12 live agents.',
        'A child that stops for a permission or a question waits for a person to answer in its own pane.',
      ].join(' '),
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
      description: 'Send another message to an agent you started. It waits behind any turn the agent is running, and its answer reports back like the first one.',
      input: agentPromptInputSchema,
      scope: 'task',
      risk: 'execute',
      requiresSession: true,
      handler: (input, context) => service.prompt(agentPromptInputSchema.parse(input), context),
    },
    {
      name: 'agent_wait',
      description: 'Wait up to 30 seconds for an agent you started to reach a condition. Call it again if it times out.',
      input: agentWaitInputSchema,
      scope: 'task',
      risk: 'execute',
      requiresSession: true,
      handler: (input, context) => service.wait(agentWaitInputSchema.parse(input), context),
    },
    {
      name: 'agent_read',
      description: 'Read a page of messages, tool calls, and results from an agent you started. Pass nextCursor back as afterSeq to read the next page.',
      input: agentReadInputSchema,
      scope: 'task',
      risk: 'execute',
      requiresSession: true,
      handler: (input, context) => service.read(agentReadInputSchema.parse(input), context),
    },
    {
      name: 'agent_cancel',
      description: 'Cancel the running or named turn of an agent you started. Its history stays.',
      input: agentCancelInputSchema,
      scope: 'task',
      risk: 'execute',
      requiresSession: true,
      handler: (input, context) => service.cancel(agentCancelInputSchema.parse(input), context),
    },
  ]
}
