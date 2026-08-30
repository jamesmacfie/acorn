import type { PluginContributions, PluginExtensionGrant, PluginHarnessGrant, PluginKeyClaimGrant, PluginScheduleGrant, PluginTaskCheckGrant, PluginWebviewGrant } from '../api'
import {
  isCoreExclusiveSlot,
  isExtensionPointKind,
  isHookMode,
  parseExtensionPointRef,
  qualifiedExtensionPointId,
  type ExtensionPointKind,
} from '../extensionPoints'
import { isPluginKeyClaim } from '../keybindings'
import { normalizeWebviewHost } from '../webview'

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
 * Which kind a contribution brings, read off the carrier it named rather than off the owner's
 * declaration, because a contributor's manifest cannot see the owner's.
 *
 * `items` is the one ambiguity: rows and annotations are both descriptors on a route, and only the
 * owner's point says which. The grant says `rows`, and the sentence written from it stays true either
 * way, because what a person is consenting to is "this package's records appear inside that one's
 * surface". The host resolves the real kind at delivery.
 */
const contributedPointKind = (entry: { remote?: string; frame?: string; route?: string }): ExtensionPointKind => {
  if (entry.remote !== undefined) return 'remote'
  if (entry.frame !== undefined) return 'rectangle'
  if (entry.route !== undefined) return 'hook'
  return 'rows'
}

/**
 * Everything this manifest says about surfaces that are not its own, in both directions. See
 * docs/plugins.md § Cooperative extension points for why both directions matter and appear in the
 * trust prompt.
 *
 * `pluginId` is passed in rather than read from the contributions, because a point's public name is
 * minted from the plugin the manifest was read from. A manifest that could state it could open a
 * point in another package's name.
 */
export const pluginExtensionGrants = (pluginId: string, contributions: PluginContributions): PluginExtensionGrant[] => [
  ...(contributions.extensionPoints ?? []).flatMap((point): PluginExtensionGrant[] =>
    // A kind this build has no sentence for is dropped rather than disclosed with a guess. Same rule
    // as the unparseable reference below: better a missing line than one that describes the wrong
    // thing, and the roster row already records what this shell could not read.
    isExtensionPointKind(point.kind)
      ? [{
        kind: 'hosts',
        pointKind: point.kind,
        target: qualifiedExtensionPointId(pluginId, point.id),
        label: point.label,
      }]
      : []),
  ...(contributions.extensions ?? []).flatMap((entry): PluginExtensionGrant[] => {
    // An unparseable reference is dropped rather than disclosed. The node refused it at parse and the
    // client refuses it again, so it will never deliver anything. A consent line about a grant that
    // cannot exist is noise in the one list that must not have any.
    const ref = parseExtensionPointRef(entry.point)
    if (!ref) return []
    return [{
      kind: 'extends',
      pointKind: contributedPointKind(entry),
      ...(isHookMode(entry.mode) ? { mode: entry.mode } : {}),
      target: entry.point,
      label: entry.label,
    }]
  }),
  ...(contributions.frames ?? []).flatMap((frame): PluginExtensionGrant[] =>
    frame.target === 'coreSlot' && isCoreExclusiveSlot(frame.coreSlot)
      ? [{ kind: 'replaces', target: frame.coreSlot, label: frame.label }]
      : []),
].sort((a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target))

/** What this package will run on its own, and how often. See docs/plugins.md § Loaded plugins: the
 *  client half (the `schedules` entry) for why the `run` route itself is not part of the grant. */
export const pluginScheduleGrants = (contributions: PluginContributions): PluginScheduleGrant[] =>
  (contributions.schedules ?? [])
    .map((schedule) => ({ id: schedule.id, label: schedule.name, cadence: schedule.cadence }))
    .sort((a, b) => a.id.localeCompare(b.id))

/** What this package will say, and possibly do, when a task is archived. See docs/plugins.md §
 *  Loaded plugins: the client half (task checks) for why neither route is part of the grant. */
export const pluginTaskCheckGrants = (contributions: PluginContributions): PluginTaskCheckGrant[] =>
  (contributions.taskChecks ?? [])
    .map((check) => ({ id: check.id, cleansUp: check.apply !== undefined }))
    .sort((a, b) => a.id.localeCompare(b.id))

/** What this package asks acorn to run as a managed agent, and what it carries into it. See
 *  docs/managed-agents.md § Harnesses. There is no route here: the whole grant is the program and its
 *  environment.
 *
 *  A descriptor declaring neither a command nor an entry is dropped rather than disclosed, like an
 *  unparseable extension reference. The node refused it at parse, so it can never run, and a consent
 *  line about a grant that cannot exist is noise in the one list that must not have any. */
export const pluginHarnessGrants = (contributions: PluginContributions): PluginHarnessGrant[] =>
  (contributions.harnesses ?? [])
    .flatMap((harness): PluginHarnessGrant[] => {
      const args = (harness.spawn.args ?? []).join(' ')
      const target = harness.spawn.command ?? harness.spawn.entry
      if (!target) return []
      return [{
        id: harness.id,
        label: harness.label,
        kind: harness.spawn.command ? 'command' : 'entry',
        run: args ? `${target} ${args}` : target,
        env: [...new Set(harness.envPassthrough ?? [])].sort(),
      }]
    })
    .sort((a, b) => a.id.localeCompare(b.id))

export const pluginKeyClaimGrants = (contributions: PluginContributions): PluginKeyClaimGrant[] =>
  (contributions.frames ?? [])
    .flatMap((surface) => {
      const chords = [...new Set((surface.claimsKeys ?? []).filter(isPluginKeyClaim))].sort()
      return chords.length ? [{ surface: surface.id, label: surface.label, chords }] : []
    })
    .sort((a, b) => a.surface.localeCompare(b.surface))
