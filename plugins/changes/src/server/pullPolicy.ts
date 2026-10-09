import type { CoreServices } from '@acorn/plugin-api/node'
import { GIT_PULL_POLICY_PREF } from '../contract/remote'

export const readPullPolicy = (prefs: CoreServices['prefs'], owner: string) => prefs.read(owner, GIT_PULL_POLICY_PREF)
