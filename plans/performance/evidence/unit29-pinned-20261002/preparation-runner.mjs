// Reproducible preparation evidence for the sustained-use gate. This does not run the workload.
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { assertSupportedNodeRuntime } from '../../packages/protocol/src/runtime/nodeRuntime.ts'

assertSupportedNodeRuntime(process.versions.node)
const root = resolve(import.meta.dirname, '../..')
const tag = process.argv[2]
if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(tag ?? '')) throw new Error('Supply a unique evidence tag.')
const directory = join(import.meta.dirname, 'evidence', `unit29-${tag}`)
await mkdir(directory, { recursive: false })
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const save = (file, value) => writeFile(join(directory, file), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function sources() {
  const paths = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0')
    .filter(path => /^(apps|packages|plugins|scripts|tools)\//.test(path) || /^(package.json|pnpm-lock.yaml|pnpm-workspace.yaml|turbo.json|node-runtime.json)$/.test(path))
  const hashes = {}
  for (const path of paths.sort()) {
    try { hashes[path] = digest(await readFile(join(root, path))) }
    catch (error) { if (error.code === 'ENOENT') hashes[path] = null; else throw error }
  }
  return { at: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), hashes }
}

async function assets() {
  const hashes = {}
  async function walk(path) {
    let entries
    try { entries = await readdir(path, { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) {
        const bytes = await readFile(child)
        hashes[relative(root, child)] = { bytes: bytes.length, sha256: digest(bytes) }
      }
    }
  }
  for (const path of ['apps/node/dist', 'apps/tui/dist', 'apps/desktop/dist', 'apps/desktop/dist-helper', 'apps/desktop/dist-bridge']) {
    await walk(join(root, path))
  }
  return { at: new Date().toISOString(), note: 'Build files present on disk; presence does not establish fresh staging or native app identity.', hashes }
}

const before = await sources()
await writeFile(join(directory, 'preparation-runner.mjs'), await readFile(import.meta.filename), { flag: 'wx' })
await save('source-before.json', before)
await save('assets-before.json', await assets())
const prerequisites = []
for (let unit = 9; unit <= 28; unit++) {
  const prefix = `implementation-${String(unit).padStart(2, '0')}-`
  const files = (await readdir(import.meta.dirname)).filter(file => file.startsWith(prefix) && !file.includes('review-brief'))
  prerequisites.push({ unit, records: files, reviewStatus: 'not-revalidated', note: 'Record presence is not coordinator acceptance.' })
}
const results = {
  startedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  prerequisites, commands: [], status: 'preparation-only', cyclesCompleted: 0,
  visibility: { native: 'not-observed', document: 'not-observed', focus: 'not-observed' },
  omittedMeasurements: ['Native latency', 'Process CPU deltas and RSS', 'Renderer heap', 'Production owner plateau counters', 'Two-Node sustained composition'],
}
await save('prerequisites.json', prerequisites)

async function command(name, args) {
  const started = performance.now()
  const logName = `${name}.txt`
  const log = createWriteStream(join(directory, logName), { flags: 'wx' })
  const child = spawn('rtk', ['proxy', ...args], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  const outcome = await new Promise(resolveExit => {
    child.once('error', error => resolveExit({ exitCode: null, error: error.message }))
    child.once('close', (exitCode, signal) => resolveExit({ exitCode, signal }))
  })
  await new Promise(resolveLog => log.end(resolveLog))
  const result = { command: ['rtk', 'proxy', ...args], log: logName, elapsedMs: performance.now() - started, ...outcome }
  result.logSha256 = digest(await readFile(join(directory, logName)))
  results.commands.push(result)
  console.log(`${name}: exit ${outcome.exitCode}, ${Math.round(result.elapsedMs)} ms`)
}

// Run preparation sequentially. No benchmark result is accepted while implementation is changing.
await command('lint', ['pnpm', 'lint', '--force'])
await command('test', ['pnpm', 'test', '--force'])
await command('service-build', ['pnpm', '--filter', '@acorn/node', 'build'])
await command('tui-build', ['pnpm', '--filter', '@acorn/tui', 'build'])
const after = await sources()
await save('source-after.json', after)
await save('assets-after.json', await assets())
results.finishedAt = new Date().toISOString()
results.sourceChanges = [...new Set([...Object.keys(before.hashes), ...Object.keys(after.hashes)])]
  .filter(path => before.hashes[path] !== after.hashes[path])
results.commitChanged = before.commit !== after.commit
results.note = 'Preparation results require review. No 200-cycle, visible latency, or multi-day acceptance is claimed.'
await save('results.json', results)
if (results.commands.some(result => result.exitCode !== 0)) process.exitCode = 1
