// Translate loaded harness and custom-agent descriptors after all plugins have initialized: the
// agents capability is provided during init, regardless of where agents appears in the roster.
import type { Env } from '../bindings'
import { resolveInRoot } from '../core/fs'
import { createLogger } from '../telemetry/logger'
import type { LoadedPluginBinding } from './context'
import type { HostPluginContext } from './types'
import { dispatchPluginRoute } from './dispatch'
import { qualifiedHarnessId, type ManifestHarnessSpawn } from './harnesses'

const harnessLog = createLogger('harness')

export function registerManifestHarnesses(
  ctx: Pick<HostPluginContext, 'harnesses'>,
  name: string,
  binding: LoadedPluginBinding | undefined,
  requireEnv: (name: string) => Env,
): void {
  for (const descriptor of binding?.harnesses ?? []) {
    let spawn: ManifestHarnessSpawn
    if (descriptor.spawn.command !== undefined) {
      spawn = { command: descriptor.spawn.command, args: descriptor.spawn.args }
    } else {
      const resolved = binding?.dir ? resolveInRoot(binding.dir, descriptor.spawn.entry!) : null
      if (!resolved) {
        createLogger(`plugin:${name}`, name).warn(`harness '${descriptor.id}' declares an entry outside its package; skipped`)
        continue
      }
      spawn = {
        entry: resolved,
        args: descriptor.spawn.args,
        ...(descriptor.spawn.requires ? { requires: descriptor.spawn.requires } : {}),
      }
    }
    // A harness without a probe can register without host bindings. Resolve those only on a probe.
    const probe = (path: string) => async (signal: AbortSignal): Promise<unknown> => {
      const response = await dispatchPluginRoute(requireEnv(name), name, path, { method: 'GET' }, signal)
      if (!response.ok) {
        harnessLog.warn(`${name}:${descriptor.id} answered ${response.status} from ${path}`)
        return null
      }
      return await response.json().catch(() => null)
    }
    ctx.harnesses.register({
      id: descriptor.id,
      label: descriptor.label,
      ...(descriptor.glyph ? { glyph: descriptor.glyph } : {}),
      spawn,
      envPassthrough: descriptor.envPassthrough,
      quirks: descriptor.quirks,
      ...(descriptor.terminal ? { terminal: descriptor.terminal } : {}),
      ...(descriptor.oneShot ? { oneShot: descriptor.oneShot } : {}),
      ...(descriptor.probes?.usage ? { probeUsage: probe(descriptor.probes.usage) } : {}),
      ...(descriptor.probes?.auth ? { probeAuth: probe(descriptor.probes.auth) } : {}),
    })
  }
}

export function registerManifestCustomAgents(
  ctx: Pick<HostPluginContext, 'customAgents'>,
  name: string,
  binding: LoadedPluginBinding | undefined,
): void {
  const own = new Set((binding?.harnesses ?? []).map((harness) => harness.id))
  for (const descriptor of binding?.customAgents ?? []) {
    ctx.customAgents.register({
      id: descriptor.id,
      name: descriptor.name,
      ...(descriptor.glyph ? { glyph: descriptor.glyph } : {}),
      ...(descriptor.description ? { description: descriptor.description } : {}),
      providerId: own.has(descriptor.harness) ? qualifiedHarnessId(name, descriptor.harness) : descriptor.harness,
      options: descriptor.options,
      ...(descriptor.instructions ? { instructions: descriptor.instructions } : {}),
      ...(descriptor.maxToolRisk ? { maxToolRisk: descriptor.maxToolRisk } : {}),
    })
  }
}
