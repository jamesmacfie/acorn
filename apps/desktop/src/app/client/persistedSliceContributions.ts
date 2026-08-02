import type { PersistedStateSlice } from '@acorn/client-core/persistence/persistedState.ts'
import { coreStateSlices } from '@acorn/client-core/persistence/stateSlices.ts'
import { directPreferenceSlices } from '@acorn/client-core/persistence/preferenceSlices.ts'
import { editorOpenFilesSlice } from '@acorn/plugin-editor/client/openFilesSlice.ts'
import { prFiltersSlice } from '@acorn/plugin-github/client/pullList/filterSlice.ts'
import { contextSelectionSlice } from '@acorn/plugin-context/client/selectionSlice.ts'
import { dockerPrefsSlice } from '@acorn/plugin-docker/client/dockerPrefs.ts'

// The shipped set of persisted-state descriptors. Choosing which features persist state is
// composition, so the list lives here and core never imports a feature store
// (docs/plugins.md, docs/state.md). persistedState.conformance.test.ts asserts over this same list,
// so a feature slice cannot skip the descriptor contract by living outside core.
export const persistedSliceContributions: readonly PersistedStateSlice<unknown>[] = [
  ...coreStateSlices,
  editorOpenFilesSlice,
  prFiltersSlice,
  contextSelectionSlice,
  dockerPrefsSlice,
  ...directPreferenceSlices,
] as readonly PersistedStateSlice<unknown>[]
