import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { PortSchema } from '../../shared/publicApi/primitives'

// Machine-scoped bootstrap settings for the public listener (docs/next/api/core-api.md §3). Stored
// as an atomic JSON file under the data root because the port must be known before any GitHub user
// is logged in and before the listener starts. Never a GitHub-user pref.

const RESERVED_PORT = 4317 // the SPA/internal app listener; the public port must differ
export const DEFAULT_API_PORT = 4318

const StoredSchema = z.strictObject({
  version: z.literal(1),
  enabled: z.boolean(),
  port: PortSchema.refine((p) => p !== RESERVED_PORT, `port ${RESERVED_PORT} is reserved for the app listener`),
})

export type ApiServerSettings = { enabled: boolean; port: number }

export type EffectiveSettings = {
  settings: ApiServerSettings
  // The port actually bound. Equals settings.port unless ACORN_API_PORT overrides it.
  effectivePort: number
  // ACORN_API_PORT is set → port is read-only until restart without the override.
  portOverridden: boolean
  bindAddress: string // always 127.0.0.1:<effectivePort>
  // Present when the stored file was unreadable/corrupt; the store failed closed to disabled.
  error?: string
}

function envPort(env: NodeJS.ProcessEnv): number | null {
  const raw = env.ACORN_API_PORT
  if (!raw) return null
  const parsed = Number(raw)
  const result = StoredSchema.shape.port.safeParse(parsed)
  return result.success ? result.data : null
}

export class ApiSettingsStore {
  private readonly file: string

  constructor(
    private readonly dataDir: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.file = join(dataDir, 'api-settings.json')
  }

  // Read strictly. A missing file is the default (disabled, DEFAULT_API_PORT). A corrupt file or
  // unknown version fails CLOSED to disabled and surfaces the error rather than trusting it.
  read(): EffectiveSettings {
    let settings: ApiServerSettings = { enabled: false, port: DEFAULT_API_PORT }
    let error: string | undefined
    let raw: string | null = null
    try {
      raw = readFileSync(this.file, 'utf8')
    } catch {
      raw = null // ENOENT → defaults
    }
    if (raw !== null) {
      try {
        const parsed = StoredSchema.parse(JSON.parse(raw))
        settings = { enabled: parsed.enabled, port: parsed.port }
      } catch (e) {
        error = `api-settings.json is invalid; the API is disabled until it is fixed (${e instanceof Error ? e.message : String(e)})`
        settings = { enabled: false, port: DEFAULT_API_PORT }
      }
    }
    return this.effective(settings, error)
  }

  private effective(settings: ApiServerSettings, error?: string): EffectiveSettings {
    const override = envPort(this.env)
    const effectivePort = override ?? settings.port
    return {
      settings,
      effectivePort,
      portOverridden: override !== null,
      bindAddress: `127.0.0.1:${effectivePort}`,
      error,
    }
  }

  // Apply a partial change and persist atomically. Rejects a port change while ACORN_API_PORT
  // overrides it (setting_overridden is surfaced by the caller). Returns the new effective view.
  write(patch: Partial<ApiServerSettings>): EffectiveSettings {
    const current = this.read().settings
    const next: ApiServerSettings = { ...current, ...patch }
    const validated = StoredSchema.parse({ version: 1, enabled: next.enabled, port: next.port })
    this.persist({ version: 1, enabled: validated.enabled, port: validated.port })
    return this.effective({ enabled: validated.enabled, port: validated.port })
  }

  // True if ACORN_API_PORT is pinning the port (a port PATCH must be refused with setting_overridden).
  get portOverridden(): boolean {
    return envPort(this.env) !== null
  }

  // temp file + fsync + rename, mode 0600 — no partial file is ever observable and the settings
  // (which gate a loopback control surface) are not world-readable.
  private persist(data: { version: 1; enabled: boolean; port: number }): void {
    const tmp = `${this.file}.${process.pid}.tmp`
    const body = `${JSON.stringify(data, null, 2)}\n`
    const fd = openSync(tmp, 'w', 0o600)
    try {
      writeSync(fd, body)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    // rename replaces the target inode with the temp file, so the final file inherits the temp's
    // 0600 mode — no separate chmod needed.
    renameSync(tmp, this.file)
  }
}
