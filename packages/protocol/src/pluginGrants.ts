import type { PluginContributions, PluginExtensionGrant, PluginKeyClaimGrant, PluginWebviewGrant } from './api'
import { isCoreExclusiveSlot, parseExtensionPointRef, qualifiedExtensionPointId } from './extensionPoints'
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

/**
 * Everything this manifest says about surfaces that are not its own, in BOTH directions.
 *
 * Both directions is the requirement, not a nicety. "This plugin extends that plugin" is a fact the
 * owner of the extending package must see before its rows appear somewhere unexpected — and the owner of
 * the extended package must see, because opening a point is opening a door. Neither is inferable from
 * the other side's manifest at trust time: they are two installs, possibly weeks apart.
 *
 * `pluginId` is passed in rather than read from the contributions, because a point's public name is
 * minted from the plugin the manifest was read from. A manifest that could state it could open a point
 * in another package's name.
 */
export const pluginExtensionGrants = (pluginId: string, contributions: PluginContributions): PluginExtensionGrant[] => [
  ...(contributions.extensionPoints ?? []).map((point): PluginExtensionGrant => ({
    kind: 'hosts',
    target: qualifiedExtensionPointId(pluginId, point.id),
    label: point.label,
  })),
  ...(contributions.extensions ?? []).flatMap((entry): PluginExtensionGrant[] => {
    // An unparseable reference is dropped rather than disclosed. The node refused it at parse and the
    // client refuses it again, so it will never deliver anything — and a consent line about a grant that
    // cannot exist is noise in the one list that must not have any.
    const ref = parseExtensionPointRef(entry.point)
    return ref ? [{ kind: 'extends', target: entry.point, label: entry.label }] : []
  }),
  ...(contributions.frames ?? []).flatMap((frame): PluginExtensionGrant[] =>
    frame.target === 'coreSlot' && isCoreExclusiveSlot(frame.coreSlot)
      ? [{ kind: 'replaces', target: frame.coreSlot, label: frame.label }]
      : []),
].sort((a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target))

export const pluginKeyClaimGrants = (contributions: PluginContributions): PluginKeyClaimGrant[] =>
  (contributions.frames ?? [])
    .flatMap((surface) => {
      const chords = [...new Set((surface.claimsKeys ?? []).filter(isPluginKeyClaim))].sort()
      return chords.length ? [{ surface: surface.id, label: surface.label, chords }] : []
    })
    .sort((a, b) => a.surface.localeCompare(b.surface))
