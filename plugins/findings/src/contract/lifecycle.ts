import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

export type FindingsReviewSettings = {
  automaticPreparation: boolean
  notifyWhenReady: boolean
  backendId: string | null
  modelId: string | null
  targetId: string | null
}

export const DEFAULT_FINDINGS_SETTINGS: FindingsReviewSettings = {
  // Retained in the persisted shape for compatibility. Review is automatic at the task-archive
  // boundary whenever a model backend is configured; choosing no backend is the off switch.
  automaticPreparation: true,
  notifyWhenReady: false,
  backendId: null,
  modelId: null,
  targetId: null,
}

export type FindingsBoundaryInput = {
  taskId: string
  boundaryKey: string
  sourceKind: 'agent' | 'terminal' | 'workflow' | 'task-archive'
  sourceVersion: string
  title: string
  body: string | null
  availability: 'available' | 'unavailable'
  unavailableReason?: string
  completedAt: number
}

export type FindingsLifecycleCheckpoint = FindingsBoundaryInput & {
  observationId: string | null
  preparedBundleId: string | null
  updatedAt: number
}

export type FindingsLifecycleCapability = {
  boundary(input: FindingsBoundaryInput): Promise<FindingsLifecycleCheckpoint>
  reconcile(): Promise<void>
  settings(userId: string): Promise<FindingsReviewSettings>
  setSettings(userId: string, settings: FindingsReviewSettings): Promise<FindingsReviewSettings>
  export(): Promise<unknown>
}

export const FINDINGS_LIFECYCLE = capabilityId<FindingsLifecycleCapability>('findings.lifecycle.v1')

export const findingsSettingsRoute = '/v1/p/findings/settings'
export const findingsExportRoute = '/v1/p/findings/export'
