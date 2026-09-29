// The client half of this package's test seam. See ./index.ts.
//
//   apps/desktop/test/integration/persistedState.conformance.test.ts   agentToolFoldSlice, sessionOrderSlice
//   apps/desktop/src/client/scopedEviction.test.ts                 managedAgentStore
export { agentToolFoldSlice } from '../client/sessions/toolFoldPrefs'
export { sessionOrderSlice } from '../client/sessions/sessionOrder'
export { managedAgentStore } from '../client/sessions/managedStore'
