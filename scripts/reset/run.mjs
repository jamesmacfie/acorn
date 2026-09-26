import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync, closeSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { explicitRoot, inside, inventoryRoots, isDeviceTokenFile } from './inventory.mjs'

const VERSION = 'acorn-reset-snapshot-1'
const json = value => `${JSON.stringify(value, null, 2)}\n`
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')

function refuseOpenFiles(files) {
  for (let start = 0; start < files.length; start += 64) {
    const check = spawnSync('lsof', ['-t', '--', ...files.slice(start, start + 64).map(file => file.path)], { encoding: 'utf8' })
    if (check.error || ![0, 1].includes(check.status)) throw new Error('Cannot verify stopped writers with lsof; reset refused')
    if (check.stdout.trim()) throw new Error(`Open reset target held by process ${check.stdout.trim().split(/\s+/).join(', ')}`)
  }
}

function privateWrite(path, value) {
  const temp = `${path}.${process.pid}.tmp`
  if (existsSync(temp)) {
    const stat = lstatSync(temp)
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) throw new Error(`Unsafe interrupted recovery file: ${temp}`)
    rmSync(temp)
  }
  writeFileSync(temp, value, { flag: 'wx', mode: 0o600 })
  const fd = openSync(temp, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temp, path)
  chmodSync(path, 0o600)
}

function recoveryPath(value, roots, files) {
  if (!value || !isAbsolute(value)) throw new Error('--recovery-dir must be an explicit absolute path')
  const path = resolve(value)
  for (const root of Object.values(roots)) if (inside(root, path) || inside(path, root)) throw new Error(`Recovery overlaps reset root: ${path}`)
  for (const file of files) if (inside(file.path, path) || inside(path, file.path)) throw new Error(`Recovery overlaps reset target: ${path}`)
  let cursor = path
  while (!existsSync(cursor)) cursor = dirname(cursor)
  explicitRoot(cursor, 'recoveryParent')
  if (existsSync(path)) {
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) throw new Error(`Unsafe recovery directory: ${path}`)
    if ((lstatSync(path).mode & 0o077) !== 0) throw new Error(`Recovery directory must be private: ${path}`)
  }
  return path
}

function verifiedDesktopStage(recoveryDir, desktopRoot, files) {
  const path = join(recoveryDir, 'desktop-stage.json')
  if (!existsSync(path)) throw new Error(`Desktop host stage is missing: ${path}`)
  if (!lstatSync(path).isFile() || (lstatSync(path).mode & 0o077) !== 0) throw new Error(`Desktop host stage is not private: ${path}`)
  const stage = JSON.parse(readFileSync(path, 'utf8'))
  if (stage.desktopRoot !== desktopRoot || stage.complete !== true || !Array.isArray(stage.files) || stage.files.length === 0) throw new Error('Desktop host stage is incomplete or names another custody root')
  if (!stage.files.some(file => file.path === 'desktop-origin.json')) throw new Error('Desktop origin export is absent from the host stage')
  for (const entry of stage.files) {
    if (typeof entry.path !== 'string' || !/^[A-Za-z0-9._-]+$/.test(entry.path) || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('Malformed desktop host export entry')
    const exported = resolve(recoveryDir, entry.path)
    if (!inside(recoveryDir, exported) || exported === path || !existsSync(exported)) throw new Error(`Desktop host export is missing or outside recovery: ${entry.path}`)
    const stat = lstatSync(exported)
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || digest(exported) !== entry.sha256) throw new Error(`Desktop host export failed verification: ${entry.path}`)
  }
  const encryptedTokens = files.some(file => dirname(file.path) === desktopRoot && isDeviceTokenFile(basename(file.path)))
  if (encryptedTokens) {
    const keyFile = join(recoveryDir, 'desktop-key.txt')
    if (!stage.files.some(file => file.path === 'desktop-key.txt')) throw new Error('Desktop token key is absent from the host stage')
    if (!/^[0-9a-f]{64}$/.test(readFileSync(keyFile, 'utf8').trim())) throw new Error('Desktop token key is unreadable; custody files remain untouched')
  }
  return stage
}

function assertSource(file, expectedHash) {
  if (!existsSync(file.path)) throw new Error(`Source vanished before export: ${file.path}`)
  const stat = lstatSync(file.path)
  if (!stat.isFile() || stat.nlink !== 1 || stat.size !== file.bytes || stat.mtimeMs !== file.mtimeMs) throw new Error(`Source changed during reset: ${file.path}`)
  const hash = digest(file.path)
  if (expectedHash && hash !== expectedHash) throw new Error(`Source hash changed during reset: ${file.path}`)
  return hash
}

function sameInventory(saved, current) {
  const fields = file => [file.path, file.bytes, file.mtimeMs, [...file.owners].sort().join(',')]
  const expected = saved.filter(file => existsSync(file.path))
  if (saved.some(file => !existsSync(file.path) && file.status === 'pending')) return false
  return JSON.stringify(expected.map(fields)) === JSON.stringify(current.map(fields))
}

function sameDirectories(saved, current) {
  const fields = dir => [dir.path, [...dir.owners].sort().join(',')]
  const expected = saved.filter(dir => existsSync(dir.path))
  return JSON.stringify(expected.map(fields)) === JSON.stringify(current.map(fields))
}

