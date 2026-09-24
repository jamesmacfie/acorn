// The client half of this package's test seam. See ./index.ts.
//
//   apps/desktop/test/integration/taskBridge.test.ts   terminalApi
export { terminalApi } from '../client/terminalClient'
export { activeTerminal, initSessions, rememberActiveTerminal, sessions } from '../client/sessionStore'
