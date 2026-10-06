// Discovery stays on the boot path; protocol session ownership loads after the launch check.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import { awaitWithSignal, startCancellation } from '../processes/startCancellation'
import { resolveUsageCommand, usageProcessEnv } from '../usage/processRunner'
import { probeCodexAuthentication } from './authProbe'
import type { AgentDriver, AgentDriverSession, AgentDriverStartOptions } from './types'

const execFileAsync = promisify(execFile)
const DRIVER_VERSION = 'codex-app-server-v2'

async function executableVersion(executable: string): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, ['--version'], { timeout: 3_000, encoding: 'utf8' })
    return (stdout || stderr).trim().split(/\r?\n/)[0] || undefined
  } catch {
    return undefined
  }
}

export class CodexAgentDriver implements AgentDriver {
  readonly providerId = 'codex'
  readonly profileId = 'codex'

  async probe(): Promise<AgentProviderDescriptor> {
    const env = usageProcessEnv()
    const executable = resolveUsageCommand('codex', env)
    return {
      id: this.providerId,
      profileId: this.profileId,
      label: 'Codex',
      glyph: 'brand:agents/codex',
      driverKind: 'codex-app-server',
      driverVersion: DRIVER_VERSION,
      installed: executable != null,
      authenticated: executable ? await probeCodexAuthentication(executable) : null,
      executable: executable ?? undefined,
      executableVersion: executable ? await executableVersion(executable) : undefined,
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
    const descriptor = await this.probe()
    options.signal?.throwIfAborted()
    if (!descriptor.executable) throw new Error('Codex is not available on PATH.')
    await options.onEvent({
      type: 'session_state',
      state: options.session.providerSessionRef ? 'replaying' : 'connecting',
    })

    const { startCodexSession } = await import('./codexStart')
    options.signal?.throwIfAborted()
    return startCodexSession(options, descriptor.executable, own)
  }
}
