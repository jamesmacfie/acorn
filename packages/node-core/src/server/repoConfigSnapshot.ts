// Captured executable configuration bytes and their approval identity.
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs'
import { resolveInRoot } from './core/fs'
import type { schema } from './db'

export type RepoConfigSnapshot = { hash: string; text: string; files: Array<{ path: string; content: string }> }

// The project row's executable columns: commands acorn runs later, on worktree creation, a dev run, an
// archive, or a database connect. Every one of them is a shell command, which is why they belong in a
// snapshot the owner acknowledges rather than only in a settings form.
//
// `runTargets` is here with the other five even though it is a JSON blob rather than a single command,
// because what the blob holds is `command`, `stop` and `restart` strings that the run pane executes.
// Leaving it out would put the same hole one column over.
export type ProjectExecutableConfig = Partial<Pick<
  typeof schema.projects.$inferSelect,
  'setupScript' | 'devScript' | 'devRestartScript' | 'teardownScript' | 'dbUrlScript' | 'runTargets'
>>

// The pseudo-path the project row is snapshotted under. Not a file, and named so it cannot collide
// with one: everything else in a snapshot is a real path relative to the checkout.
const PROJECT_ROW_PATH = '(project settings)'

const PROJECT_ROW_FIELDS = ['setupScript', 'devScript', 'devRestartScript', 'teardownScript', 'dbUrlScript', 'runTargets'] as const

// Fixed field order and only the fields that are set, so the same configuration hashes the same way
// whatever order the columns arrive in and an unset column never differs from an empty one.
function projectRowText(project: ProjectExecutableConfig): string | null {
  const lines = PROJECT_ROW_FIELDS
    .map((field) => [field, project[field]?.trim()] as const)
    .filter((entry): entry is readonly [typeof PROJECT_ROW_FIELDS[number], string] => !!entry[1])
    .map(([field, value]) => `${field} = ${value}`)
  return lines.length ? lines.join('\n') : null
}

// Snapshot every piece of executable configuration this task could run: the repo-owned files, and the
// project row's script columns. Keeping the verbatim text makes the approval inspectable and diffable;
// sorting paths makes the hash deterministic across platforms.
//
// The row is in here because the gate's original premise — the checkout is untrusted, the database is
// trusted — only holds while nothing but the owner can write the database. `PUT /v1/core/projects/:id/config`
// is device-only now (server/index.ts), so that premise is true again; this is the belt behind it. A
// write the owner did not make still changes the hash, and the next thing that asks for trust shows the
// owner the script rather than running it.
export type RepoConfigSnapshotLimits = {
  fileBytes: number
  totalBytes: number
  files: number
  directoryEntries: number
}

const SNAPSHOT_LIMITS: RepoConfigSnapshotLimits = {
  fileBytes: 1024 * 1024,
  totalBytes: 8 * 1024 * 1024,
  files: 256,
  directoryEntries: 1024,
}

function existingPath(repoDir: string, path: string): string | null {
  const confined = resolveInRoot(repoDir, path)
  if (!confined) throw new Error(`Repository configuration path '${path}' escapes its root or has an unresolved link.`)
  try {
    lstatSync(confined)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  // Preserve internal aliases, then refuse a replaced leaf symlink at descriptor open.
  return realpathSync(confined)
}

function readSnapshotFile(path: string, label: string, maxBytes: number): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error(`Repository configuration '${label}' must be a regular file.`)
    if (stat.size > maxBytes) throw new Error(`Repository configuration '${label}' exceeds its byte limit.`)
    const chunks: Buffer[] = []
    let bytes = 0
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes - bytes + 1))
      const count = readSync(fd, chunk, 0, chunk.length, null)
      if (!count) break
      bytes += count
      if (bytes > maxBytes) throw new Error(`Repository configuration '${label}' exceeds its byte limit.`)
      chunks.push(chunk.subarray(0, count))
    }
    return Buffer.concat(chunks, bytes).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

export function readRepoConfigSnapshot(
  repoDir: string,
  project?: ProjectExecutableConfig | null,
  limits: RepoConfigSnapshotLimits = SNAPSHOT_LIMITS,
): RepoConfigSnapshot | null {
  const paths: string[] = []
  const config = existingPath(repoDir, '.acorn/config.toml')
  if (config) {
    if (limits.files < 1) throw new Error('Repository configuration exceeds its file limit.')
    paths.push('.acorn/config.toml')
  }
  const workflowsDir = existingPath(repoDir, '.acorn/workflows')
  if (workflowsDir) {
    const dir = opendirSync(workflowsDir)
    try {
      let entries = 0
      for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
        if (++entries > limits.directoryEntries) throw new Error('Repository workflow directory exceeds its entry limit.')
        if (!entry.name.endsWith('.toml')) continue
        if (paths.length >= limits.files) throw new Error('Repository configuration exceeds its file limit.')
        paths.push(`.acorn/workflows/${entry.name}`)
      }
    } finally {
      dir.closeSync()
    }
  }
  paths.sort()
  const files: RepoConfigSnapshot['files'] = []
  let totalBytes = 0
  for (const path of paths) {
    const fullPath = existingPath(repoDir, path)
    if (!fullPath) throw new Error(`Repository configuration '${path}' disappeared while reading its snapshot.`)
    const content = readSnapshotFile(fullPath, path, Math.min(limits.fileBytes, limits.totalBytes - totalBytes))
    totalBytes += Buffer.byteLength(content)
    if (totalBytes > limits.totalBytes) throw new Error('Repository configuration exceeds its total byte limit.')
    files.push({ path, content })
  }
  const row = project ? projectRowText(project) : null
  if (row) {
    if (files.length >= limits.files) throw new Error('Repository configuration exceeds its file limit.')
    if (Buffer.byteLength(row) > limits.fileBytes) throw new Error('Project executable configuration exceeds its byte limit.')
    files.push({ path: PROJECT_ROW_PATH, content: row })
  }
  if (!files.length) return null
  const text = files.map((file) => `### ${file.path}\n${file.content.replace(/\s+$/, '')}\n`).join('\n')
  if (Buffer.byteLength(text) > limits.totalBytes) throw new Error('Repository configuration exceeds its total byte limit.')
  return { files, text, hash: createHash('sha256').update(text).digest('hex') }
}
