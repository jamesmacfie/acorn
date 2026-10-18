import { describe, expect, it } from 'vitest'
import { toolOutputDir } from '@acorn/plugin-api/node'
import { claudeHarness, claudeLoopHookSettings } from './claudeHarness'
import { claudeHookOutput, claudeToolSubject } from './claudeLoopHook'
import type { AgentSession } from '../../contract/wire.ts'
import { CLAUDE_HOOK_INPUT as RECORDED } from './__fixtures__/claudeHookInput'

describe('Claude Code hook input', () => {
  it('reads the subject a policy reads from a permission request', () => {
    expect(claudeToolSubject(RECORDED.bashPre)).toEqual({
      toolCallId: 'toolu_01QWwwWDsrhnC1af97vgWNB8',
      toolName: 'Bash',
      kind: 'command',
      title: 'echo hi',
      command: 'echo hi',
      paths: [],
    })
    expect(claudeToolSubject(RECORDED.writePost)).toEqual({
      toolCallId: 'toolu_01CFP8EBwYibD1uwk5cUvUoH',
      toolName: 'Write',
      kind: 'edit',
      title: '/private/tmp/p10-probe/claude-cwd/notes.txt',
      command: '',
      paths: ['/private/tmp/p10-probe/claude-cwd/notes.txt'],
    })
    expect(claudeToolSubject({ hook_event_name: 'Stop' })).toBeNull()
    expect(claudeToolSubject('nope')).toBeNull()
  })

  it('answers with a deny, a note, or nothing, and has no way to say allow', () => {
    expect(JSON.parse(claudeHookOutput('PreToolUse', { deny: 'No force-push.' }))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'No force-push.',
      },
    })
    expect(JSON.parse(claudeHookOutput('PostToolUse', { note: 'Tests first.' }))).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Tests first.' },
    })
    expect(claudeHookOutput('PreToolUse', null)).toBe('')
    expect(claudeHookOutput('PostToolUse', { note: '' })).toBe('')
    expect(claudeHookOutput('PostToolUse', { deny: 'too late' })).toBe('')
  })
})

describe('installing the bridge in Claude Code', () => {
  const session = { kind: 'interactive', taskId: 't1', config: {} } as unknown as AgentSession
  const skills = { folders: [], plugins: [] }
  const settings = (meta: Record<string, unknown>) =>
    (meta.claudeCode as { options: { settings: Record<string, unknown> } }).options.settings

  it('adds a command hook only for the points that have a handler, beside the settings acorn already sends', () => {
    const permissions = { allow: [`Read(/${toolOutputDir('t1')}/**)`] }
    expect(settings(claudeHarness.acpSessionMeta!(session, skills))).toEqual({
      autoContinueAtUsageLimit: false,
      permissions,
    })
    const bridge = { command: '/app/node', args: ["/app/helper/it's/loop-hook.js"], beforeTool: true, afterTool: false }
    expect(settings(claudeHarness.acpSessionMeta!(session, skills, bridge))).toEqual({
      autoContinueAtUsageLimit: false,
      permissions,
      hooks: {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: `'/app/node' '/app/helper/it'\\''s/loop-hook.js' 'claude' 'PreToolUse'`,
                timeout: 600,
              },
            ],
          },
        ],
      },
    })
    expect(Object.keys(claudeLoopHookSettings({ ...bridge, beforeTool: false, afterTool: true }))).toEqual([
      'PostToolUse',
    ])
  })
})
