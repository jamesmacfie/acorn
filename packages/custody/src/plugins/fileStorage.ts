import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { writePrivateAtomic } from '@acorn/node-core/server/storage/dataRoot.ts'
import type { BundleStorage, TrustStorage } from '../rules/storage'

// The desktop's and the terminal client's storage for the custody rules, as files in a directory this
// device owns: 0700 directory, 0600 files. The phone's is IndexedDB (apps/mobile/src/client/pluginStorage.ts).

const CACHE_DIR = `${ACORN_BASELINE}-plugin-cache`
const INDEX_FILE = 'index.json'
const TRUST_FILE = `${ACORN_BASELINE}-plugin-trust.json`
const HASH_RE = /^[0-9a-f]{64}$/

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null // no file yet
  }
}

export class FileBundleStorage implements BundleStorage {
  constructor(private readonly userDataDir: string) {}

  private get dir(): string {
    return join(this.userDataDir, CACHE_DIR)
  }

  bundlePath(hash: string): string {
    return join(this.dir, `${hash}.js`)
  }

  readIndex(): string | null {
    return readText(join(this.dir, INDEX_FILE))
  }

  writeIndex(text: string): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    writePrivateAtomic(join(this.dir, INDEX_FILE), text)
  }

  // Write to a temp file and rename, so a crash mid-write cannot leave a truncated file under a hash
  // that promises its contents. The temp name carries the hash for the same reason.
  //
  // Deliberately not node-core's `writePrivateAtomic`: that helper takes a string and fsyncs, and a
  // bundle is bytes named by their own sha256 that the helper re-downloads when it is missing. The
  // durability the fsync buys would be paid on every plugin update to protect a cache entry. The
  // index and the trust store next door do call the helper, because losing those costs more than a
  // download.
  writeBundle(hash: string, bytes: Uint8Array): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const target = this.bundlePath(hash)
    const temp = `${target}.tmp`
    writeFileSync(temp, bytes, { mode: 0o600 })
    chmodSync(temp, 0o600)
    renameSync(temp, target)
  }

  removeBundle(hash: string): void {
    rmSync(this.bundlePath(hash), { force: true })
  }

  keepOnly(hashes: ReadonlySet<string>): void {
    let files: string[]
    try {
      files = readdirSync(this.dir)
    } catch {
      return // no cache directory yet
    }
    for (const file of files) {
      if (file === INDEX_FILE) continue
      const hash = file.replace(/\.js$/, '')
      if (HASH_RE.test(hash) && hashes.has(hash)) continue
      rmSync(join(this.dir, file), { force: true })
    }
  }
}

export class FileTrustStorage implements TrustStorage {
  constructor(private readonly userDataDir: string) {}

  private get path(): string {
    return join(this.userDataDir, TRUST_FILE)
  }

  read(): string | null {
    return readText(this.path)
  }

  // The shared open-write-fsync-close-rename, not a plain write: a torn trust file is a security
  // record the user set once, and the recovery from a half-written one is quarantine plus a prompt
  // for every plugin. The blob cache next door deliberately keeps the looser variant; see
  // `FileBundleStorage.writeBundle`.
  write(text: string): void {
    mkdirSync(this.userDataDir, { recursive: true, mode: 0o700 })
    writePrivateAtomic(this.path, text)
  }

  setAside(): string {
    renameSync(this.path, `${this.path}.corrupt`)
    return `${TRUST_FILE}.corrupt`
  }
}
