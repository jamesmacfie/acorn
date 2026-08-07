// The terminal plugin's HTTP route builders.
//
// In contract/ rather than shared/ because plugins/docker's container detail view links to a terminal
// session, and contract/ is the one sanctioned cross-plugin surface (docs/plugins.md § Package shape).
// Moved verbatim out of @acorn/protocol/api.ts.

export const terminalSessionsRoute = '/v2/p/terminal/sessions'
export const terminalProfilesRoute = '/v2/p/terminal/profiles'
export const terminalSessionActionRoute = (sid: string, action: 'kill' | 'interrupt' | 'remove' | 'resize' | 'send') =>
  `/v2/p/terminal/sessions/${encodeURIComponent(sid)}/${action}`
