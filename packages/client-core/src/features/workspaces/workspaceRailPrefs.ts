import type { QueryClient } from '@tanstack/solid-query'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { savePref } from '../settings/savePref'

export const workspaceRailShown = (prefs: Record<string, string> | undefined): boolean => prefs?.[PrefKeys.workspaceRail] === 'true'
export const saveWorkspaceRailShown = (qc: QueryClient, shown: boolean): Promise<boolean> =>
  savePref(qc, PrefKeys.workspaceRail, String(shown), { throwOnFailure: true })
