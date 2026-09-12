import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

export type FindingsReviewSettings = {
  automaticPreparation: boolean
  notifyWhenReady: boolean
  backendId: string | null
  modelId: string | null
}

export const DEFAULT_FINDINGS_SETTINGS: FindingsReviewSettings = {
  automaticPreparation: false,
  notifyWhenReady: false,
  backendId: null,
  modelId: null,
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

export type FindingsLegacyMapping = {
  migrationVersion: number
  legacyId: string
  sourceFilename: string
  sourceHash: string
  status: 'pending' | 'accepted' | 'rejected' | 'error' | 'changed'
  observationId: string | null
  candidateId: string | null
  candidateRevision: number | null
  candidatePayloadHash: string | null
  oneToOne: boolean
  error: string | null
}

export type FindingsMigrationReport = {
  version: number
  cutoverReady: boolean
  files: number
  imported: { pending: number; accepted: number; rejected: number }
  errors: number
  changed: number
  mappings: FindingsLegacyMapping[]
}

export type FindingsLifecycleCapability = {
  boundary(input: FindingsBoundaryInput): Promise<FindingsLifecycleCheckpoint>
  reconcile(): Promise<void>
  settings(userId: string): Promise<FindingsReviewSettings>
  setSettings(userId: string, settings: FindingsReviewSettings): Promise<FindingsReviewSettings>
  migrationReport(): Promise<FindingsMigrationReport>
  legacyMapping(legacyId: string): Promise<FindingsLegacyMapping | null>
  dismissLegacy(legacyId: string, actorId: string): Promise<boolean>
  export(): Promise<unknown>
}

export const FINDINGS_LIFECYCLE = capabilityId<FindingsLifecycleCapability>('findings.lifecycle.v1')

export const findingsSettingsRoute = '/v2/p/findings/settings'
export const findingsMigrationReportRoute = '/v2/p/findings/migration/report'
export const findingsExportRoute = '/v2/p/findings/export'
