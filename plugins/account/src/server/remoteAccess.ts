import { hostname } from 'node:os'
import type { Context } from 'hono'
import { providerCredential, readNodeRelay, recordNodeRelay, type AppEnv } from '@acorn/plugin-api/node'
import type { AccountState, TurnedOff } from '../shared/state'
import { accountApi, AccountApiError } from './accountApi'
import { accountUrl } from './config'
import { ACCOUNT_PROVIDER } from './provider'

// Remote access: this Node registered with its owner's account, dialing the relay the account service
// named (docs/account-api.md § Remote access). The relay URL, the Node's relay credential, and the
// owner account are recorded in node.json, where the listener reads relay settings at every boot, so a
// Node that restarts is still reachable with no account code running.

// What stops the switch being turned on: a relay somebody set for this Node some other way.
export function blocker(c: Context<AppEnv>): string | undefined {
  if (process.env.ACORN_RELAY_URL || process.env.ACORN_RELAY_CREDENTIAL)
    return 'The relay is set in this Node’s environment, which takes the place of remote access.'
  const { relay, owner } = readNodeRelay(c.env.DATA_DIR)
  if (relay && !owner) return 'A relay is already set in this Node’s node.json.'
  return undefined
}

export function remoteAccessState(c: Context<AppEnv>): AccountState['remoteAccess'] {
  const { relay, owner } = readNodeRelay(c.env.DATA_DIR)
  const state = c.env.RELAY?.state()
  const blocked = blocker(c)
  return {
    enabled: !!relay && !!owner,
    ...(relay && owner ? { relayUrl: relay.url } : {}),
    connected: state?.connected ?? false,
    ...(state?.since ? { since: state.since } : {}),
    ...(blocked ? { blocked } : {}),
  }
}

// Register the Node, record what the service answered, and start the tunnel. Registering twice is fine:
// the service replaces the Node's credential.
export async function turnOn(c: Context<AppEnv>, account: { id: string }): Promise<void> {
  const token = await providerCredential(c, ACCOUNT_PROVIDER)
  if (!token) throw new AccountApiError(401, 'invalid_token')
  const { relay, keys } = await accountApi(accountUrl()).register(token, c.env.NODE_ID, {
    label: hostname().slice(0, 100) || 'This computer',
    fingerprint: c.env.NODE_FINGERPRINT,
  })
  recordNodeRelay(c.env.DATA_DIR, { relay, owner: { accountId: account.id, keys } })
  await c.env.RELAY?.apply(readNodeRelay(c.env.DATA_DIR).relay)
}

// Stop at once, whatever the account service says, and then tell it. A Node it can't reach stays listed
// there until the person removes it on the website, and the answer says so.
export async function turnOff(c: Context<AppEnv>): Promise<TurnedOff> {
  const { relay, owner } = readNodeRelay(c.env.DATA_DIR)
  if (!relay || !owner) return { accountNotified: true }
  recordNodeRelay(c.env.DATA_DIR, { relay: undefined, owner: undefined })
  await c.env.RELAY?.apply(undefined)
  const token = await providerCredential(c, ACCOUNT_PROVIDER)
  if (!token) return { accountNotified: false }
  try {
    await accountApi(accountUrl()).remove(token, c.env.NODE_ID)
    return { accountNotified: true }
  } catch (error) {
    // Already gone counts as told.
    return { accountNotified: error instanceof AccountApiError && error.code === 'not_found' }
  }
}
