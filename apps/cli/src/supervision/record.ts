import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { configDir } from '@acorn/custody/local'

export type ServiceRecord = {
  root: string
  pid: number
  instanceId: string
  nodeId: string
  endpoint: string
  fingerprint: string
  logPath: string
  startedAt: number
}

export function canonicalRoot(root: string): string {
  const absolute = resolve(root)
  const missing: string[] = []
  let ancestor = absolute
  while (!existsSync(ancestor)) {
    missing.unshift(basename(ancestor))
    ancestor = dirname(ancestor)
  }
  return join(realpathSync(ancestor), ...missing)
}

export function servicePaths(root: string): { dir: string; record: string; claim: string; log: string } {
  const key = createHash('sha256').update(canonicalRoot(root)).digest('hex').slice(0, 24)
  const dir = join(configDir(), 'services')
  return { dir, record: join(dir, `${key}.json`), claim: join(dir, `${key}.claim`), log: join(dir, `${key}.log`) }
}

export function prepareServiceDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
}

export function readServiceRecord(path: string, root: string): ServiceRecord | null {
  try {
    const row = JSON.parse(readFileSync(path, 'utf8')) as Partial<ServiceRecord>
    if (row.root !== canonicalRoot(root) || !Number.isSafeInteger(row.pid) || row.pid! < 1 ||
      typeof row.instanceId !== 'string' || typeof row.nodeId !== 'string' ||
      typeof row.endpoint !== 'string' || typeof row.fingerprint !== 'string' ||
      typeof row.logPath !== 'string' || !Number.isSafeInteger(row.startedAt)) return null
    return row as ServiceRecord
  } catch { return null }
}

export function writeServiceRecord(path: string, record: ServiceRecord): void {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: 'wx' })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

export function clearServiceRecord(path: string, instanceId: string): void {
  try {
    const row = JSON.parse(readFileSync(path, 'utf8')) as { instanceId?: unknown }
    if (row.instanceId === instanceId) rmSync(path, { force: true })
  } catch { /* The record has already gone or changed. */ }
}
