import { cpSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureCert } from '../server/transport/tls.ts'

// One certificate per test process, copied into every data root that wants one.
//
// ensureCert shells out to `openssl req -newkey rsa:2048`, and an RSA keygen is a random prime
// search: usually tens of milliseconds, occasionally seconds, and under a fully loaded machine
// enough to push a suite that minted a fresh pair per test past its timeout. The generated pair is
// interchangeable for anything that only needs a working loopback identity.
//
// Suites that are about generation itself, tls.test.ts, must keep calling ensureCert on a fresh root.
let template: string | null = null

/** Seed `<dataRoot>/tls` so the next ensureCert call finds a pair and skips openssl. */
export const seedTlsCert = (dataRoot: string): void => {
  if (!template) {
    template = mkdtempSync(join(tmpdir(), 'acorn-tls-template-'))
    ensureCert(template)
  }
  const dir = join(dataRoot, 'tls')
  // 0700 first, matching ensureCert: the copy writes the key under the ambient umask, and the
  // directory mode is what closes the window in which a readable private key exists.
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  cpSync(join(template, 'tls'), dir, { recursive: true })
}
