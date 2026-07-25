import type { PersistedStateSlice } from '../../core/client/persistence/persistedState'
import { coreStateSlices } from '../../core/client/persistence/stateSlices'
import { directPreferenceSlices } from '../../core/client/persistence/preferenceSlices'
import { editorOpenFilesSlice } from '../../plugins/editor/client/openFilesSlice'
import { prFiltersSlice } from '../../plugins/github/client/pullList/filterSlice'
import { contextSelectionSlice } from '../../plugins/context/client/selectionSlice'
import { dockerPrefsSlice } from '../../plugins/docker/client/dockerPrefs'

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