export function parseResetArguments(args) {
  const options = { execute: false }
  const names = { '--node-root': 'nodeRoot', '--desktop-root': 'desktopRoot', '--tui-root': 'tuiRoot', '--memory-root': 'memoryRoot', '--recovery-dir': 'recoveryDir' }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--execute') { options.execute = true; continue }
    if (!names[arg] || !args[i + 1] || args[i + 1].startsWith('--') || options[names[arg]]) throw new Error(`Unknown, missing, or duplicate reset argument: ${arg}`)
    options[names[arg]] = args[++i]
  }
  return options
}

export function runReset(options, hooks = {}) {
  const { roots, files, directories, outstanding } = inventoryRoots(options)
  const result = { version: VERSION, mode: options.execute ? 'reset' : 'inventory', roots, files, directories, outstanding, complete: false }
  if (!options.execute) return result
  const recoveryDir = recoveryPath(options.recoveryDir, roots, files)
  result.recoveryDir = recoveryDir
  // The host stage owns app://acorn and the native keychain. Custody files follow only after its
  // verified export and removal, so their encrypted bytes remain recoverable.
  if (roots.desktopRoot) {
    verifiedDesktopStage(recoveryDir, roots.desktopRoot, files)
    outstanding.length = 0
  }
  refuseOpenFiles(files)
  const manifestPath = join(recoveryDir, 'manifest.json')
  let manifest
  if (existsSync(recoveryDir) && existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.version !== VERSION || JSON.stringify(manifest.roots) !== JSON.stringify(roots) || !sameInventory(manifest.files, files) || !sameDirectories(manifest.directories, directories)) throw new Error('Recovery manifest does not match the current inventory')
  } else {
    if (!existsSync(recoveryDir)) mkdirSync(recoveryDir, { mode: 0o700 })
    else if (!roots.desktopRoot || readdirSync(recoveryDir).some(name => !['desktop-stage.json', ...verifiedDesktopStage(recoveryDir, roots.desktopRoot, files).files.map(file => file.path)].includes(name))) throw new Error(`Recovery directory contains unlisted files: ${recoveryDir}`)
    chmodSync(recoveryDir, 0o700)
    manifest = { version: VERSION, createdAt: new Date().toISOString(), roots, files: files.map((file, index) => ({ ...file, recoveryFile: `files/${String(index).padStart(6, '0')}`, status: 'pending' })), directories: directories.map(dir => ({ ...dir, status: 'pending' })), outstanding, complete: false, recovery: 'Restore these files into isolated roots with the old Acorn binary. Check SHA-256 hashes before restoring; do not import them into the new baseline.' }
    privateWrite(manifestPath, json(manifest))
    mkdirSync(join(recoveryDir, 'files'), { mode: 0o700 })
  }
  const save = () => privateWrite(manifestPath, json(manifest))
  for (const file of manifest.files) {
    const exported = join(recoveryDir, file.recoveryFile)
    if (file.status === 'removed') {
      if (existsSync(file.path) || !existsSync(exported) || digest(exported) !== file.sha256) throw new Error(`Removed file is not safely recovered: ${file.path}`)
      continue
    }
    if (file.status === 'pending') {
      const hash = assertSource(file)
      const temp = `${exported}.tmp`
      if (existsSync(temp)) rmSync(temp)
      copyFileSync(file.path, temp)
      chmodSync(temp, 0o600)
      if (digest(temp) !== hash) throw new Error(`Recovery copy failed verification: ${file.path}`)
      renameSync(temp, exported)
      file.sha256 = hash
      file.status = 'exported'
      save()
      hooks.afterExport?.(file)
    }
  }
  // Do not begin removal until every recovery copy is present and verified.
  for (const file of manifest.files) if (file.status !== 'removed' && (!existsSync(join(recoveryDir, file.recoveryFile)) || digest(join(recoveryDir, file.recoveryFile)) !== file.sha256)) throw new Error(`Missing recovery copy: ${file.path}`)
  refuseOpenFiles(manifest.files.filter(file => file.status !== 'removed' && existsSync(file.path)))
  for (const file of manifest.files) {
    if (file.status === 'removed') continue
    const exported = join(recoveryDir, file.recoveryFile)
    if (existsSync(file.path)) {
      assertSource(file, file.sha256)
      if (digest(exported) !== file.sha256) throw new Error(`Recovery copy changed: ${exported}`)
      rmSync(file.path)
    }
    file.status = 'removed'
    save()
    hooks.afterRemoval?.(file)
  }
  for (const dir of manifest.directories) {
    if (dir.status === 'removed') continue
    if (existsSync(dir.path)) {
      if (!lstatSync(dir.path).isDirectory()) throw new Error(`Owned directory changed during reset: ${dir.path}`)
      rmdirSync(dir.path) // refuses a new writer's file or an unlisted entry
    }
    dir.status = 'removed'
    save()
    hooks.afterDirectoryRemoval?.(dir)
  }
  manifest.complete = outstanding.length === 0
  save()
  return { ...result, files: manifest.files, directories: manifest.directories, complete: manifest.complete }
}
