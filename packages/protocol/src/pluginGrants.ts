import type { PluginContributions, PluginKeyClaimGrant, PluginWebviewGrant } from './api'
import { isPluginKeyClaim } from './keybindings'
import { normalizeWebviewHost } from './webview'

/** Canonical executable-surface grants derived from a manifest. Both the consent UI and the desktop
 * main process use these projections, so bundled auto-trust and an owner click authorize the same
 * exact capabilities. */
export const pluginWebviewGrants = (contributions: PluginContributions): PluginWebviewGrant[] =>
  (contributions.frames ?? [])
    .filter((surface) => surface.target === 'webview' && surface.hosts?.length)
    .flatMap((surface) => {
      try {
        return [{
          surface: surface.id,
          label: surface.label,
          hosts: [...new Set(surface.hosts!.map((host) => normalizeWebviewHost(host)))].sort(),
        }]
      } catch {
        return []
      }
    })
    .sort((a, b) => a.surface.localeCompare(b.surface))

export const pluginKeyClaimGrants = (contributions: PluginContributions): PluginKeyClaimGrant[] =>
  (contributions.frames ?? [])
    .flatMap((surface) => {
      const chords = [...new Set((surface.claimsKeys ?? []).filter(isPluginKeyClaim))].sort()
      return chords.length ? [{ surface: surface.id, label: surface.label, chords }] : []
    })
    .sort((a, b) => a.surface.localeCompare(b.surface))
