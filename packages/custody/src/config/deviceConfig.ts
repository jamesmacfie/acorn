import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { deviceConfigSchema, parseDeviceConfig, type DeviceConfig } from '@acorn/protocol/deviceConfig.ts'

export type DeviceConfigState = { config: DeviceConfig; error?: { message: string; line: number; column: number } }

/** File custody only. Hosts project this value into their existing device preference setters. */
export class DeviceConfigStore {
  readonly path: string
  #last: DeviceConfig = {}
  #raw = ''

  constructor(private readonly directory: string) {
    this.path = join(directory, 'acorn.json')
  }

  read(): DeviceConfigState {
    if (!existsSync(this.path)) return { config: this.#last }
    let raw: string
    try { raw = readFileSync(this.path, 'utf8') }
    catch (error) { return { config: this.#last, error: { message: String(error), line: 1, column: 1 } } }
    if (raw === this.#raw) return { config: this.#last }
    const parsed = parseDeviceConfig(raw)
    if (!parsed.ok) return { config: this.#last, error: { message: parsed.message, line: parsed.line, column: parsed.column } }
    this.#raw = raw
    this.#last = parsed.value
    return { config: this.#last }
  }

  /** Atomic write, preserving every unknown top-level key from the last valid read. */
  write(next: Partial<DeviceConfig>): DeviceConfigState {
    const current = this.read()
    // The malformed bytes may contain edits that have not made it into #last. Do not replace the
    // owner's file with the last valid projection while they are fixing a parse error.
    if (current.error) throw new Error(`Cannot write acorn.json until its parse error is fixed: ${current.error.message}`)
    const parsed = deviceConfigSchema.safeParse({ ...current.config, ...next })
    if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
    const raw = `${JSON.stringify(parsed.data, null, 2)}\n`
    mkdirSync(this.directory, { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    writeFileSync(temporary, raw, { mode: 0o600 })
    renameSync(temporary, this.path)
    this.#last = parsed.data
    this.#raw = raw
    return { config: this.#last }
  }

  watch(listener: (state: DeviceConfigState) => void): () => void {
    mkdirSync(this.directory, { recursive: true })
    let pending: ReturnType<typeof setTimeout> | undefined
    const watcher: FSWatcher = watch(this.directory, (_, name) => {
      if (name?.toString() !== 'acorn.json') return
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => { pending = undefined; listener(this.read()) }, 25)
    })
    return () => { if (pending) clearTimeout(pending); watcher.close() }
  }
}
