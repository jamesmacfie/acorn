import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { loadavg, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

function descendants(rows, parent) {
  return rows.filter((row) => row.parent === parent)
}

export function replayProcessIds(rows, shellPid, rendererPid) {
  const helper = descendants(rows, shellPid).find((row) => row.command.includes('node'))
  const node = helper && descendants(rows, helper.pid).find((row) => row.command.includes('node'))
  if (!helper || !node || !rendererPid) {
    throw new Error(`Could not identify renderer, helper, and Node below shell ${shellPid}.`)
  }
  return { renderer: rendererPid, shell: shellPid, helper: helper.pid, node: node.pid }
}

async function processIds(client, shellPid) {
  const diagnostics = await client.rendererProcesses()
  if (!Array.isArray(diagnostics)) throw new Error(`Webview diagnostics failed: ${JSON.stringify(diagnostics)}`)
  const rendererPid = diagnostics.find((entry) => entry.key === 'main')?.processId
  const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,comm='])
  const rows = stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }] : []
  })
  return replayProcessIds(rows, shellPid, rendererPid)
}

export async function createResourceSampler(client, shellPid) {
  if (process.platform !== 'darwin') throw new Error('Streaming replay process sampling requires macOS.')
  const directory = await mkdtemp(join(tmpdir(), 'acorn-replay-stat-'))
  const executable = join(directory, 'resource-stat')
  let ids
  try {
    await run('clang', ['-O2', '-o', executable, join(import.meta.dirname, 'macos-resource-stat.c')])
    ids = await processIds(client, shellPid)
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  let interval = null
  let pending = new Set()
  let sampleError = null

  async function sample() {
    const { stdout } = await run(executable, Object.values(ids).map(String))
    return { at: Date.now(), values: JSON.parse(stdout) }
  }

  return {
    ids,
    async start(phase) {
      if (interval) throw new Error('A resource phase is already running.')
      sampleError = null
      await client.telemetryPhase('start')
      const samples = [await sample()]
      interval = setInterval(() => {
        const next = sample().then((value) => samples.push(value)).catch((error) => { sampleError = error })
        pending.add(next)
        void next.finally(() => pending.delete(next))
      }, 200)
      return async () => {
        clearInterval(interval)
        interval = null
        await Promise.all(pending)
        if (sampleError) throw sampleError
        samples.push(await sample())
        const telemetry = await client.telemetryPhase('stop')
        const first = samples[0]
        const last = samples.at(-1)
        const elapsedMs = last.at - first.at
        const processes = Object.fromEntries(Object.entries(ids).map(([name, pid]) => {
          const values = samples.map((entry) => entry.values[pid]).filter(Boolean)
          const start = values[0]
          const end = values.at(-1)
          return [name, {
            pid,
            cpuMs: start && end ? (end.cpuNs - start.cpuNs) / 1e6 : null,
            cpuPercent: start && end && elapsedMs ? (end.cpuNs - start.cpuNs) / 1e6 / elapsedMs * 100 : null,
            physicalBytes: values.length ? Math.round(values.reduce((sum, value) => sum + value.physicalBytes, 0) / values.length) : null,
            wakeups: start && end ? end.wakeups - start.wakeups : null,
          }]
        }))
        return { phase, elapsedMs, samples: samples.length, loadAverage: loadavg()[0], processes, telemetry }
      }
    },
    close: async () => {
      if (interval) {
        clearInterval(interval)
        await Promise.all(pending)
        await client.telemetryPhase('stop').catch(() => {})
      }
      await rm(directory, { recursive: true, force: true })
    },
  }
}

export async function setReplayWindowState(client, appPath, state) {
  if (state === 'blurred') {
    await run('open', ['-a', 'Finder'])
  } else if (state === 'hidden') {
    await client.minimize()
  } else if (state === 'focused') {
    await client.maximize()
    await run('open', ['-a', appPath])
  } else {
    throw new Error(`Unknown replay window state: ${state}`)
  }
  const deadline = Date.now() + 5_000
  let environment
  do {
    environment = await client.environment()
    if (state === 'blurred' && environment.visibility === 'visible' && !environment.focused) return environment
    if (state === 'hidden' && environment.visibility === 'hidden') return environment
    if (state === 'focused' && environment.visibility === 'visible' && environment.focused) return environment
    await new Promise((resolve) => setTimeout(resolve, 100))
  } while (Date.now() < deadline)
  throw new Error(`The window did not become ${state}: ${JSON.stringify(environment)}.`)
}
