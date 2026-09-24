import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const NODE_FILES = new Set(['core.sqlite', 'core.sqlite-wal', 'core.sqlite-shm', 'acorn.sqlite', 'acorn.sqlite-wal', 'acorn.sqlite-shm', 'node.json', 'node.lock', 'internal-token', 'active-identity', 'session.key', 'disabled-plugins.json'])
const NODE_DIRS = new Set(['plugins', 'blobs', 'tls', 'logs', 'notes', 'memory-proposals', 'agent-objects', 'agent-artifacts', 'agent-usage-probe'])
const DEVICE_FILES = new Set(['fleet.json', 'plugin-trust.json', 'data.key', 'shell-crash.json'])
const DEVICE_DIRS = new Set(['plugin-cache'])

export const inside = (parent, child) => child === parent || child.startsWith(`${parent}${sep}`)

function noSymlinkPath(path) {
  let cursor = path
  while (true) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink in reset path: ${cursor}`)
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
}

export function explicitRoot(value, label, cwd = process.cwd()) {
  if (!value || !isAbsolute(value)) throw new Error(`${label} must be an explicit absolute path`)
  const path = resolve(value)
  const home = realpathSync(homedir())
  const workspace = realpathSync(cwd)
  const containsWorkspace = inside(path, workspace)
  if (path === dirname(path) || path === home || path === workspace || inside(path, home) || inside(workspace, path) || (containsWorkspace && (label !== 'nodeRoot' || relative(path, workspace).split(sep)[0] !== 'worktrees'))) {
    throw new Error(`Protected ${label}: ${path}`)
  }
  noSymlinkPath(path)
  if (!existsSync(path) || !lstatSync(path).isDirectory()) throw new Error(`${label} is not an existing directory: ${path}`)
  if (existsSync(join(path, '.git')) || existsSync(join(path, 'pnpm-workspace.yaml'))) throw new Error(`Source repository is not a reset root: ${path}`)
  return realpathSync(path)
}

function addFile(path, files, owner) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Non-regular or linked reset target: ${path}`)
  const existing = files.get(path)
  if (existing) { existing.owners.push(owner); return }
  files.set(path, { path, owners: [owner], bytes: stat.size, mtimeMs: stat.mtimeMs })
}

function visit(path, files, directories, owner) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) throw new Error(`Symlink in owned state: ${path}`)
  if (stat.isFile()) return addFile(path, files, owner)
  if (!stat.isDirectory()) throw new Error(`Unexpected owned state type: ${path}`)
  const existing = directories.get(path)
  if (existing) existing.owners.push(owner)
  else directories.set(path, { path, owners: [owner] })
  for (const name of readdirSync(path).sort()) visit(join(path, name), files, directories, owner)
}

function select(root, files, directories, owner, fileNames, dirNames, extraFile = () => false) {
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name)
    const stat = lstatSync(path)
    const selected = fileNames.has(name) || dirNames.has(name) || extraFile(name)
    if (stat.isSymbolicLink()) {
      if (selected) throw new Error(`Symlink in owned state: ${path}`)
      continue
    }
    if (stat.isDirectory() && dirNames.has(name)) visit(path, files, directories, owner)
    else if (stat.isFile() && (fileNames.has(name) || extraFile(name))) visit(path, files, directories, owner)
  }
}

function checkNodeLock(root) {
  const lock = join(root, 'node.lock')
  if (!existsSync(lock)) return
  const pid = Number(readFileSync(lock, 'utf8').trim())
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error(`Unclear node lock: ${lock}`)
  try { process.kill(pid, 0); throw new Error(`Live node holds ${lock} (pid ${pid})`) }
  catch (error) { if (error.code !== 'ESRCH') throw error }
}

export function inventoryRoots(input, cwd = process.cwd()) {
  const roots = {}
  for (const name of ['nodeRoot', 'desktopRoot', 'tuiRoot', 'memoryRoot']) if (input[name]) roots[name] = explicitRoot(input[name], name, cwd)
  if (!Object.keys(roots).length) throw new Error('Name at least one root with --node-root, --desktop-root, --tui-root, or --memory-root')
  for (const [name, root] of Object.entries(roots)) for (const [other, path] of Object.entries(roots)) {
    if (name === other) continue
    if (root === path) {
      if ((name === 'desktopRoot' && other === 'tuiRoot') || (name === 'tuiRoot' && other === 'desktopRoot')) continue
      throw new Error(`Overlapping reset roots: ${root}, ${path}`)
    }
    if (inside(root, path) && !(name === 'nodeRoot' && (other === 'desktopRoot' || other === 'tuiRoot') && relative(root, path) === 'shell')) throw new Error(`Overlapping reset roots: ${root}, ${path}`)
  }
  const files = new Map()
  const directories = new Map()
  if (roots.nodeRoot) {
    checkNodeLock(roots.nodeRoot)
    select(roots.nodeRoot, files, directories, 'node', NODE_FILES, NODE_DIRS)
  }
  const deviceFile = name => /^device-token-[A-Za-z0-9._-]{1,128}$/.test(name)
  if (roots.desktopRoot) select(roots.desktopRoot, files, directories, 'desktop', DEVICE_FILES, DEVICE_DIRS, deviceFile)
  if (roots.tuiRoot) select(roots.tuiRoot, files, directories, 'tui', DEVICE_FILES, new Set(['cache', 'plugins', 'plugin-cache']), deviceFile)
  if (roots.memoryRoot) select(roots.memoryRoot, files, directories, 'private-memory', new Set(['MEMORY.md']), new Set(['projects']), name => name.endsWith('.md'))
  const outstanding = []
  if (roots.desktopRoot) {
    outstanding.push('desktop app://acorn localStorage and IndexedDB: host-owned origin adapter required')
    if (!existsSync(join(roots.desktopRoot, 'data.key'))) outstanding.push('desktop keychain acorn/data-key: native export and removal required before encrypted custody is recoverable')
  }
  return { roots, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), directories: [...directories.values()].sort((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path)), outstanding }
}
