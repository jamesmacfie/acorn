import { capabilityId } from '@acorn/protocol/pluginIds.ts'

// The two memory hooks driven from outside this plugin: inject a task's launch context into a fresh
// agent session, and run the memory-review pass when a session ends. apps/node's composition root
// resolves them on behalf of the agent, terminal, and workflow integrations.
//
// The published value is the full MemoryKnowledge runtime, but the contract is these two methods.
// Narrowing it is what lets the id live here: MemoryKnowledge carries a proposal-store handle, and a
// contract file may not reach into its own plugin's server/ (tools/arch/boundaries.test.ts).
export type MemoryLaunchHooks = {
  // Pushes the combined launch block (task context + project memory) into a fresh agent session
  // (docs/notes-and-memory.md § Context integration). Best-effort: never fails a launch.
  launchInjector(taskId: string, sessionId: string): Promise<void>
  // Fired when an agent session for a task exits, with that session's ring tail as the input.
  memoryReviewTrigger(taskId: string, transcriptTail: string): Promise<void>
}

export const MEMORY_KNOWLEDGE = capabilityId<MemoryLaunchHooks>('memory.knowledge')
