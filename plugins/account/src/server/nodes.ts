import type { NodePlugin, NodeProviderCaller, ProvidedNodeRecord } from '@acorn/plugin-api/node'
import { nodeAddress } from '@acorn/protocol/relay.ts'
import { accountApi } from './accountApi'
import { accountUrl } from './config'
import { ACCOUNT_PROVIDER } from './provider'

type Providers = Parameters<NonNullable<NodePlugin['init']>>[0]['providers']

// The account's Nodes as a node provider (docs/account-api.md § List the account's Nodes, and
// docs/plugins/node-providers.md § Node providers). It holds a sign-in and no device token, so a client
// that adopts one of these pairs by approval, with an assertion from here.

// Signed out means no Nodes to list and no call to the account service.
const withToken = <T>(providers: Providers, caller: NodeProviderCaller, use: (token: string) => Promise<T>) =>
  providers.withConnection(caller.userId, ACCOUNT_PROVIDER, (_connection, token) => use(token))

export async function listNodes(providers: Providers, caller: NodeProviderCaller): Promise<ProvidedNodeRecord[]> {
  const listed = await withToken(providers, caller, (token) => accountApi(accountUrl()).nodes(token))
  return (listed?.nodes ?? []).map((node) => ({
    providerNodeId: node.nodeId,
    nodeId: node.nodeId,
    label: node.label,
    endpoint: nodeAddress({ endpoint: '', relay: { url: node.relayUrl, route: node.nodeId } }),
    fingerprint: node.fingerprint,
    state: 'ready',
  }))
}

export async function assertionFor(
  providers: Providers,
  caller: NodeProviderCaller,
  providerNodeId: string,
): Promise<string> {
  const issued = await withToken(providers, caller, (token) =>
    accountApi(accountUrl()).assertion(token, providerNodeId),
  )
  if (!issued) throw new Error('Sign in to your acorn account first.')
  return issued.assertion
}
