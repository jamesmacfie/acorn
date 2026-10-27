import type { AgentAccountDescriptor, AgentConfigOption, AgentProviderDescriptor } from '../../contract/wire.ts'
import type { AccountDetails, AgentAccounts } from '../accounts'
import { signedIn } from '../../shared/accounts'
import type { AgentDriverRegistry } from '../drivers/registry'
import type { AgentDriver } from '../drivers/types'
import type { AgentStore } from './store'

// How long a providers answer is served without probing again. After this it is still served, and a
// probe runs behind it. Short, because signing in or installing a CLI should show within a visit.
const PROVIDER_FRESH_MS = 30_000
// How often, and for how long, the Node checks an account after opening a terminal on it (watchSignIn).
const SIGN_IN_POLL_MS = 5_000
const SIGN_IN_WATCH_MS = 5 * 60_000

/**
 * What each registered harness says about itself: installed, signed in, what it can do.
 *
 * A probe starts CLI binaries, so it takes a few hundred milliseconds and sometimes seconds. The pane
 * asks on every task visit. So the last answer is served at once, and a probe runs in the background
 * once it is older than PROVIDER_FRESH_MS. Only the first call after boot, a call after a harness was
 * added or removed, and `force` wait for one. `force` is the Refresh button, and the re-check a refused
 * start makes before it refuses (usable()). A probe whose answer differs from the last one calls
 * `onChanged`, so a client showing the old answer reads again instead of waiting for its next visit.
 */
export class ProviderCatalogue {
  // The last probe answer, when that probe started, and which drivers it asked.
  private cache: { probedAt: number; generation: number; descriptors: AgentProviderDescriptor[] } | null = null
  // The probe running now, which every caller that needs one joins.
  private probe: { generation: number; promise: Promise<AgentProviderDescriptor[]> } | null = null
  // The accounts watchSignIn is checking, by `provider\0name`, so a second terminal starts no second watch.
  private readonly watching = new Set<string>()

  constructor(
    private readonly registry: AgentDriverRegistry,
    private readonly store: Pick<AgentStore, 'listSessions'>,
    private readonly accounts: Pick<AgentAccounts, 'list' | 'home' | 'defaultAccount' | 'details' | 'showAs'>,
    // The runtime's shutdown. Once it aborts, every probe is refused and nothing is cached.
    private readonly shutdown: AbortSignal,
    private readonly onChanged: () => void = () => {},
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
   * signed in to. `account` names the login the start will use; null is the harness's default.
   */
  async usable(
    pick: (provider: AgentProviderDescriptor) => boolean,
    account: string | null = null,
  ): Promise<AgentProviderDescriptor | undefined> {
    const served = (await this.list()).find(pick)
    this.shutdown.throwIfAborted()
    if (served?.installed && signedIn(served, account) !== false) return served
    return (await this.list(true)).find(pick)
  }

  /**
   * Checks one account every SIGN_IN_POLL_MS for up to SIGN_IN_WATCH_MS, and probes every harness again
   * once it reads signed in, which announces the change. For the terminal the Node opens on an
   * account: the sign-in happens inside the CLI, and nothing else tells the Node it finished.
   */
  watchSignIn(providerId: string, name: string): void {
    const driver = this.registry.create(providerId)
    const key = `${providerId}\u0000${name}`
    if (!driver?.probeAccount || this.watching.has(key)) return
    this.watching.add(key)
    const home = this.accounts.home(providerId, name)
    void (async () => {
      for (let waited = 0; waited < SIGN_IN_WATCH_MS; waited += SIGN_IN_POLL_MS) {
        await pause(SIGN_IN_POLL_MS, this.shutdown)
        if (this.shutdown.aborted) return
        if (await driver.probeAccount!(home)) {
          await this.list(true)
          return
        }
      }
    })()
      .catch(() => undefined)
      .finally(() => this.watching.delete(key))
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

  private async probeAccounts(
    driver: AgentDriver,
    descriptor: AgentProviderDescriptor,
    details: Record<string, AccountDetails>,
  ): Promise<AgentAccountDescriptor[]> {
    const accounts = driver.accounts!
    const names = await this.accounts.list(driver.providerId)
    return Promise.all(
      names.map(async (name) => {
        const home = this.accounts.home(driver.providerId, name)
        return {
          name,
          ...details[name],
          authenticated: (await driver.probeAccount?.(home)) ?? null,
          loginCommand: descriptor.executable
            ? [`${accounts.env}=${shellQuote(home)}`, shellQuote(descriptor.executable), ...accounts.login].join(' ')
            : null,
        }
      }),
    )
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
          const descriptor = await driver.probe()
          if (!driver.accounts) return descriptor
          const defaultAccount = await this.accounts.defaultAccount(driver.providerId)
          return {
            ...descriptor,
            accounts: await this.probeAccounts(driver, descriptor, await this.accounts.details(driver.providerId)),
            ...(defaultAccount ? { defaultAccount } : {}),
            accountDisplay: await this.accounts.showAs(),
          }
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
          const previous = this.cache?.descriptors
          this.cache = { probedAt, generation, descriptors }
          if (previous && JSON.stringify(previous) !== JSON.stringify(descriptors)) this.onChanged()
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

/** Resolves after `ms`, or at once when `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done)
  })
}

export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`
