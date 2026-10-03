import type { Integration } from '@acorn/protocol/api.ts'
import { connectionName, type PublicIntegrationProvider } from '@acorn/protocol/integrations.ts'
import type { SettingsNavigate } from '../../../host/registries/shell/settings'
import { createDetailRequest } from '../settingsDetail'

// The Connections group's two pages and what they share (docs/integrations/settings.md § Settings). Services
// lists the connections that feed the rail and the agents: issue trackers, error trackers, GitHub,
// telemetry export. AI models lists the keys a Generate control spends, beside the agent CLIs this
// machine has. Both draw the same connection page and the same Add connection gallery, and each
// connection is listed on exactly one of them, chosen by its provider's kind.
//
// Services keeps the page id `integrations`, because plugins and notices deep-link to it by that id.

export const SERVICES_PAGE = 'integrations'
export const AI_MODELS_PAGE = 'ai-models'

export const isModelProvider = (provider: PublicIntegrationProvider | undefined): boolean => provider?.kind === 'model-provider'

/** The page that lists a connection. A connection whose provider this node no longer registers is
 *  listed as a service, so it stays in sight rather than vanishing from both pages. */
export const connectionPageOf = (provider: PublicIntegrationProvider | undefined): string =>
  isModelProvider(provider) ? AI_MODELS_PAGE : SERVICES_PAGE

/** A connection that needs its owner first, keeping the node's order otherwise. */
export const needsYouFirst = (connections: readonly Integration[]): Integration[] =>
  [...connections].sort((a, b) => Number(b.status === 'needs-auth') - Number(a.status === 'needs-auth'))

/** A list row's description: the provider and account when the name does not already say them, then
 *  the reason when something is wrong. The row's badge says the status itself. */
export function connectionRowText(connection: Integration, provider: PublicIntegrationProvider | undefined): string | undefined {
  const where = [provider?.label ?? connection.providerId, connection.account?.label].filter(Boolean).join(' · ')
  const parts = [where && where !== connectionName(connection) ? `${where}.` : '']
  if (connection.status === 'needs-auth' || connection.status === 'degraded') parts.push(connectionStatusText(connection, provider))
  return parts.filter(Boolean).join(' ') || undefined
}

/** The badge beside a connection: danger for one that needs its owner, amber for one that did not
 *  answer, plain for one that is off. */
export const connectionTone = (connection: Integration): 'ok' | 'warn' | 'danger' | 'neutral' =>
  connection.status === 'connected' ? 'ok' : connection.status === 'disabled' ? 'neutral' : connection.status === 'needs-auth' ? 'danger' : 'warn'

const STATUS_LABELS = { 'needs-auth': 'Needs you', degraded: 'Not answering', disabled: 'Off', connected: 'Connected' } as const
/** The badge's word. */
export const connectionStatusLabel = (connection: Integration): string => STATUS_LABELS[connection.status]

/** One sentence about how a connection is doing, for its row and its page. */
export function connectionStatusText(connection: Integration, provider: PublicIntegrationProvider | undefined): string {
  const label = provider?.label ?? connection.providerId
  switch (connection.status) {
    case 'needs-auth':
      return connection.lastError === 'provider_secret_unreadable'
        ? "acorn couldn't read the saved key. Replace it to get updates again."
        : `${label} rejected the key. Replace it to get updates again.`
    case 'degraded':
      return `${label} didn't answer the last check. acorn keeps trying.`
    case 'disabled':
      return "Off. acorn doesn't fetch anything from it until you turn it on."
    default:
      return 'Connected.'
  }
}

/** What a provider asks for, in the labels it declares: "Personal API key", "DSN and Environment". */
export function providerAsks(provider: PublicIntegrationProvider): string {
  if (provider.connection.kind === 'device-flow') return 'Sign in with a code'
  const labels = provider.connection.fields.filter((field) => field.required).map((field) => field.label)
  if (!labels.length) return 'Nothing to enter'
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

export type GalleryCard = {
  provider: PublicIntegrationProvider
  connections: Integration[]
  /** At its `maxConnections`: the card says it is connected and opens the connection instead. */
  full: boolean
}

/** Every provider someone can connect, in the node's order. A provider at its limit stays in the
 *  gallery marked as connected, rather than vanishing and leaving the reader to wonder where it went. */
export function galleryCards(providers: readonly PublicIntegrationProvider[], connections: readonly Integration[]): GalleryCard[] {
  return providers
    .filter((provider) => provider.connection.connectable)
    .map((provider) => {
      const own = connections.filter((connection) => connection.providerId === provider.id)
      const max = provider.connection.maxConnections
      return { provider, connections: own, full: max !== undefined && own.length >= max }
    })
}

// A connection page and the gallery are details of a list page (../settingsDetail.ts), not pages of
// their own, so a link from elsewhere in settings travels as a detail request. It names its page,
// because the page on screen may be the other one of the two.
export type ConnectionRequest = { kind: 'connection'; id: string } | { kind: 'add' }
const requests = createDetailRequest<ConnectionRequest>()
/** The request waiting for `page`, taken so it opens once. */
export const takeConnectionRequest = requests.take

/** Open one connection's page, on whichever page lists it. */
export function openConnectionPage(navigate: SettingsNavigate, connection: Integration, provider: PublicIntegrationProvider | undefined): void {
  requests.open(navigate, connectionPageOf(provider), { kind: 'connection', id: connection.id })
}
