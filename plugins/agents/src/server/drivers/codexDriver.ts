// Discovery stays on the boot path; protocol session ownership loads after the launch check.
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import { awaitWithSignal, startCancellation } from '../processes/startCancellation'
import { resolveUsageCommand, usageProcessEnv } from '../usage/processRunner'
import type { MeasureAgentStartup } from './startupTelemetry'
import type { AgentDriver, AgentDriverSession, AgentDriverStartOptions } from './types'

const DRIVER_VERSION = 'codex-app-server-v2'

export class CodexAgentDriver implements AgentDriver {
  readonly providerId = 'codex'
  readonly profileId = 'codex'

  async probe(): Promise<AgentProviderDescriptor> {
    const env = usageProcessEnv()
    const executable = resolveUsageCommand('codex', env)
    let authenticated: boolean | null = null
    let version: string | undefined
    if (executable) {
      const probes = await import('./authProbe')
      authenticated = await probes.probeCodexAuthentication(executable)
      version = await probes.probeExecutableVersion(executable)
    }
    return {
      id: this.providerId,
      profileId: this.profileId,
      label: 'Codex',
      glyph: 'brand:agents/codex',
      driverKind: 'codex-app-server',
      driverVersion: DRIVER_VERSION,
      installed: executable != null,
      authenticated,
      executable: executable ?? undefined,
      executableVersion: version,
      statusAuthority: 'protocol',
      capabilities: [
        'streaming_messages',
        'reasoning',
        'tool_calls',
        'plans',
        'permissions',
        'questions',
        'elicitations',
        'models',
        'reasoning_levels',
        'modes',
        'permission_policies',
        'skills',
        'usage',
        'resume',
        'fork',
        'compact',
        'archive',
        'delete',
        'file_changes',
        'subagents',
        'attachments',
        'generated_artifacts',
      ],
      configOptions: [],
      commands: [],
      skills: [],
      diagnostics: executable ? [] : ['codex is not available on PATH.'],
    }
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
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
      const handle = await awaitWithSignal(this.startSession(scoped, (stop) => { cleanup = stop }), cancellation.signal)
      cancellation.signal.throwIfAborted()
      return handle
    } catch (error) {
      await cleanup()
      throw error
    } finally {
      cancellation.dispose()
    }
  }

  private async startSession(
    options: AgentDriverStartOptions,
    own: (stop: () => Promise<void>) => void,
  ): Promise<AgentDriverSession> {
    const measure: MeasureAgentStartup = options.measureStartup ?? ((_phase, run) => run())
    const descriptor = await measure('provider.probe', () => this.probe())
    options.signal?.throwIfAborted()
    if (!descriptor.executable) throw new Error('Codex is not available on PATH.')
    await options.onEvent({
      type: 'session_state',
      state: options.session.providerSessionRef ? 'replaying' : 'connecting',
    })

    const { startCodexSession } = await measure('driver.load', () => import('./codexStart'))
    options.signal?.throwIfAborted()
    return startCodexSession(options, descriptor.executable, own)
  }
}
