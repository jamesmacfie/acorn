import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import childProcess from 'node:child_process'
import { createRequire, syncBuiltinESMExports } from 'node:module'

const root = resolve(process.argv[2] ?? '')
if (!root.includes(`${sep}.acorn${sep}agent-dev${sep}`) || basename(root) !== 'repo' || !existsSync(join(root, '.git')))
  throw new Error('Pass a disposable .acorn/agent-dev/<session>/fixture/repo')

const include = ['src/group-009/**']
const exclude = ['**/item-09*']
const query = 'needle'
const opts = { include, exclude, caseSensitive: false, wholeWord: false, regex: false }
const core = { tasks: { root: async () => root } }
const rgPath = createRequire(resolve('plugins/editor/package.json'))('@vscode/ripgrep').rgPath as string
let spawned = 0
let gitSpawned = 0
const originalSpawn = childProcess.spawn
const originalExecFileSync = childProcess.execFileSync
childProcess.spawn = ((...args: Parameters<typeof originalSpawn>) => {
  if (args[0] === rgPath) spawned++
  if (basename(String(args[0])) === 'git') gitSpawned++
  return originalSpawn(...args)
}) as typeof originalSpawn
childProcess.execFileSync = ((...args: Parameters<typeof originalExecFileSync>) => {
  if (args[0] === rgPath) spawned++
  return originalExecFileSync(...args)
}) as typeof originalExecFileSync
syncBuiltinESMExports()

async function measure(name: string, run: () => Promise<{ files: readonly unknown[] }>) {
  const durations: number[] = []
  const processCounts: number[] = []
  let files = 0
  for (let i = 0; i < 3; i++) {
    const start = performance.now()
    spawned = 0
    const result = await run()
    durations.push(Math.round(performance.now() - start))
    processCounts.push(spawned)
    files = result.files.length
  }
  durations.sort((a, b) => a - b)
  console.log(
    JSON.stringify({
      name,
      ownerRequests: 3,
      ripgrepProcessesPerRequest: processCounts,
      durationsMs: durations,
      medianMs: durations[1],
      files,
    }),
  )
}

// The two-pass baseline: the text pass scans the whole root and discards matches whose names the
// filename pass did not select.
async function main() {
  const { runRipgrep } = await import('../../plugins/editor/src/server/searchProcess')
  const { searchInFiles } = await import('../../plugins/editor/src/server/search')
  await measure('pre-follow-up two-pass', async () => {
    const names = childProcess
      .execFileSync(
        rgPath,
        [
          '--files',
          '--null',
          '--no-config',
          ...include.flatMap((pattern) => ['--glob', pattern]),
          ...exclude.flatMap((pattern) => ['--glob', `!${pattern}`]),
          '--',
          '.',
        ],
        { cwd: root, maxBuffer: 4 * 1024 * 1024 },
      )
      .toString('utf8')
    const allowedPaths = new Set(
      names
        .split('\0')
        .filter(Boolean)
        .map((path) => (path.startsWith('./') ? path.slice(2) : path)),
    )
    return runRipgrep(root, ['--json', '--no-config', '--fixed-strings', '--ignore-case', '--', query, '.'], {
      allowedPaths,
    })
  })
  await measure('follow-up filtered owner', () => searchInFiles(core, 'task', query, opts))
  await measure('unfiltered owner', () =>
    searchInFiles(core, 'task', query, { caseSensitive: false, wholeWord: false, regex: false }),
  )
  const { ignoredEntries } = await import('../../plugins/editor/src/server/ignoredEntries')
  const { resolveInRoot } = await import('../../packages/plugin-api/src/node')
  const metadataCore = { ...core, fs: { resolveInRoot } }
  for (const directory of ['', 'src', 'src/group-009']) {
    const names = await readdir(join(root, directory))
    gitSpawned = 0
    const result = await ignoredEntries(metadataCore, 'task', directory, names)
    console.log(
      JSON.stringify({
        name: 'directory ignore owner',
        directory,
        names: names.length,
        gitProcesses: gitSpawned,
        available: result.available,
        ignored: result.ignored.length,
        responseBytes: Buffer.byteLength(JSON.stringify(result)),
      }),
    )
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
