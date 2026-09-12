import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import type { ModelBackendsResponse } from '@acorn/protocol/modelProviders.ts'
import type { FindingsReviewSettings } from '../contract/lifecycle'
import { findingsSettingsRoute } from '../contract/lifecycle'
import type { FindingBundle } from '../contract/review'
import type { FindingListOptions, FindingListPage, FindingObservation } from '../contract/records'
import { findingsGetRoute, findingsListRoute } from '../shared/api'

export const findingsTreeClient = (bridge: AcornBridge) => ({
  listTask: (taskId: string, options?: FindingListOptions) => bridge.api.get<FindingListPage>(findingsListRoute(taskId, options)),
  getTask: (taskId: string, id: string) => bridge.api.get<FindingObservation>(findingsGetRoute(taskId, id)),
  bundles: (taskId: string) => bridge.api.get<FindingBundle[]>(`/v2/p/findings/tasks/${encodeURIComponent(taskId)}/review/bundles`),
  settings: () => bridge.api.get<FindingsReviewSettings>(findingsSettingsRoute),
  saveSettings: (settings: FindingsReviewSettings) => bridge.api.put<FindingsReviewSettings>(findingsSettingsRoute, settings),
  modelBackends: () => bridge.api.get<ModelBackendsResponse>('/v2/p/findings/models'),
})
