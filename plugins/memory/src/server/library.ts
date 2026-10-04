import { BridgeError, ToolError } from '@acorn/plugin-api/node'
import type { KnowledgeCoreServices } from './knowledgeChannel'
import type { MemoryStoreAccess } from './memoryStore'
import type { MemoryAddress, MemoryCaps } from '../shared/api'
import type { MemoryWrite } from './memorySafety'

export type LibraryRequest = {
  address?: MemoryAddress
  input?: MemoryWrite
  scope?: 'private' | 'project'
  hash?: string
  version?: string
  caps?: MemoryCaps
  sourceId?: string
  files?: { name: string; sourceHash: string; destinationHash: string | null; overwrite: boolean }[]
}

// All owner library operations share one device-only router and one error boundary.
export function memoryLibrary(store: MemoryStoreAccess, core: KnowledgeCoreServices) {
  return async (action: string, projectId: string | undefined, request: LibraryRequest) => {
    try {
      if (projectId && !await core.projects.byId(projectId)) throw new ToolError('not_found', 'No such project.')
      const address = request.address
      if (address && address.scope === 'project' && address.projectId !== projectId) throw new ToolError('bad_request', 'Memory address must match the selected project.')
      if (address) address.projectId = address.scope === 'private' ? null : projectId ?? null
      switch (action) {
        case 'get': return address ? await store.get(address) : null
        case 'history': return address ? await store.history(address) : []
        case 'edit': {
          if (!address || !request.input || !request.scope) throw new ToolError('bad_request', 'Missing edit fields.')
          // A private memory still needs the selected project when moving into project scope.
          return await store.edit(address, request.input, request.scope, projectId ?? null)
        }
        case 'delete': {
          if (!address || !request.hash) throw new ToolError('bad_request', 'Missing memory hash.')
          return await store.delete(address, request.hash, { by: 'owner' })
        }
        case 'restore': {
          if (!address || !request.version) throw new ToolError('bad_request', 'Missing history version.')
          return await store.restore(address, request.version, request.hash)
        }
        case 'changes': return await store.feed(projectId ?? null, request.scope)
        case 'preview': {
          const { memoryPreview } = await import('./standingContext')
          return await memoryPreview(store, core, projectId ?? null, request.scope)
        }
        case 'caps': {
          const user = core.identity.active()
          if (!user || !request.caps) throw new ToolError('bad_request', 'Missing memory preferences.')
          const { MEMORY_CAPS_KEY } = await import('./standingContext')
          await core.prefs.write(user, MEMORY_CAPS_KEY, JSON.stringify(request.caps))
          return { ok: true }
        }
        case 'sources': {
          if (!projectId) return []
          const { memoryImportSources } = await import('./memoryImport')
          return await memoryImportSources(core, projectId)
        }
        case 'import-preview': {
          if (!projectId || !request.sourceId) throw new ToolError('bad_request', 'Select an import source.')
          const { memoryImportPreview } = await import('./memoryImport')
          return await memoryImportPreview(core, store, projectId, request.sourceId)
        }
        case 'import': {
          if (!projectId || !request.sourceId || !request.files) throw new ToolError('bad_request', 'Preview an import source first.')
          const { importMemory } = await import('./memoryImport')
          return await importMemory(core, store, projectId, request.sourceId, request.files)
        }
        default: throw new ToolError('not_found', 'No such memory operation.')
      }
    } catch (error) {
      if (error instanceof ToolError) throw new BridgeError(error.kind === 'conflict' ? 409 : error.kind === 'not_found' ? 404 : 400, error.kind, error.message)
      throw error
    }
  }
}
