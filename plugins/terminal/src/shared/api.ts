// The terminal plugin's HTTP route builders.
//
// In shared/ because Terminal's client and server use the same paths. Other plugins use their
// narrow Terminal contracts instead of constructing these routes.
// Moved verbatim out of @acorn/protocol/api.ts.

export const terminalSessionsRoute = '/v1/p/terminal/sessions'
export const terminalProfilesRoute = '/v1/p/terminal/profiles'
export const terminalSessionActionRoute = (sid: string, action: 'kill' | 'interrupt' | 'remove' | 'resize' | 'send') =>
  `/v1/p/terminal/sessions/${encodeURIComponent(sid)}/${action}`
// Run the project's setup script in a task's existing worktree (docs/workspaces-and-tasks/worktrees.md).
export const terminalTaskSetupRoute = (taskId: string) => `/v1/p/terminal/tasks/${encodeURIComponent(taskId)}/setup`
