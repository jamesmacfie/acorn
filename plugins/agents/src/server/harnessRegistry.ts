// The consuming half of the harness seam: what plugins/agents does with a harness another plugin's
// manifest declared. See docs/managed-agents.md § Harnesses.
//
// The host already minted the runtime id, resolved the adapter entry inside the plugin's package, and
// turned each probe route into a call (node-core/server/pluginHost/harnesses.ts). What is left is the
// translation into the launch spec a built-in harness uses, so nothing downstream can tell the two
// apart. One registration, up to three effects, all released together:
//
//   the driver          always, because a harness with no driver is a menu entry that cannot run.
//   the usage collector only with `probes.usage`. Without it the pane shows no usage section.
//   the terminal profile only with `terminal`. Without it the harness is Agent-pane only.
import { agentProfileRegistry, type AgentProfileContribution, type Disposable, type HarnessRegistry, type ManifestHarness } from '@acorn/plugin-api/node'
import { harnessAuthProbeSchema, harnessUsageProbeSchema } from '../shared/harnessProbes'
import { usageHealth, worstUsageHealth, type AgentProviderUsageReading, type AgentUsageQuota } from '../shared/usage'
import { agentDriverRegistry, type AgentDriverRegistry } from './drivers/registry'
import type { HarnessLaunchSpec } from './drivers/harness'
import { agentUsageCollectors, type AgentUsageCollectorRegistry } from './usage/collectors'

// The same ceiling the built-in CLI probes use. A probe is a background refresh, so a harness that
// hangs costs a stale row rather than a stuck pane.
const PROBE_TIMEOUT_MS = 5_000

const launchSpec = (harness: ManifestHarness): HarnessLaunchSpec => {
  // Bound here, not read inside the closure below, which would lose this branch's narrowing.
  const spawn = harness.spawn
  return {
    id: harness.id,
    // A contributed harness's profile id is its harness id. The two differ only for
    // `claude`/`claude-code`, where both names predate this seam and both are persisted.
    profileId: harness.id,
    label: harness.label,
    ...(harness.glyph ? { glyph: harness.glyph } : {}),
    spawn: 'command' in spawn
      ? { command: spawn.command, args: spawn.args }
      : {
        // A constant, not a lookup: the host already resolved and confined this path inside the
        // plugin's package.
        entry: () => spawn.entry,
        args: spawn.args,
        ...(spawn.requires ? { requires: spawn.requires } : {}),
      },
    envPassthrough: harness.envPassthrough,
    quirks: harness.quirks,
    ...(harness.probeAuth
      ? {
        probeAuth: async () => {
          const answer = harnessAuthProbeSchema.safeParse(await harness.probeAuth!(AbortSignal.timeout(PROBE_TIMEOUT_MS)))
          // An unparseable answer means "cannot tell", the same as a harness with no probe. Never
          // `false`, which would send the owner to re-authenticate an account that was fine.
          return answer.success ? answer.data.authenticated ?? null : null
        },
      }
      : {}),
  }
}

const usageReading = (harness: ManifestHarness) => async (): Promise<AgentProviderUsageReading> => {
  const answer = harnessUsageProbeSchema.safeParse(await harness.probeUsage!(AbortSignal.timeout(PROBE_TIMEOUT_MS)))
  if (!answer.success) throw new Error(`The ${harness.label} usage probe answered a shape acorn cannot read.`)
  const quotas: AgentUsageQuota[] = answer.data.quotas.map((quota) => ({
    id: quota.id,
    label: quota.label,
    percentRemaining: quota.percentRemaining,
    resetsAt: quota.resetsAt ?? null,
    resetText: quota.resetText ?? null,
    // Derived, not declared, so one harness cannot call 5% healthy while another calls it critical.
    health: usageHealth(quota.percentRemaining),
  }))
  return {
    provider: harness.id,
    availability: 'available',
    health: worstUsageHealth(quotas),
    plan: answer.data.plan ?? null,
    account: answer.data.account
      ? { email: answer.data.account.email ?? null, organization: answer.data.account.organization ?? null }
      : null,
    quotas,
    // Neither is a harness's to answer: cost needs the owner's pricing table, and the daily figures
    // come out of one specific CLI's transcript files.
    cost: null,
    daily: null,
    capturedAt: Date.now(),
    stale: false,
    error: null,
  }
}

const terminalProfile = (harness: ManifestHarness): AgentProfileContribution => ({
  id: harness.id,
  label: harness.label,
  kind: 'agent',
  command: harness.terminal!.command,
  backendPreference: harness.terminal!.backendPreference,
  transport: 'pty',
  launchArgs: harness.terminal!.launchArgs,
  // No `headlessArgv`, `resumeArgv`, `aiArgv`, or stream-JSON adapter, on purpose: those need
  // conditional argv assembly, and putting that in manifest data means inventing a template language.
  // A data-only harness works in the Agent pane and the terminal, but no workflow step can name it.
  // See docs/plugin-authoring.md § Harnesses.
})

export function createHarnessRegistry(deps: {
  drivers?: AgentDriverRegistry
  collectors?: AgentUsageCollectorRegistry
  profiles?: Pick<typeof agentProfileRegistry, 'register'>
} = {}): HarnessRegistry {
  const drivers = deps.drivers ?? agentDriverRegistry
  const collectors = deps.collectors ?? agentUsageCollectors
  const profiles = deps.profiles ?? agentProfileRegistry
  return {
    register: (harness): Disposable => {
      const undo = [drivers.register(launchSpec(harness))]
      if (harness.probeUsage) {
        undo.push(collectors.register({
          provider: harness.id,
          label: harness.label,
          ...(harness.glyph ? { glyph: harness.glyph } : {}),
          collect: usageReading(harness),
        }))
      }
      if (harness.terminal) undo.push(profiles.register(terminalProfile(harness)))
      let disposed = false
      return {
        dispose: () => {
          if (disposed) return
          disposed = true
          for (const release of undo) release()
        },
      }
    },
  }
}
