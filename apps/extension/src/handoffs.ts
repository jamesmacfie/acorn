import type { BridgeHandoff } from '@acorn/protocol/extensionBridge.ts'
import { matchHandoffPage } from '@acorn/protocol/plugin/handoffs.ts'

// Browser handoffs inside the extension (docs/browser-extension/handoffs.md): which declared handoffs a
// page matches, and which site access shows their buttons. The background and the sidebar both match
// from the cached list, so a page address goes to the Node only when the person asks for a handoff.

// A handoff the person asked for on one page: a button click, or the sidebar's own offer.
export type PageHandoff = { pluginId: string; handoffId: string; label: string; url: string }

export const handoffKey = (handoff: Pick<BridgeHandoff, 'pluginId' | 'id'>): string =>
  `${handoff.pluginId}:${handoff.id}`

export const pageHandoffs = (handoffs: readonly BridgeHandoff[], url: string | undefined): BridgeHandoff[] =>
  url ? handoffs.filter((handoff) => matchHandoffPage(handoff, url)) : []

// The browser match pattern for each host a handoff's pages are on. The content-link grammar allows
// one `*.` host wildcard and https only, both of which match patterns can say.
export const siteAccess = (handoff: Pick<BridgeHandoff, 'match'>): string[] => [
  ...new Set(handoff.match.map((pattern) => `https://${new URL(pattern.replace(/\{[^}]*\}/g, 'x')).host}/*`)),
]

// Between the background and a page's content script. The background decides which buttons a page
// gets; the content script only draws them and reports a click.
export type ContentMessage = { type: 'acorn:buttons'; buttons: { key: string; label: string; anchors: string[] }[] }
export type ButtonClick = { type: 'acorn:handoff'; key: string }
