import { homedir } from 'node:os'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { ToolError, type CoreServices } from '@acorn/plugin-api/node'
import { isValidMemoryName, parseMemory } from './memory'
import { memoryHash, type MemoryStoreAccess } from './memoryStore'
import { validateMemoryWrite, type MemoryWrite } from './memorySafety'
import type { MemoryImportFile, MemoryImportResult, MemoryImportSource } from '../shared/api'

type ImportCore = Pick<CoreServices, 'projects' | 'git'>

// Sources are discovered on the Node. A request selects an id, never an arbitrary filesystem path.
export async function memoryImportSources(core: ImportCore, projectId: string): Promise<MemoryImportSource[]> {
  const project = await core.projects.byId(projectId)
  if (!project) throw new ToolError('not_found', 'No such project.')
  if (!project.path) return []
  const checkout = await realpath(project.path)
  let root = checkout
  try {
    const common = (await core.git.gitText(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: checkout })).trim()
    if (common) root = dirname(resolve(checkout, common))
  } catch { /* A non-git checkout can still have repository memory. */ }
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const slug = process.env.CLAUDE_CODE_PROJECT_DIR_NAME || root.replace(/[^a-zA-Z0-9]/g, '-')
  const candidates = [
    { id: 'claude', label: 'Claude Code', path: join(config, 'projects', slug, 'memory') },
    { id: 'checkout', label: 'Repository memory', path: join(root, '.acorn', 'memory') },
  ]
  const sources: MemoryImportSource[] = []
  for (const source of candidates) {
    const info = await lstat(source.path).catch(() => null)
    if (info?.isDirectory() && !info.isSymbolicLink()) sources.push(source)
  }
  return sources
}

export async function memoryImportPreview(core: ImportCore, store: MemoryStoreAccess, projectId: string, sourceId: string): Promise<MemoryImportFile[]> {
  const source = (await memoryImportSources(core, projectId)).find((source) => source.id === sourceId)
  if (!source) throw new ToolError('not_found', 'No such import source.')
  const files: MemoryImportFile[] = []
  for (const file of (await readdir(source.path)).sort()) {
    if (!file.endsWith('.md') || file.toUpperCase() === 'MEMORY.MD') continue
    const name = file.slice(0, -3)
    if (!isValidMemoryName(name)) continue
    const path = join(source.path, file)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) continue
    if (info.size > 64 * 1024) {
      files.push({ file, name, description: '', type: 'reference', body: '', sourceHash: '', destinationHash: null, collision: false, error: 'File exceeds 64 KiB.' })
      continue
    }
    const text = await readFile(path, 'utf8')
    const parsed = parseMemory(text, name)
    // Filenames are the address, as in the ordinary library scan. Preserve them even when Claude's
    // frontmatter uses a human title rather than a file-safe name.
    const input = { name, description: parsed.description, type: parsed.type as MemoryWrite['type'], body: parsed.body }
    const current = await store.get({ scope: 'project', projectId, name })
    let error: string | undefined
    try { validateMemoryWrite(input) } catch (e) { error = e instanceof Error ? e.message : 'Invalid memory.' }
    files.push({ file, ...input, sourceHash: memoryHash(text), destinationHash: current?.hash ?? null, collision: !!current, ...(error ? { error } : {}) })
  }
  return files
}

export async function importMemory(core: ImportCore, store: MemoryStoreAccess, projectId: string, sourceId: string,
  selected: { name: string; sourceHash: string; destinationHash: string | null; overwrite: boolean }[]): Promise<MemoryImportResult> {
  const preview = await memoryImportPreview(core, store, projectId, sourceId)
  const result: MemoryImportResult = { imported: [], skipped: [], errors: [] }
  for (const choice of selected) {
    const file = preview.find((file) => file.name === choice.name)
    if (!file || file.sourceHash !== choice.sourceHash || file.destinationHash !== choice.destinationHash) {
      result.errors.push({ name: choice.name, error: 'Source or destination changed. Preview again.' })
      continue
    }
    if (file.collision && !choice.overwrite) { result.skipped.push(file.name); continue }
    try {
      if (file.error) throw new Error(file.error)
      await store.write({ scope: 'project', projectId, name: file.name }, {
        name: file.name, description: file.description, type: file.type as MemoryWrite['type'], body: file.body,
        ...(file.destinationHash ? { hash: file.destinationHash } : {}),
      }, { by: 'import' })
      result.imported.push(file.name)
    } catch (e) { result.errors.push({ name: file.name, error: e instanceof Error ? e.message : 'Import failed.' }) }
  }
  return result
}
