// The account plugin's routes, called on the active Node (the Node whose settings are open).
import { activeNodeId, postJson, readJson, writeJson } from '@acorn/plugin-api/client'
import { accountRoute } from '../contract/routes'
import type { AccountState, TurnedOff } from '../shared/state'

export const fetchAccountState = (nodeId: string | null = activeNodeId()): Promise<AccountState> =>
  readJson<AccountState>(accountRoute('/state'), { nodeId })

export const signOut = (): Promise<TurnedOff> => postJson<TurnedOff>(accountRoute('/sign-out'))

export const setRemoteAccess = (enabled: boolean): Promise<AccountState['remoteAccess'] | TurnedOff> =>
  writeJson(accountRoute('/remote-access'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
