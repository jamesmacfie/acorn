import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const repoRoot = resolve(import.meta.dirname, '../../../..')
export const desktopRoot = resolve(import.meta.dirname, '../..')
export const sessionsRoot = join(repoRoot, '.acorn', 'agent-dev')

export function validateSessionName(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error('Session names must be 1-64 letters, digits, dots, underscores, or hyphens, and must start with a letter or digit.')
  }
  return name
}

export const sessionDirectory = (name) => join(sessionsRoot, validateSessionName(name))
export const manifestPath = (name) => join(sessionDirectory(name), 'session.json')
export const refsPath = (name) => join(sessionDirectory(name), 'refs.json')

export function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
}

export async function activeManifests() {
  let entries = []
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const manifests = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    try {
      return await readJson(manifestPath(entry.name))
    } catch {
      return null
    }
  }))
  return manifests.filter((manifest) => manifest?.status === 'ready' && processIsAlive(manifest.launcherPid))
}

export async function resolveManifest(name) {
  if (name) {
    const manifest = await readJson(manifestPath(name))
    if (manifest.status !== 'ready' || !processIsAlive(manifest.launcherPid)) {
      throw new Error(`Agent session ${name} is not running.`)
    }
    return manifest
  }
  const active = await activeManifests()
  if (active.length === 1) return active[0]
  if (!active.length) throw new Error('No agent development session is running.')
  throw new Error(`More than one agent development session is running: ${active.map((entry) => entry.name).join(', ')}. Pass --session NAME.`)
}
