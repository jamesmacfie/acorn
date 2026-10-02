import { z } from 'zod'
import { toolCeilingSchema } from '@acorn/protocol/toolPolicy.ts'

// The `describe()` text reaches the agent through the MCP tool schema (docs/mcp.md § Tool surface).
// It is the only place an agent learns how delegation works, so it says what each field does.
const resultSchema = z.record(z.string(), z.unknown())
const sessionId = z.string().uuid().describe('The sessionId that agent_spawn returned for the child.')
const cursor = z.number().int().nonnegative().default(0)
  .describe('Only look at events after this cursor. Pass the cursor, lastSeq, or nextCursor from your last call.')
const configOptions = z.record(z.string().min(1).max(100), z.string().max(2_000))
  .describe("Provider settings by option id, such as { \"model\": \"opus\" }. A value the provider does not offer is skipped with a warning in the child's transcript.")

export const agentSpawnInputSchema = z.object({
  title: z.string().trim().min(1).max(500)
    .describe('Shown in the session list. With worktree isolation, it names the child task and derives its branch, adding a numeric suffix if taken.'),
  prompt: z.string().min(1).max(1_000_000)
    .describe("The child's first message. The child sees none of your conversation, so write a complete brief."),
  profileId: z.string().min(1).max(100).optional()
    .describe("The agent to run, such as 'claude-code' or 'codex'. Leave it out to run the same agent as you."),
  agent: z.string().trim().min(1).max(200).optional()
    .describe('A custom agent the user saved, by its name or id, such as "Bug reviewer". It sets the agent to run, its settings, and its instructions, so leave profileId out. configOptions and toolCeiling still apply on top.'),
  isolation: z.enum(['shared', 'worktree']).default('shared')
    .describe("'shared' runs the child in this task's checkout, so its edits land beside yours. 'worktree' creates a new task with its own checkout and branch. Without baseBranch, the branch starts from the project folder's HEAD. Use 'worktree' for a separate change."),
  baseBranch: z.string().min(1).optional()
    .describe("An existing local branch to start the child from. Only valid with worktree isolation. Takes its last commit; uncommitted changes do not carry over. Leave it out to start from the project folder's HEAD."),
  resultSchema: resultSchema.optional()
    .describe("A JSON Schema for the child's final answer. An answer that matches comes back as structured output in the report and in agent_read."),
  configOptions: configOptions.optional(),
  toolCeiling: toolCeilingSchema.optional()
    .describe("Narrows the tools the child may use. It never widens past your own. Leave it out, or keep maxRisk at 'execute', if the child has to start its own agent."),
})

export const agentReadInputSchema = z.object({
  sessionId,
  afterSeq: cursor,
  limit: z.number().int().min(1).max(200).default(100),
})

export const agentPromptInputSchema = z.object({
  sessionId,
  prompt: z.string().min(1).max(1_000_000)
    .describe('The next message for the child. It waits behind any turn the child is running.'),
  resultSchema: resultSchema.optional()
    .describe("A JSON Schema for the child's answer to this message."),
  configOptions: configOptions.optional(),
})

export const agentWaitInputSchema = z.object({
  sessionId,
  afterSeq: cursor,
  until: z.enum(['ready', 'attention', 'turn_completed', 'stopped']).default('turn_completed')
    .describe("'turn_completed' matches when a turn after the cursor ends or fails. 'attention' matches when the child is waiting on a person, for example for a permission. 'ready' matches when the child is idle. 'stopped' matches when it has stopped, failed, or been archived."),
  timeoutMs: z.number().int().min(0).max(30_000).default(30_000),
})

export const agentCancelInputSchema = z.object({
  sessionId,
  turnId: z.string().uuid().optional().describe('The turn to cancel. Leave it out to cancel the turn that is running.'),
})

export type AgentSpawnInput = z.infer<typeof agentSpawnInputSchema>
export type AgentReadInput = z.infer<typeof agentReadInputSchema>
export type AgentPromptInput = z.infer<typeof agentPromptInputSchema>
export type AgentWaitInput = z.infer<typeof agentWaitInputSchema>
export type AgentCancelInput = z.infer<typeof agentCancelInputSchema>
