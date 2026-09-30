// Declarative hints still consume untrusted repository bytes. Keep that read confined, regular and
// bounded, without requiring approval for developer commands that this file never executes.
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

export const MAX_DOCKER_CONFIG_BYTES = 1024 * 1024

export async function readRepoDockerConfig(checkout: string): Promise<string> {
  const root = await realpath(checkout)
  const path = await realpath(join(checkout, '.acorn', 'config.toml'))
  const rel = relative(root, path)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('Docker repository configuration is outside its checkout')
  }
  // NONBLOCK avoids blocking on a FIFO before fstat; NOFOLLOW refuses a replaced leaf symlink.
  // Windows does not implement these flags, so canonical confinement / regular-file checks remain.
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_DOCKER_CONFIG_BYTES) throw new Error('Invalid Docker repository configuration')
    const bytes = Buffer.alloc(MAX_DOCKER_CONFIG_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > MAX_DOCKER_CONFIG_BYTES) throw new Error('Docker repository configuration is too large')
    return bytes.subarray(0, length).toString('utf8')
  } finally {
    await file.close()
  }
}
