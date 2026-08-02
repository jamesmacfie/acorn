import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

type JsonObject = Record<string, unknown>
type JsonRpcId = string | number
type PendingRequest = {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export type JsonRpcNotification = {
  method: string
  params: JsonObject
}

export type JsonRpcServerRequest = JsonRpcNotification & {
  id: JsonRpcId
}

type JsonRpcProcessOptions = {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  requestTimeoutMs?: number
  maxBufferedBytes?: number
  onNotification?(message: JsonRpcNotification): void
  onRequest?(message: JsonRpcServerRequest): void
  onStderr?(line: string): void
  onClosed?(error?: Error): void
}

const asObject = (value: unknown): JsonObject | null =>
  typeof value === 'object' && value != null && !Array.isArray(value) ? value as JsonObject : null

export class JsonRpcProcess {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #pending = new Map<JsonRpcId, PendingRequest>()
  readonly #requestTimeoutMs: number
  readonly #maxBufferedBytes: number
  readonly #onNotification?: (message: JsonRpcNotification) => void
  readonly #onRequest?: (message: JsonRpcServerRequest) => void
  readonly #onClosed?: (error?: Error) => void
  #nextId = 1
  #buffer = ''
  readonly #decoder = new StringDecoder('utf8')
  #closed = false

  constructor(options: JsonRpcProcessOptions) {
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.#maxBufferedBytes = options.maxBufferedBytes ?? 32 * 1024 * 1024
    this.#onNotification = options.onNotification
    this.#onRequest = options.onRequest
    this.#onClosed = options.onClosed
    this.#child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.#child.stdout.on('data', (chunk: Buffer) => this.#consume(chunk))
    this.#child.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (line.trim()) options.onStderr?.(line.trim())
      }
    })
    this.#child.on('error', (error) => this.#close(error))
    this.#child.on('exit', (code, signal) => {
      const error = this.#closed
        ? undefined
        : new Error(`Agent protocol process exited${code == null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}.`)
      this.#close(error)
    })
  }

  get closed(): boolean {
    return this.#closed
  }

  async request<T = unknown>(method: string, params: JsonObject = {}, timeoutMs = this.#requestTimeoutMs): Promise<T> {
    if (this.#closed) throw new Error('Agent protocol process is closed.')
    const id = this.#nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`Agent protocol request timed out: ${method}`))
      }, timeoutMs)
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })
      this.#write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: JsonObject = {}): void {
    if (!this.#closed) this.#write({ jsonrpc: '2.0', method, params })
  }

  respond(id: JsonRpcId, result: unknown): void {
    if (!this.#closed) this.#write({ jsonrpc: '2.0', id, result })
  }

  respondError(id: JsonRpcId, code: number, message: string): void {
    if (!this.#closed) this.#write({ jsonrpc: '2.0', id, error: { code, message } })
  }

  async stop(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#child.stdin.end()
    if (!this.#child.killed) this.#child.kill()
    this.#rejectPending(new Error('Agent protocol process stopped.'))
  }

  #write(message: JsonObject): void {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  #consume(chunk: Buffer): void {
    this.#buffer += this.#decoder.write(chunk)
    for (;;) {
      const newline = this.#buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.#buffer.slice(0, newline).trim()
      this.#buffer = this.#buffer.slice(newline + 1)
      if (!line) continue
      if (Buffer.byteLength(line, 'utf8') > this.#maxBufferedBytes) {
        this.#rejectOversizedOutput()
        return
      }
      this.#handleLine(line)
    }
    if (Buffer.byteLength(this.#buffer, 'utf8') > this.#maxBufferedBytes) {
      this.#rejectOversizedOutput()
    }
  }

  #handleLine(line: string): void {
    let message: JsonObject | null
    try {
      message = asObject(JSON.parse(line))
    } catch {
      return
    }
    if (!message) return
    const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null
    const method = typeof message.method === 'string' ? message.method : null
    if (id != null && method) {
      this.#onRequest?.({ id, method, params: asObject(message.params) ?? {} })
      return
    }
    if (id != null) {
      const pending = this.#pending.get(id)
      if (!pending) return
      this.#pending.delete(id)
      clearTimeout(pending.timer)
      const error = asObject(message.error)
      if (error) pending.reject(new Error(typeof error.message === 'string' ? error.message : 'Agent protocol request failed.'))
      else pending.resolve(message.result)
      return
    }
    if (method) this.#onNotification?.({ method, params: asObject(message.params) ?? {} })
  }

  #close(error?: Error): void {
    if (this.#closed) return
    this.#closed = true
    this.#rejectPending(error ?? new Error('Agent protocol process closed.'))
    this.#onClosed?.(error)
  }

  #rejectOversizedOutput(): void {
    const error = new Error(`Agent protocol message exceeded ${this.#maxBufferedBytes} bytes.`)
    void this.stop()
    this.#onClosed?.(error)
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}
