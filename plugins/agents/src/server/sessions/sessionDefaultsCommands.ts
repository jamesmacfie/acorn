import type { CoreServices } from '@acorn/plugin-api/node'
import type { AgentConfigOption, AgentSession } from '../../contract/wire.ts'
import { effectiveAgentDefaults, optionsWithDefaults, rememberAgentDefaults } from '../../shared/sessionDefaults'
import { readAgentSessionDefaults, writeAgentSessionDefaults } from '../sessionDefaultsStore'
import type { AgentStore } from './store'

type SessionDefaultsDependencies = {
  store: Pick<AgentStore, 'requireSession'>
  prefs: CoreServices['prefs']
  currentUserId(): string | null
  patchSession(
    sessionId: string,
    patch: { config: Record<string, unknown> },
    options: { remember: false },
  ): Promise<AgentSession>
  recordWarning(sessionId: string, message: string): Promise<void>
}

/** Applies provider-advertised options after startup and carries chosen values between sessions. */
export class SessionDefaultsCommands {
  constructor(private readonly deps: SessionDefaultsDependencies) {}

  async applySaved(sessionId: string, providerId: string): Promise<void> {
    const userId = this.deps.currentUserId()
    if (!userId) return
    const stored = await readAgentSessionDefaults(this.deps.prefs, userId)
    const wanted = effectiveAgentDefaults(stored, providerId)
    if (!Object.keys(wanted).length) return
    const session = await this.deps.store.requireSession(sessionId)
    const advertised = Array.isArray(session.config.configOptions)
      ? session.config.configOptions as AgentConfigOption[]
      : []
    const configOptions = optionsWithDefaults(advertised, wanted)
    if (configOptions === advertised) return
    // Applying a saved value must not write the same value back as a new preference.
    await this.deps.patchSession(sessionId, { config: { ...session.config, configOptions } }, { remember: false })
      .catch(async (error) => {
        await this.deps.recordWarning(sessionId,
          `Your saved defaults could not be applied to this session: ${error instanceof Error ? error.message : 'unknown error'}`)
      })
  }

  async applyRequested(sessionId: string, wanted: Record<string, string>): Promise<void> {
    if (!Object.keys(wanted).length) return
    const session = await this.deps.store.requireSession(sessionId)
    const advertised = Array.isArray(session.config.configOptions)
      ? session.config.configOptions as AgentConfigOption[]
      : []
    const configOptions = optionsWithDefaults(advertised, wanted)
    const dropped = Object.entries(wanted).filter(([id, value]) =>
      !configOptions.some((option) => option.id === id && option.currentValue === value))
    if (dropped.length) {
      await this.deps.recordWarning(sessionId,
        `This provider does not offer ${dropped.map(([id, value]) => `${id} = ${value}`).join(', ')}, so the session kept its own setting.`)
    }
    if (configOptions === advertised) return
    // A workflow file's choice belongs to this run, not to the owner's next session.
    await this.deps.patchSession(sessionId, { config: { ...session.config, configOptions } }, { remember: false })
      .catch(async (error) => {
        await this.deps.recordWarning(sessionId,
          `The step's provider settings could not be applied: ${error instanceof Error ? error.message : 'unknown error'}`)
      })
  }

  async remember(providerId: string, changed: ReadonlyArray<{ id: string; value: string }>): Promise<void> {
    const userId = this.deps.currentUserId()
    if (!userId) return
    const stored = await readAgentSessionDefaults(this.deps.prefs, userId)
    if (!stored.followLastSession) return
    const chosen = Object.fromEntries(changed.map((option) => [option.id, option.value]))
    await writeAgentSessionDefaults(this.deps.prefs, userId, rememberAgentDefaults(stored, providerId, chosen))
  }
}
