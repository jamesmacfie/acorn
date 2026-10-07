// Hook input recorded from Claude Code 2.1.292 (`claude -p --settings` with a hook that saved its
// stdin), trimmed of the transcript path.
export const CLAUDE_HOOK_INPUT = {
  bashPre: {
    session_id: 'd4f5ca96-ac04-40e0-b203-a33578b54a70', cwd: '/private/tmp/p10-probe/claude-cwd',
    prompt_id: '8dd43781-3946-4f8d-81a3-a0da21b63537', permission_mode: 'bypassPermissions', hook_event_name: 'PreToolUse',
    tool_name: 'Bash', tool_input: { command: 'echo hi', description: 'Run echo hi' }, tool_use_id: 'toolu_01QWwwWDsrhnC1af97vgWNB8',
  },
  writePost: {
    session_id: 'd4f5ca96-ac04-40e0-b203-a33578b54a70', cwd: '/private/tmp/p10-probe/claude-cwd',
    prompt_id: '8dd43781-3946-4f8d-81a3-a0da21b63537', permission_mode: 'bypassPermissions', hook_event_name: 'PostToolUse',
    tool_name: 'Write', tool_input: { file_path: '/private/tmp/p10-probe/claude-cwd/notes.txt', content: 'x' },
    tool_response: { type: 'create', filePath: '/private/tmp/p10-probe/claude-cwd/notes.txt', content: 'x', structuredPatch: [], originalFile: null, userModified: false },
    tool_use_id: 'toolu_01CFP8EBwYibD1uwk5cUvUoH', duration_ms: 2,
  },
}
