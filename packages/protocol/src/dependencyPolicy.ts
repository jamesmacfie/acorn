import { capabilityId } from './plugin/ids'

/** Passive, bounded project policy facts. Values are intentionally omitted: credentials may occur in config. */
export type StaticDependencyPolicy = {
  manager: 'npm' | 'pnpm' | 'unsupported' | 'unknown'
  managerVersion: string | null
  policyKeys: string[]
  limits: string[]
}
export const STATIC_DEPENDENCY_POLICY = capabilityId<{ read(root: string): Promise<StaticDependencyPolicy> }>('changes.staticDependencyPolicy')
