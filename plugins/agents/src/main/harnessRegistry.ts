// The consuming half of the harness seam: what plugins/agents does with a harness another plugin's
// manifest declared. See docs/managed-agents.md § Harnesses.
//
// The host has already done the parts only it can do — minted the runtime id from the plugin the
// descriptor arrived under, resolved an adapter entry inside that plugin's package, turned each probe
// route into a call (node-core/server/plugin/harnesses.ts). What is left is the translation into the
// same launch spec a built-in harness uses, so that nothing downstream can tell which feeder answered.
//
// One registration, up to three effects, all released together:
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

// The same ceiling the built-in CLI probes use. A probe is a background refresh, so a harness that hangs
// costs a stale row rather than a stuck pane.
const PROBE_TIMEOUT_MS = 5_000

const launchSpec = (harness: ManifestHarness): HarnessLaunchSpec => {
  // Bound here, not read inside the closure below: a lazy read of `harness.spawn` would lose the
  // narrowing this branch establishes.
  const spawn = harness.spawn
  return {
    id: harness.id,
    // A contributed harness's profile id is its harness id. The two only differ for
    // `claude`/`claude-code`, where both names predate this seam and both are persisted.
    profileId: harness.id,
    label: harness.label,
    ...(harness.glyph ? { glyph: harness.glyph } : {}),
    spawn: 'command' in spawn
      ? { command: spawn.command, args: spawn.args }
      : {
        // A constant rather than a resolution: the host already resolved this path inside the plugin's
        // package and confined it, so there is nothing left for the driver to look up.
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
          // An unparseable answer is "cannot tell", which is what the row already says for a harness with
          // no probe at all. Never `false`: claiming a signed-in account is signed out would send the
          // owner to re-authenticate something that was fine.
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
    // Derived here rather than declared, so one harness cannot call 5% healthy while another calls it
    // critical.
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
    // Neither is something a harness can answer about itself: cost needs the owner's pricing table and
    // the daily figures are read out of one specific CLI's transcript files.
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
  // No `headlessArgv`, `resumeArgv`, `aiArgv` or stream-JSON adapter, deliberately: those are conditional
  // argv assembly, and turning that into manifest data means inventing an argv template language. A
  // data-only harness works in the Agent pane and the terminal, and a workflow step cannot name it
  // (docs/plugin-authoring.md § Harnesses).
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
