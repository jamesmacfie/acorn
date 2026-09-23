import { tmpdir } from 'node:os'
import type { ModelCatalogEntry } from '@acorn/protocol/integrations.ts'
import { AGENT_TOOL_PASSTHROUGH, brokerEnv } from '@acorn/plugin-api/node'
import { JsonRpcProcess } from '../drivers/jsonRpcProcess'

const CACHE_MS = 60_000
const PROBE_TIMEOUT_MS = 10_000
const MAX_PAGES = 5

type ModelPage = { models: ModelCatalogEntry[]; nextCursor: string | null }
type ModelRpc = Pick<JsonRpcProcess, 'request' | 'notify' | 'stop'>

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

export function codexModelPage(value: unknown): ModelPage {
  const response = asObject(value)
  if (!response || !Array.isArray(response.data)) throw new Error('Codex returned no model catalog.')
  const models = response.data.flatMap((value): ModelCatalogEntry[] => {
    const row = asObject(value)
    const id = typeof row?.id === 'string' && row.id ? row.id : typeof row?.model === 'string' ? row.model : ''
    if (!id || row?.hidden === true) return []
    return [{ id, label: typeof row?.displayName === 'string' && row.displayName ? row.displayName : id }]
  })
  return { models, nextCursor: typeof response.nextCursor === 'string' && response.nextCursor ? response.nextCursor : null }
}

export async function fetchCodexModels(command: string, open: (command: string) => ModelRpc = (command) => new JsonRpcProcess({
  command,
  args: ['app-server', '--stdio'],
  cwd: tmpdir(),
  env: brokerEnv({ passthrough: [...AGENT_TOOL_PASSTHROUGH, 'CODEX_*'] }),
  requestTimeoutMs: PROBE_TIMEOUT_MS,
  maxBufferedBytes: 2 * 1024 * 1024,
})): Promise<ModelCatalogEntry[]> {
  const rpc = open(command)
  const timeout = setTimeout(() => void rpc.stop(), PROBE_TIMEOUT_MS)
  try {
    await rpc.request('initialize', {
      clientInfo: { name: 'acorn', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false, mcpServerOpenaiFormElicitation: true },
    })
    rpc.notify('initialized')
    const models = new Map<string, ModelCatalogEntry>()
    let cursor: string | null = null
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const page = codexModelPage(await rpc.request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }))
      for (const model of page.models) models.set(model.id, model)
      if (!page.nextCursor) return [...models.values()]
      cursor = page.nextCursor
    }
    throw new Error('Codex model catalog exceeded the page limit.')
  } finally {
    clearTimeout(timeout)
    await rpc.stop()
  }
}

let cached: { models: ModelCatalogEntry[]; at: number } | null = null
let pending: Promise<{ models: ModelCatalogEntry[]; unavailable?: boolean }> | null = null

export function codexModels(command: string): Promise<{ models: ModelCatalogEntry[]; unavailable?: boolean }> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return Promise.resolve({ models: cached.models })
  if (pending) return pending
  pending = fetchCodexModels(command).then((models) => {
    cached = { models, at: Date.now() }
    return { models }
  }).catch(() => {
    return { models: cached?.models ?? [], unavailable: true }
  }).finally(() => { pending = null })
  return pending
}
