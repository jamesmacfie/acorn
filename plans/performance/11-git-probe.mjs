// Run with: rtk proxy node --expose-gc --import tsx plans/performance/11-git-probe.mjs <case> [tag]
// Cases: retention, stamps, paths, markers, scans, heads, limits. Output defaults to sample, never before.
import cp from 'node:child_process'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const kind = process.argv[2] ?? 'stamps'
const tag = process.argv[3] ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe output tag.')
const root = process.cwd()
const output = resolve(root, `plans/performance/11-${kind}-${tag}.json`)
if (tag.startsWith('before') && fs.existsSync(output)) throw new Error('Before artifact exists; use a new tag.')
const fixture = fs.mkdtempSync(join(tmpdir(), 'acorn-perf11-'))
process.env.GIT_CONFIG_GLOBAL = '/dev/null'
process.env.GIT_CONFIG_NOSYSTEM = '1'
const originalSpawn = cp.spawn
const originalLstat = fsp.lstat
let commands = [], liveGit = 0, peakGit = 0, pendingStats = 0, peakStats = 0, statCalls = 0, peakHeap = 0
let fakeBytes = 0, gitDelay = 0, statusResponses = null
cp.spawn = (file, args, options) => {
  if (file !== 'git') return originalSpawn(file, args, options)
  commands.push(args.join(' '))
  peakGit = Math.max(peakGit, ++liveGit)
  let child
  if (statusResponses && args[0] === 'status') {
    const reply = statusResponses.shift()
    if (!reply) throw new Error('No synthetic status response was prepared.')
    child = originalSpawn(process.execPath, ['-e', `setTimeout(() => process.stdout.write('# branch.oid ${reply.head}\\n# branch.head fixture\\n'), ${reply.delay})`], options)
  } else if (fakeBytes) {
    child = originalSpawn(process.execPath, ['-e', `process.stdout.write('1\\t0\\tfile-name\\n'.repeat(${fakeBytes / 14}));`], options)
  } else if (gitDelay) {
    child = originalSpawn(process.execPath, ['-e', `setTimeout(() => process.stdout.write('# branch.oid ${'a'.repeat(40)}\\n# branch.head fixture\\n'), ${gitDelay})`], options)
  } else child = originalSpawn(file, args, options)
  child.once('close', () => { liveGit-- })
  return child
}
fsp.lstat = (...args) => {
  statCalls++
  peakStats = Math.max(peakStats, ++pendingStats)
  if (pendingStats % 250 === 0) peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed)
  return originalLstat(...args).finally(() => { pendingStats-- })
}
syncBuiltinESMExports()
const source = (path) => import(pathToFileURL(resolve(root, path)).href)
const status = await source('packages/node-core/src/server/worktrees/worktreeStatus.ts')
const tasks = await source('packages/node-core/src/server/worktrees/taskWorktree.ts')
const changes = await source('plugins/changes/src/server/localDiff.ts')
const gitOwner = await source('packages/node-core/src/server/core/git.ts')
const heap = () => { for (let i = 0; i < 4; i++) global.gc?.(); return process.memoryUsage().heapUsed }
const reset = () => { commands = []; peakGit = liveGit; statCalls = 0; peakStats = 0; peakHeap = 0 }
const hist = () => Object.fromEntries([...new Set(commands.map(c => c.split(' ')[0]))].map(k => [k, commands.filter(c => c.split(' ')[0] === k).length]))
async function measure(label, fn) {
  reset(); const startHeap = heap(); const startCpu = process.cpuUsage(); const start = performance.now()
  const value = await fn()
  const cpu = process.cpuUsage(startCpu)
  return { label, wallMs: performance.now() - start, nodeCpuMs: (cpu.user + cpu.system) / 1000,
    commands: commands.length, commandKinds: hist(), peakGit, statCalls, peakPendingLstat: peakStats,
    sampledHeapGrowthBytes: Math.max(0, peakHeap - startHeap), value }
}
const gitSetup = (cwd, ...args) => cp.execFileSync('git', ['-C', cwd, ...args], { env: process.env, stdio: 'pipe' }).toString()
function repo() {
  const dir = join(fixture, 'repo'); fs.mkdirSync(dir)
  gitSetup(dir, 'init', '-q', '-b', 'main')
  gitSetup(dir, 'config', 'user.email', 'fixture@example.test'); gitSetup(dir, 'config', 'user.name', 'Fixture')
  gitSetup(dir, 'config', 'commit.gpgsign', 'false')
  fs.writeFileSync(join(dir, 'tracked.txt'), 'base\n'); gitSetup(dir, 'add', '.'); gitSetup(dir, 'commit', '-qm', 'base')
  return dir
}
const fakeDb = (rows) => ({ select: () => ({ from: () => ({ where: async () => rows }) }) })
let result
try {
  if (kind === 'retention') {
    fakeBytes = 14 * 48_000
    const paths = Array.from({ length: 24 }, (_, i) => join(fixture, `wt-${i}`)); paths.forEach(p => fs.mkdirSync(p))
    status.invalidateWorktreeStatus(); await status.worktreeGitText(paths[0], ['diff', '--numstat']); status.invalidateWorktreeStatus()
    const base = heap()
    const readBytes = await (async () => { let bytes = 0; for (const p of paths) bytes += Buffer.byteLength(await status.worktreeGitText(p, ['diff', '--numstat'])); return bytes })()
    const populated = heap()
    await new Promise(r => setTimeout(r, status.WORKTREE_STATUS_TTL_MS + 250))
    const expired = heap()
    paths.forEach(p => fs.rmSync(p, { recursive: true, force: true }))
    const missingCount = await (async () => (await tasks.computeTaskStatuses(fakeDb(paths.map((p, i) => ({ id: `task-${i}`, projectId: 'fixture', worktreePath: p }))))).filter(s => s.missing).length)()
    const missing = heap()
    status.invalidateWorktreeStatus(); const cleared = heap()
    result = { syntheticGitOutput: true, paths: paths.length, readBytes, ttlMs: status.WORKTREE_STATUS_TTL_MS,
      baselineHeapBytes: base, populatedHeapBytes: populated, expiredHeapBytes: expired,
      missingPaths: missingCount, missingHeapBytes: missing, clearedHeapBytes: cleared,
      retainedPastTtlBytes: expired - base, reclaimedAfterInvalidateBytes: missing - cleared }
  } else if (kind === 'stamps') {
    const dir = repo(); const count = 3000
    for (let i = 0; i < count; i++) fs.writeFileSync(join(dir, `untracked-${String(i).padStart(5, '0')}.txt`), 'synthetic\n')
    const invoke = async (readers) => {
      const summaries = await Promise.all(Array.from({ length: readers }, async () => {
        const value = await changes.localStatus(dir)
        return { entries: value.changes.length, responseBytes: Buffer.byteLength(JSON.stringify(value)) }
      })); return summaries
    }
    status.invalidateWorktreeStatus(dir)
    result = { files: count, cold: await measure('cold-one-reader', () => invoke(1)), warm: await measure('warm-one-reader', () => invoke(1)), overlapping: await measure('warm-four-readers', () => invoke(4)) }
  } else if (kind === 'paths') {
    const dir = repo(); const names = ['plain.txt', 'café.txt', 'tab\tname.txt', 'quote"name.txt', 'space name.txt']
    for (const n of names) fs.writeFileSync(join(dir, n), 'synthetic content\n')
    status.invalidateWorktreeStatus(dir)
    const first = await changes.localStatus(dir), second = await changes.localStatus(dir)
    const { patchKey } = await source('plugins/changes/src/client/model.ts')
    const rows = []
    for (const c of first.changes) {
      reset(); const patch = await changes.localDiff(dir, c.path, 'unstaged')
      rows.push({ returnedPath: c.path, actualPathExists: fs.existsSync(join(dir, c.path)), contentKeyPresent: c.contentKey !== undefined,
        stableKey: c.contentKey === second.changes.find(s => s.path === c.path)?.contentKey,
        effectiveKeyChangesWithPoll: patchKey(c, 1) !== patchKey(c, 2), patchBytes: Buffer.byteLength(patch.patch), gitCommands: commands.length })
    }
    result = { actualNames: names, expected: 'Every actual filename is returned exactly, has a stable key, and has a nonempty patch.', rows }
  } else if (kind === 'limits') {
    const dir = repo()
    const body = `${'x'.repeat(1023)}\n`.repeat(17 * 1024) + 'FINAL_SENTINEL\n'
    fs.writeFileSync(join(dir, 'large-untracked.txt'), body)
    fs.writeFileSync(join(dir, 'tracked.txt'), body)
    const untracked = await changes.localDiff(dir, 'large-untracked.txt', 'unstaged')
    const tracked = await changes.localDiff(dir, 'tracked.txt', 'unstaged').then(v => ({ success: true, bytes: Buffer.byteLength(v.patch) }), e => ({ success: false, error: e.message }))
    const raw = await gitOwner.git(['diff', '--no-index', '--', '/dev/null', 'large-untracked.txt'], { cwd: dir })
    result = { fileBytes: Buffer.byteLength(body), gitMaxOutputBytes: gitOwner.GIT_MAX_OUTPUT_BYTES,
      untrackedSuccess: true, untrackedPatchBytes: Buffer.byteLength(untracked.patch), untrackedIncludesFinalLine: untracked.patch.includes('FINAL_SENTINEL'),
      rawExitCode: raw.code, rawTruncated: raw.truncated, tracked,
      expected: 'An oversized untracked patch reports the same explicit cap error as an oversized tracked patch.' }
  } else if (kind === 'markers') {
    const dir = repo(); const paths = Array.from({ length: 8 }, (_, i) => `file-${i}.txt`)
    paths.forEach(p => fs.writeFileSync(join(dir, p), 'base\n'))
    gitSetup(dir, 'add', '.'); gitSetup(dir, 'commit', '-qm', 'base files')
    const base = gitSetup(dir, 'rev-parse', 'HEAD').trim(); gitSetup(dir, 'update-ref', 'refs/remotes/origin/main', base)
    paths.forEach(p => fs.writeFileSync(join(dir, p), 'base\npull edit\n'))
    gitSetup(dir, 'add', '.'); gitSetup(dir, 'commit', '-qm', 'pull changes')
    const headSha = gitSetup(dir, 'rev-parse', 'HEAD').trim()
    paths.forEach(p => fs.appendFileSync(join(dir, p), 'local edit\n'))
    const db = { select: columns => ({ from() { return this }, where: async () => columns.id ? [{ id: 1 }] : [{ baseRef: 'main', headSha }] }) }
    const core = { identity: { active: () => 'fixture' }, tasks: { root: async () => dir, load: async () => ({ projectId: 'fixture', pullNumber: 1 }) },
      projects: { byId: async () => ({ github: { owner: 'fixture', name: 'fixture' } }) }, git: { git: gitOwner.git } }
    const { pullRequestEditorLineMarkers } = await source('plugins/github/src/server/editorLineMarkers.ts')
    const provider = pullRequestEditorLineMarkers(db, core)
    result = { files: paths.length, concurrent: await measure('eight-documents', () => Promise.all(paths.map(p => provider.read('fixture', p)))),
      immediateRepeat: await measure('repeat-one-document', () => provider.read('fixture', paths[0])) }
  } else if (kind === 'heads') {
    const path = join(fixture, 'wt'); fs.mkdirSync(path)
    const db = fakeDb([{ id: 'head-race-task', projectId: 'fixture', worktreePath: path }])
    const { onWsBroadcast } = await source('packages/node-core/src/server/transport/wsHub.ts')
    const frames = [], off = onWsBroadcast(frame => { if (frame.channel === 'head:changed') frames.push({ head: frame.head }) })
    const a = 'a'.repeat(40), b = 'b'.repeat(40)
    statusResponses = [{ head: a, delay: 0 }]
    await tasks.computeTaskStatuses(db)
    status.invalidateWorktreeStatus(path); reset()
    statusResponses = [{ head: a, delay: 150 }, { head: b, delay: 0 }]
    const old = tasks.computeTaskStatuses(db)
    while (!commands.length) await new Promise(r => setImmediate(r))
    status.invalidateWorktreeStatus(path)
    const fresh = await tasks.computeTaskStatuses(db)
    const oldResult = await old
    const repeated = await tasks.computeTaskStatuses(db)
    off()
    result = { seededHead: a, newestReadHead: fresh[0].head, delayedReadHead: oldResult[0].head,
      followingWarmHead: repeated[0].head, frames, gitCommands: commands.length,
      expected: 'Only one head:changed frame, carrying the newest head; superseded observations cannot regress the Node observer.' }
  } else if (kind === 'scans') {
    gitDelay = 150
    const rows = Array.from({ length: 16 }, (_, i) => { const path = join(fixture, `wt-${i}`); fs.mkdirSync(path); return { id: `task-${i}`, projectId: 'fixture', worktreePath: path } })
    const db = fakeDb(rows)
    status.invalidateWorktreeStatus()
    const all = await measure('one-full-sweep', async () => (await tasks.computeTaskStatuses(db)).length)
    status.invalidateWorktreeStatus()
    const same = await measure('two-full-sweeps', async () => (await Promise.all([tasks.computeTaskStatuses(db), tasks.computeTaskStatuses(db)])).map(a => a.length))
    status.invalidateWorktreeStatus()
    const disjoint = await measure('two-disjoint-authorized-sweeps', async () => (await Promise.all([
      tasks.computeTaskStatuses(db, id => Number(id.slice(5)) < 8), tasks.computeTaskStatuses(db, id => Number(id.slice(5)) >= 8),
    ])).map(a => a.length))
    result = { syntheticDelayedGit: true, rows: rows.length, all, same, disjoint }
  } else throw new Error('Unknown case.')
  const out = output
  fs.writeFileSync(out, JSON.stringify({ case: kind, node: process.version, platform: process.platform, result }, null, 2) + '\n')
  console.log(JSON.stringify({ output: out, result }, null, 2))
} finally {
  status.invalidateWorktreeStatus(); cp.spawn = originalSpawn; fsp.lstat = originalLstat; syncBuiltinESMExports()
  fs.rmSync(fixture, { recursive: true, force: true })
}
