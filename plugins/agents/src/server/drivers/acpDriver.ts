// Discovery is cheap. Protocol session ownership loads only when a session starts.
import { awaitWithSignal, startCancellation } from '../processes/startCancellation'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import { resolveUsageCommand, usageProcessEnv } from '../usage/processRunner'
import { harnessCapabilities, type HarnessLaunchSpec } from './harness'
import type { AgentDriver, AgentDriverSession, AgentDriverStartOptions } from './types'
import type { MeasureAgentStartup } from './startupTelemetry'

const DRIVER_VERSION = 'acp-1'

export type AcpLaunch = {
  // The argv the child runs. For the `entry` form this is the node binary plus the resolved adapter.
  file: string
  args: string[]
  // The harness's own CLI, if it has one: the `command` itself, or the CLI an adapter drives. The auth
  // probe asks about this, and the descriptor reports it.
  executable: string | null
  env: Record<string, string>
  diagnostics: string[]
}

export class AcpDriver implements AgentDriver {
  constructor(private readonly spec: HarnessLaunchSpec) {}

  get providerId(): string {
    return this.spec.id
  }

  get profileId(): string {
    return this.spec.profileId
  }

  // Collects the reasons a launch cannot resolve instead of throwing, so an unavailable harness shows
  // up in the Agent Center as a row with a diagnostic rather than as a failed discovery.
  private launch(): AcpLaunch {
    const processEnv = usageProcessEnv()
    const diagnostics: string[] = []
    let file: string
    let args: string[]
    let executable: string | null
    const env: Record<string, string> = { ...this.spec.env }

    if ('command' in this.spec.spawn) {
      executable = resolveUsageCommand(this.spec.spawn.command, processEnv)
      if (!executable) diagnostics.push(`${this.spec.spawn.command} is not available on PATH.`)
      file = executable ?? this.spec.spawn.command
      args = [...(this.spec.spawn.args ?? [])]
    } else {
      let adapter: string | null = null
      try {
        adapter = this.spec.spawn.entry()
      } catch {
        diagnostics.push(`The ${this.spec.label} ACP adapter is unavailable.`)
      }
      file = process.execPath
      args = [...(adapter ? [adapter] : []), ...(this.spec.spawn.args ?? [])]
      const requires = this.spec.spawn.requires
      executable = requires ? resolveUsageCommand(requires.command, processEnv) : null
      if (requires && !executable) diagnostics.push(`${requires.command} is not available on PATH.`)
      if (requires && executable) env[requires.env] = executable
      if (!adapter) file = ''
    }

    return { file, args, executable, env, diagnostics }
  }

  async probe(): Promise<AgentProviderDescriptor> {
    const launch = this.launch()
    return {
      id: this.spec.id,
      profileId: this.spec.profileId,
      label: this.spec.label,
      ...(this.spec.glyph ? { glyph: this.spec.glyph } : {}),
      driverKind: 'acp',
      driverVersion: DRIVER_VERSION,
      installed: launch.diagnostics.length === 0,
      authenticated: launch.executable && this.spec.probeAuth
        ? await this.spec.probeAuth(launch.executable)
        : null,
      ...(launch.executable ? { executable: launch.executable } : {}),
      statusAuthority: 'protocol',
      capabilities: harnessCapabilities(this.spec.quirks),
      configOptions: [],
      commands: [],
      skills: [],
      diagnostics: launch.diagnostics,
    }
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    const measure: MeasureAgentStartup = options.measureStartup ?? ((_phase, run) => run())
    const cancellation = startCancellation(options.signal)
    let cleanup: () => Promise<void> = async () => {}
    const scoped = {
      ...options,
      signal: cancellation.signal,
      onEvent: (event: Parameters<AgentDriverStartOptions['onEvent']>[0]) => {
        cancellation.signal.throwIfAborted()
        return options.onEvent(event)
      },
    }
    try {
      cancellation.signal.throwIfAborted()
      const launch = this.launch()
      if (launch.diagnostics.length) throw new Error(launch.diagnostics[0])
      const { startAcpSession } = await measure('driver.load', () => import('./acpSession'))
      cancellation.signal.throwIfAborted()
      const handle = await awaitWithSignal(startAcpSession(scoped, this.spec, launch, (stop) => { cleanup = stop }), cancellation.signal)
      cancellation.signal.throwIfAborted()
      return handle
    } catch (error) {
      await cleanup()
      throw error
    } finally {
      cancellation.dispose()
    }
  }

}
