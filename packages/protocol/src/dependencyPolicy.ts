import { capabilityId } from './plugin/ids'

/** Passive, bounded project policy facts. Never includes credentials or executable configuration. */
export type StaticDependencyPolicy = {
  manager: 'npm' | 'pnpm' | 'unsupported' | 'unknown'
  managerVersion: string | null
  policyKeys: string[]
  releaseAgeMinutes: number | null
  ignoreScripts: boolean | null
  buildApprovalCount: number | null
  buildIgnoreCount: number | null
  allowAllBuilds: boolean | null
  releaseAgeExceptionCount: number | null
  registryOrigins: string[]
  sourcePolicyKeys: string[]
  limits: string[]
}
export const STATIC_DEPENDENCY_POLICY = capabilityId<{ read(root: string, signal?: AbortSignal): Promise<StaticDependencyPolicy> }>('changes.staticDependencyPolicy')
