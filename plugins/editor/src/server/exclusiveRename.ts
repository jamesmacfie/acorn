import { mkdtemp, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join } from 'node:path'
import type { CoreServices } from '@acorn/plugin-api/node'

type ProcessRunner = Pick<CoreServices['proc'], 'runProcess'>

// Node's fs.rename has no exclusive mode. The two supported kernels expose an atomic primitive,
// invoked by this tiny helper on the owning Node. A host without a C compiler fails closed.
const source = `
#ifdef __linux__
#define _GNU_SOURCE
#endif
#include <errno.h>
#include <stdio.h>
#include <string.h>
#ifdef __APPLE__
#elif __linux__
#include <fcntl.h>
#endif
int main(int argc, char **argv) {
  if (argc != 3) return 2;
#ifdef __APPLE__
  if (renamex_np(argv[1], argv[2], RENAME_EXCL) == 0) return 0;
#elif __linux__
  if (renameat2(AT_FDCWD, argv[1], AT_FDCWD, argv[2], RENAME_NOREPLACE) == 0) return 0;
#else
  errno = ENOTSUP;
#endif
  if (errno == EEXIST || errno == ENOTEMPTY) return 17;
  if (errno == ENOSYS || errno == ENOTSUP || errno == EINVAL) return 18;
  fprintf(stderr, "%s", strerror(errno));
  return 1;
}
`

let helper: Promise<string> | undefined
async function executable(proc: ProcessRunner): Promise<string> {
  if (platform() !== 'darwin' && platform() !== 'linux') throw new Error('Exclusive rename is unavailable on this Node host.')
  helper ??= (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'acorn-exclusive-rename-'))
    process.once('exit', () => { try { rmSync(directory, { recursive: true, force: true }) } catch { /* best effort */ } })
    const input = join(directory, 'rename.c')
    const output = join(directory, 'rename')
    await writeFile(input, source)
    const compiled = await proc.runProcess({ file: 'cc', args: ['-o', output, input], cwd: directory, timeoutMs: 15_000, maxOutputBytes: 4_096 })
    if (compiled.code !== 0) throw new Error(`Exclusive rename is unavailable on this Node host: ${compiled.spawnError ?? compiled.stderr}`)
    return output
  })()
  return helper
}

/** The kernel either moves the entry to an absent name or leaves both entries alone. */
export async function exclusiveRename(proc: ProcessRunner, from: string, to: string): Promise<void> {
  const binary = await executable(proc)
  const result = await proc.runProcess({ file: binary, args: [from, to], cwd: tmpdir(), timeoutMs: 30_000, maxOutputBytes: 4_096 })
  if (result.code === 0) return
  if (result.code === 17) throw new Error('A file or folder already has that name.')
  if (result.code === 18) throw new Error('This Node volume does not support exclusive rename.')
  throw new Error(`Exclusive rename failed: ${result.spawnError ?? result.stderr ?? 'unknown error'}`)
}
