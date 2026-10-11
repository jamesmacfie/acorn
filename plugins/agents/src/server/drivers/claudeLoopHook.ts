// Claude Code's half of the harness bridge (docs/managed-agents/loop-hooks.md): its command-hook input
// as acorn's tool subject, and acorn's answer in Claude's hook output. Recorded against Claude Code
// 2.1.292. Loaded with the bridge call, not at boot; `claudeLoopHookSettings` installs it.
import type { AgentPermissionSubject } from '../../contract/permissionHook.ts'
import type { AgentLoopHookEvent } from '../../contract/loopHook.ts'

const KINDS: Record<string, AgentPermissionSubject['kind']> = {
  Bash: 'command',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Read: 'read',
  Glob: 'read',
  Grep: 'read',
  WebFetch: 'fetch',
  WebSearch: 'fetch',
}

export type ClaudeToolSubject = AgentPermissionSubject & { toolName: string; title: string }

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The subject of one `PreToolUse` or `PostToolUse` input. Null when it isn't a tool hook's input. */
export function claudeToolSubject(input: unknown): ClaudeToolSubject | null {
  if (typeof input !== 'object' || input == null) return null
  const row = input as Record<string, unknown>
  const toolName = text(row.tool_name)
  if (!toolName) return null
  const tool =
    typeof row.tool_input === 'object' && row.tool_input != null ? (row.tool_input as Record<string, unknown>) : {}
  const command = text(tool.command)
  const paths = [tool.file_path, tool.notebook_path, tool.path].map(text).filter(Boolean)
  return {
    toolCallId: text(row.tool_use_id),
    toolName,
    kind: KINDS[toolName] ?? 'other',
    title: command || paths[0] || text(tool.url) || toolName,
    command,
    paths,
  }
}

/** The output for one answer. `''` is no decision, which Claude reads as "carry on with your own
 *  checks". There is no allow here, and nothing can build one. */
export function claudeHookOutput(
  event: AgentLoopHookEvent,
  answer: { deny: string } | { note: string } | null,
): string {
  if (!answer) return ''
  if (event === 'PreToolUse' && 'deny' in answer) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: answer.deny,
      },
    })
  }
  if (event === 'PostToolUse' && 'note' in answer && answer.note) {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: answer.note } })
  }
  return ''
}
