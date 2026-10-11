import type { CoreServices } from '@acorn/plugin-api/node'
import { PULL_POLICY_PREF } from '../settings'

export const readPullPolicy = (prefs: CoreServices['prefs'], owner: string) => prefs.read(owner, PULL_POLICY_PREF)
