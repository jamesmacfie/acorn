import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import type { Env } from '../bindings'
import { dispatchPluginRoute } from '../pluginHost/dispatch'
import type { DataSourceInvocation } from './authority'
import { DataSourceError, type DataSourceErrorDetail } from './validation'
import type { PluginConnectionScope } from '../pluginHost/requestContext'

const REASON_BYTES = 4096
const REASON_CHARS = 300

/** The sentence a source's failed reply gives in `reason`, for a panel to show. The rest of the body
 *  stays out, because a plugin may have put a provider's own response there, and the read stops at
 *  4 KiB so a large error body costs nothing. */
async function failureReason(response: Response): Promise<DataSourceErrorDetail | undefined> {
  const reader = response.body?.getReader()
  if (!reader) return undefined
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size <= REASON_BYTES) {
      const chunk = await reader.read()
      if (chunk.done) break
      chunks.push(chunk.value)
      size += chunk.value.byteLength
    }
  } catch { return undefined } finally { void reader.cancel().catch(() => {}) }
  if (size > REASON_BYTES) return undefined
  try {
    const body = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) as { reason?: unknown }
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, REASON_CHARS) : ''
    return reason ? { reason } : undefined
  } catch { return undefined }
}

/** Race the full body read as well as the callback: an uncooperative plugin cannot hold admission. */
export async function dispatchSource(
  env: Env,
  pluginId: string,
  handler: string,
  body: unknown,
  invocation: DataSourceInvocation,
  maxBytes: number = DATA_LIMITS.selectionBytes,
  connectionScope: PluginConnectionScope = {},
): Promise<unknown> {
  const { signal } = invocation
  if (signal.aborted) throw new DataSourceError(signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled')
  let abort: () => void = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new DataSourceError(signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled'))
    signal.addEventListener('abort', abort, { once: true })
  })
  const read = async () => {
    const response = await dispatchPluginRoute(
      env, pluginId, handler, { method: 'POST', body: JSON.stringify(body) }, signal,
      invocation.principal, connectionScope,
    )
    if (!response.ok) throw new DataSourceError(response.status === 429 ? 'rate-limited' : 'provider-failure', await failureReason(response))
    const reader = response.body?.getReader()
    if (!reader) throw new DataSourceError('invalid-response')
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      while (true) {
        signal.throwIfAborted()
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > maxBytes) throw new DataSourceError('oversize')
        chunks.push(chunk.value)
      }
    } finally { void reader.cancel().catch(() => {}) }
    const merged = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder().decode(merged)) as unknown } catch { throw new DataSourceError('invalid-response') }
  }
  try { return await Promise.race([read(), cancelled]) }
  catch (error) { if (error instanceof DataSourceError) throw error; throw new DataSourceError('provider-failure') }
  finally { signal.removeEventListener('abort', abort) }
}
