// The client half of this package's test seam (docs/architecture/packages.md § Package
// boundaries). This package contributes nothing a node test needs, so there is no node half.
//
//   apps/desktop/test/integration/persistedState.conformance.test.ts   contextSelectionSlice
export { contextSelectionSlice } from '../client/selectionStore'
