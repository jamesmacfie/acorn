import type { AgentConfigOption, AgentProviderDescriptor } from '../../contract/wire.ts'
import type { AgentDriverRegistry } from '../drivers/registry'
import type { AgentStore } from './store'

// How long a providers answer is served without probing again. After this it is still served, and a
// probe runs behind it. Short, because signing in or installing a CLI should show within a visit.
const PROVIDER_FRESH_MS = 30_000

/**
 * What each registered harness says about itself: installed, signed in, what it can do.
 *
 * A probe starts CLI binaries, so it takes a few hundred milliseconds and sometimes seconds. The pane
 * asks on every task visit. So the last answer is served at once, and a probe runs in the background
 * once it is older than PROVIDER_FRESH_MS. Only the first call after boot, a call after a harness was
 * added or removed, and `force` wait for one. `force` is the Refresh button, and the re-check a refused
 * start makes before it refuses (usable()).
 */
export class ProviderCatalogue {
  // The last probe answer, when that probe started, and which drivers it asked.
  private cache: { probedAt: number; generation: number; descriptors: AgentProviderDescriptor[] } | null = null
  // The probe running now, which every caller that needs one joins.
  private probe: { generation: number; promise: Promise<AgentProviderDescriptor[]> } | null = null

  constructor(
    private readonly registry: AgentDriverRegistry,
    private readonly store: Pick<AgentStore, 'listSessions'>,
    // The runtime's shutdown. Once it aborts, every probe is refused and nothing is cached.
    private readonly shutdown: AbortSignal,
  ) {
    shutdown.addEventListener(
      'abort',
      () => {
        this.cache = null
        this.probe = null
      },
      { once: true },
    )
  }

  async list(force = false): Promise<AgentProviderDescriptor[]> {
    const cached = this.cache
    if (!force && cached && cached.generation === this.registry.generation) {
      if (Date.now() - cached.probedAt > PROVIDER_FRESH_MS) void this.probeProviders(false).catch(() => undefined)
      return this.withAdvertisedOptions(cached.descriptors)
    }
    return this.withAdvertisedOptions(await this.probeProviders(force))
  }

  /**
   * The provider `pick` finds, probed afresh when the served answer would refuse it. The served answer
   * can be minutes old, and a start must not be turned down for a CLI the owner has since installed or
   * signed in to.
   */
  async usable(pick: (provider: AgentProviderDescriptor) => boolean): Promise<AgentProviderDescriptor | undefined> {
    const served = (await this.list()).find(pick)
    this.shutdown.throwIfAborted()
    if (served?.installed && served.authenticated !== false) return served
    return (await this.list(true)).find(pick)
  }

  /** The last answer already observed. Diagnostics must never start a probe. */
  observed(id: string): AgentProviderDescriptor | null {
    return this.cache?.generation === this.registry.generation
      ? (this.cache.descriptors.find((provider) => provider.id === id) ?? null)
      : null
  }

  /** Harnesses that turn the person's read block into their own sandbox. */
  readBlockProviders(): string[] {
    return this.registry.providers().filter((id) => this.registry.create(id)?.readBlock === true)
  }

  /** Probes discover availability; connected sessions advertise the actual model and effort values.
   *  Read them on every request so a cached probe doesn't hide newly connected session options. */
  private async withAdvertisedOptions(descriptors: AgentProviderDescriptor[]): Promise<AgentProviderDescriptor[]> {
    const { sessions } = await this.store.listSessions({ limit: 50 })
    const advertised = new Map<string, AgentConfigOption[]>()
    for (const session of sessions) {
      const options = session.config.configOptions
      if (!advertised.has(session.providerId) && Array.isArray(options) && options.length) {
        advertised.set(session.providerId, options as AgentConfigOption[])
      }
    }
    if (!advertised.size) return descriptors
    return descriptors.map((provider) => ({
      ...provider,
      configOptions: advertised.get(provider.id) ?? provider.configOptions,
    }))
  }

  // A forced read starts its own probe, because one already running may have started before the
  // install or sign-in the caller is asking about. Any other caller joins the one running.
  private probeProviders(force: boolean): Promise<AgentProviderDescriptor[]> {
    if (this.shutdown.aborted) return Promise.reject(this.shutdown.reason)
    const generation = this.registry.generation
    if (this.probe?.generation === generation && !force) return this.probe.promise
    const probedAt = Date.now()
    const driverIds = this.registry.providers()
    const wave = { generation, promise: null as unknown as Promise<AgentProviderDescriptor[]> }
    const probe = Promise.all(
      driverIds.map(async (providerId) => {
        const driver = this.registry.create(providerId)
        if (!driver) throw new Error(`Agent driver disappeared during discovery: ${providerId}`)
        try {
          return await driver.probe()
        } catch (error) {
          return {
            id: providerId,
            profileId: driver.profileId,
            label: providerId,
            driverKind: 'terminal' as const,
            driverVersion: 'unavailable',
            installed: false,
            authenticated: null,
            statusAuthority: 'process' as const,
            capabilities: [],
            configOptions: [],
            commands: [],
            skills: [],
            diagnostics: [error instanceof Error ? error.message : 'Provider discovery failed.'],
          }
        }
      }),
    )
      .then((descriptors) => {
        // An older probe that finishes last must not replace a newer answer.
        if (!this.shutdown.aborted && this.probe === wave && this.registry.generation === generation) {
          this.cache = { probedAt, generation, descriptors }
        }
        return descriptors
      })
      .finally(() => {
        if (this.probe === wave) this.probe = null
      })
    wave.promise = probe
    this.probe = wave
    return probe
  }
}
