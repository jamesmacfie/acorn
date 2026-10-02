// Run rtk proxy node --expose-gc --import tsx plans/performance/12-node-probe.mjs [search|bodies] [tag].
// Actual plugin service owners; disposable non-Git files. Tag defaults to sample, never before.
import cp from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { promisify } from 'node:util'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const kind = process.argv[2] ?? 'search', tag = process.argv[3] ?? 'sample'
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe output tag.')
const output = resolve(`plans/performance/unit17-${kind}-${tag}.json`)
if (tag.startsWith('before') && fs.existsSync(output)) throw new Error('Before evidence exists; use a new tag.')
const fixture = fs.mkdtempSync(join(tmpdir(), 'acorn-perf12-'))
const source = path => import(pathToFileURL(resolve(path)).href)
const originalExec = cp.execFile
const originalSpawn = cp.spawn
let spawned = []
const wrappedExec = (...args) => {
  const callback = args.pop()
  const record = { command: String(args[0]).split('/').at(-1), stdoutBytes: 0, errorCode: null, pid: null }
  spawned.push(record)
  const child = originalExec(...args, (error, stdout, stderr) => {
    record.stdoutBytes = Buffer.byteLength(stdout)
    record.errorCode = error?.code ?? null
    callback(error, stdout, stderr)
  })
  record.pid = child.pid
  return child
}
wrappedExec[promisify.custom] = (...args) => new Promise((resolve, reject) => wrappedExec(...args, (error, stdout, stderr) => {
  if (error) reject(error)
  else resolve({ stdout, stderr })
}))
cp.execFile = wrappedExec
cp.spawn = (...args) => {
  const child = originalSpawn(...args)
  const record = { command: String(args[0]).split('/').at(-1), stdoutBytes: 0, pid: child.pid }
  spawned.push(record)
  child.stdout?.on('data', chunk => { record.stdoutBytes += chunk.length })
  child.once('close', () => { try { process.kill(child.pid, 0); record.aliveAfterClose = true } catch { record.aliveAfterClose = false } })
  return child
}
syncBuiltinESMExports()
const heap = () => { for (let i = 0; i < 3; i++) global.gc?.(); return process.memoryUsage().heapUsed }
const measure = async (fn) => {
  spawned = []
  const before = heap(), cpu = process.cpuUsage(), start = performance.now()
  const value = await fn()
  const used = process.cpuUsage(cpu)
  return { value, nodeCpuMs: (used.user + used.system) / 1000, wallMs: performance.now() - start, heapDeltaBytes: heap() - before, spawned }
}
try {
  const core = { tasks: { root: async () => fixture }, fs: await source('packages/node-core/src/server/core/fs.ts') }
  let result
  if (kind === 'search') {
    const { searchInFiles } = await source('plugins/editor/src/server/search.ts')
    const rows = []
    for (const lines of [2_000, 8_000, 100_000]) {
      const text = ('needle ' + 'x'.repeat(200) + '\n').repeat(lines)
      fs.writeFileSync(join(fixture, 'synthetic.txt'), text)
      const measured = await measure(async () => {
        const result = await searchInFiles(core, 'synthetic-task', 'needle', { regex: false, wholeWord: false, caseSensitive: false })
        return { files: result.files.length, hits: result.files.reduce((n, f) => n + f.hits.length, 0), truncated: result.truncated, responseBytes: Buffer.byteLength(JSON.stringify(result)) }
      })
      rows.push({ lines, fileBytes: Buffer.byteLength(text), ...measured })
    }
    result = { owner: 'plugins/editor/src/server/search.ts searchInFiles', fixture: 'real bundled ripgrep on one disposable ASCII file', rows,
      expected: 'Accepted search bounds production/parse work at the response cap and surfaces overflow/invalid query errors instead of claiming no matches.' }
  } else if (kind === 'bodies') {
    const { editorBridge } = await source('plugins/editor/src/server/editor.ts')
    const bridge = editorBridge(core)
    const body = ('x'.repeat(1023) + '\n').repeat(17 * 1024) + 'FINAL_SENTINEL\n'
    fs.writeFileSync(join(fixture, 'large.txt'), body)
    fs.writeFileSync(join(fixture, 'binary.dat'), Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x41, 0x0a]))
    const large = await measure(async () => {
      const text = await bridge.read('synthetic-task', 'large.txt')
      return { characters: text.length, bodyBytes: Buffer.byteLength(text), jsonResponseBytes: Buffer.byteLength(JSON.stringify({ text })), finalSentinelPresent: text.includes('FINAL_SENTINEL') }
    })
    const binaryText = await bridge.read('synthetic-task', 'binary.dat')
    const before = [...fs.readFileSync(join(fixture, 'binary.dat'))]
    const written = await bridge.write('synthetic-task', 'binary.dat', binaryText)
    result = { owner: 'plugins/editor/src/server/editor.ts editorBridge', fixture: 'real filesystem and actual resolveInRoot; synthetic large and invalid UTF8 files',
      fileBytes: Buffer.byteLength(body), large, binary: { originalBytes: before, decodedCharacters: binaryText.length, replacementCharacters: [...binaryText].filter(c => c === '\uFFFD').length,
        writeOk: written.ok, afterBytes: [...fs.readFileSync(join(fixture, 'binary.dat'))] },
      expected: 'A safe whole-body policy refuses unsupported binary/oversized input before editable state, explicitly; supported large/dirty text is neither truncated nor discarded.' }
  } else throw new Error('Use search or bodies')
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ output, ...result }, null, 2))
} finally {
  cp.execFile = originalExec; cp.spawn = originalSpawn; syncBuiltinESMExports()
  fs.rmSync(fixture, { recursive: true, force: true })
}
