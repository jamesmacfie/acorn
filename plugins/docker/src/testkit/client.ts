// The client half of this package's test seam (docs/architecture-overview.md § Package
// boundaries). This package contributes nothing a node test needs, so there is no ./index.ts.
//
//   apps/desktop/test/integration/persistedState.conformance.test.ts   dockerPrefsSlice
export { dockerPrefsSlice } from '../client/dockerPrefs'
