import { z } from 'zod'
import { toolCeilingSchema } from '@acorn/protocol/workflow.ts'

const resultSchema = z.record(z.string(), z.unknown())

export const agentSpawnInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  prompt: z.string().min(1).max(1_000_000),
  profileId: z.string().min(1).max(100).optional(),
  isolation: z.enum(['shared', 'worktree']).default('shared'),
  resultSchema: resultSchema.optional(),
  configOptions: z.record(z.string().min(1).max(100), z.string().max(2_000)).optional(),
  toolCeiling: toolCeilingSchema.optional(),
})

export const agentReadInputSchema = z.object({
  sessionId: z.string().uuid(),
  afterSeq: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(200).default(100),
})

export const agentPromptInputSchema = z.object({
  sessionId: z.string().uuid(),
  prompt: z.string().min(1).max(1_000_000),
  resultSchema: resultSchema.optional(),
  configOptions: z.record(z.string().min(1).max(100), z.string().max(2_000)).optional(),
})

export const agentWaitInputSchema = z.object({
  sessionId: z.string().uuid(),
  afterSeq: z.number().int().nonnegative().default(0),
  until: z.enum(['ready', 'attention', 'turn_completed', 'stopped']).default('turn_completed'),
  timeoutMs: z.number().int().min(0).max(30_000).default(30_000),
})

export const agentCancelInputSchema = z.object({
  sessionId: z.string().uuid(),
  turnId: z.string().uuid().optional(),
})

export type AgentSpawnInput = z.infer<typeof agentSpawnInputSchema>
export type AgentReadInput = z.infer<typeof agentReadInputSchema>
export type AgentPromptInput = z.infer<typeof agentPromptInputSchema>
export type AgentWaitInput = z.infer<typeof agentWaitInputSchema>
export type AgentCancelInput = z.infer<typeof agentCancelInputSchema>
