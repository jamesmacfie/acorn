import { capabilityId } from '@acorn/plugin-api/node'

// The two memory hooks that are driven from outside this plugin: inject a task's launch context
// into a fresh agent session, and run the memory-review pass when a session ends.
//
// This id used to live in main/knowledgeIpc.ts, whose comment argued a contract file was
// unnecessary because "the only consumer is apps/node's composition root," then two lines later
// listed the agent, terminal and workflow integrations as consumers. Both were true, which is the
// tell: the root resolves it on those plugins' behalf.
//
// The value published is the full MemoryKnowledge runtime, but the contract is these two methods.
// Narrowing it is what lets the id live here at all: MemoryKnowledge carries a proposal-store
// handle, and a contract file may not reach into its own plugin's main/ (tools/arch/boundaries.test.ts).
// Nothing outside the plugin ever used `proposals` anyway.
export type MemoryLaunchHooks = {
  // Pushes the combined launch block (task context + project memory) into a fresh agent session
  // (docs/notes-and-memory.md § Context integration). Best-effort: never fails a launch.
  launchInjector(taskId: string, sessionId: string): Promise<void>
  // Fired when an agent session for a task exits, with that session's ring tail as the input.
  memoryReviewTrigger(taskId: string, transcriptTail: string): Promise<void>
}

export const MEMORY_KNOWLEDGE = capabilityId<MemoryLaunchHooks>('memory.knowledge')
