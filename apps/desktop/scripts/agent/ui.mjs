import { cp, readFile, rename, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { parseFlow, runFlow, summarizeReport } from './flow.mjs'
import { renderPlace, renderSnapshot, WebDriverClient } from './webdriver.mjs'
import { activeManifests, desktopRoot, readJson, refsPath, resolveManifest, writePrivateJson } from './state.mjs'
import { nativeTarget, requireSessionApp } from './nativeApp.mjs'
import { createReplayState } from './replay-state.mjs'
import { createResourceSampler, setReplayWindowState } from './replay-resources.mjs'
import { startLoad, takeLoadFlag } from './replay-load.mjs'

// Each replay fixture: the generated reply it streams, and the flow in ./flows that plays it.
const REPLAYS = {
  prose: { reply: 'prose', flow: 'streaming-replay' },
  code: { reply: 'code', flow: 'streaming-replay' },
  tools: { reply: 'tools', flow: 'streaming-replay' },
  agents: { reply: 'prose', flow: 'streaming-replay-agents' },
}
const REPLAY_NAMES = Object.keys(REPLAYS).join('|')

function parseArgs(argv) {
  let session = null
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--') continue
    if (argv[index] === '--session') session = argv[++index] ?? ''
    else rest.push(argv[index])
  }
  const [command, ...args] = rest
  if (!command) throw new Error('Usage: pnpm dev:agent:ui -- [--session NAME] snapshot|click|fill|scroll|screenshot|link|run|flow|replay|replay-ab|status|target|stop')
  return { session, command, args }
}

async function refFor(manifest, ref) {
  const saved = await readJson(refsPath(manifest.name)).catch(() => null)
  if (!saved || saved.webdriverSessionId !== manifest.webdriverSessionId) {
    throw new Error('No current element references. Run snapshot first.')
  }
  if (!saved.refs?.includes(ref)) throw new Error(`Unknown element reference: ${ref}. Run snapshot again.`)
  return ref
}

async function replayReport(client, manifest, name, load) {
  const flow = parseFlow(await readFile(join(import.meta.dirname, 'flows', `${REPLAYS[name].flow}.json`), 'utf8'))
  const sampler = await createResourceSampler(client, manifest.appPid)
  const described = { name, seed: manifest.fixture.seed, telemetry: manifest.fixture.telemetry ?? 'off', load }
  let state = null
  let originalSize = null
  let busy = null
  try {
    state = createReplayState(manifest.dataDir)
    originalSize = await client.environment()
    busy = startLoad(load)
    const report = await runFlow(client, flow, {
      fixture: manifest.fixture,
      replay: { name: REPLAYS[name].reply, seed: manifest.fixture.seed, state },
      sampler,
      windowState: (state) => setReplayWindowState(client, manifest.nativeApp.appPath, state),
      log: (line) => console.log(line),
    })
    report.replay = described
    return report
  } catch (error) {
    if (error.flowReport) error.flowReport.replay = described
    throw error
  } finally {
    await busy?.stop()
    if (originalSize) {
      await setReplayWindowState(client, manifest.nativeApp.appPath, 'focused').catch(() => {})
      await client.setWindowSize(originalSize.width, originalSize.height).catch(() => {})
    }
    state?.close()
    await sampler.close()
  }
}

async function saveReplayReport(manifest, report, suffix = '') {
  const stamp = report.startedAt.replace(/[:.]/g, '-')
  const base = join(manifest.directory, 'reports', `streaming-replay-${report.replay.name}${suffix}-${stamp}`)
  await writePrivateJson(`${base}.json`, report)
  console.log(summarizeReport(report))
  console.log(`Report: ${base}.json`)
  if (report.failed) process.exitCode = 1
}

async function stageRenderer(source, destination) {
  if (resolve(source) === resolve(destination)) throw new Error('The staged build cannot be the active renderer directory.')
  if (!isAbsolute(source) || !(await stat(join(source, 'index.html')).catch(() => null))?.isFile()) {
    throw new Error(`Renderer build must be an absolute directory containing index.html: ${source}`)
  }
  const staged = `${destination}.replay-staging`
  await rm(staged, { recursive: true, force: true })
  await cp(source, staged, { recursive: true })
  await rm(destination, { recursive: true, force: true })
  await rename(staged, destination)
}

async function main() {
  const { session, command, args } = parseArgs(process.argv.slice(2))
  const manifest = await resolveManifest(session)

  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
    return
  }
  // The window to hand a native tool such as Computer Use, checked live: this session's own process,
  // its app path, and any other running session that shares the identity (./nativeApp.mjs).
  if (command === 'target') {
    process.stdout.write(`${JSON.stringify(await nativeTarget(manifest, await activeManifests()), null, 2)}\n`)
    return
  }
  if (command === 'stop') {
    // Checked first, so a recorded PID that now belongs to something else is never signalled.
    await requireSessionApp(manifest)
    process.kill(manifest.appPid, 'SIGTERM')
    console.log(`Stopping agent session ${manifest.name}.`)
    return
  }

  const client = new WebDriverClient(manifest.webdriverEndpoint, manifest.webdriverSessionId)
  if (command === 'snapshot') {
    const snapshot = await client.snapshot()
    const refs = snapshot.elements.map((element) => element.ref)
    await writePrivateJson(refsPath(manifest.name), { webdriverSessionId: manifest.webdriverSessionId, refs })
    process.stdout.write(`${renderSnapshot(snapshot)}\n`)
    return
  }
  if (command === 'click') {
    if (args.length !== 1) throw new Error('Usage: click REF')
    await client.click(await client.resolveElement(await refFor(manifest, args[0])))
    console.log(`Clicked ${args[0]}.`)
    return
  }
  if (command === 'link') {
    if (args.length !== 1) throw new Error('Usage: link acorn://<node>/<place>')
    const result = await client.link(args[0])
    console.log(result?.kind === 'opened' ? `Opened ${args[0]}.` : `Refused ${args[0]}: ${result?.reason ?? 'unknown reason'}`)
    return
  }
  if (command === 'fill') {
    if (args.length < 2) throw new Error('Usage: fill REF TEXT')
    await client.fill(await client.resolveElement(await refFor(manifest, args[0])), args.slice(1).join(' '))
    console.log(`Filled ${args[0]}.`)
    return
  }
  // Where the reader is, and how to move them. `scroll` with no delta only looks, which is what a
  // check across a navigation wants: note the turn, go away, come back, ask again. Compare the turn
  // rather than the offset, because the offset is meaningless once the content above it has resized.
  if (command === 'scroll') {
    if (args.length > 1) throw new Error('Usage: scroll [DELTA]')
    const delta = args[0] === undefined ? 0 : Number(args[0])
    if (!Number.isFinite(delta)) throw new Error('Usage: scroll [DELTA]')
    const place = await client.scroll(delta)
    if (!place) throw new Error('Nothing on this page scrolls.')
    process.stdout.write(`${renderPlace(place)}\n`)
    return
  }
  // A script body from a file, or from stdin with no file, run in the window as a function. Its return
  // value, awaited, prints as JSON. For a check the other verbs can't make, such as reading the DOM.
  if (command === 'run') {
    if (args.length > 1) throw new Error('Usage: run [SCRIPT_FILE], or the script on stdin')
    const script = args[0] ? await readFile(args[0], 'utf8') : await new Response(process.stdin).text()
    process.stdout.write(`${JSON.stringify(await client.execute(script))}\n`)
    return
  }
  if (command === 'screenshot') {
    if (args.length > 1) throw new Error('Usage: screenshot [FILE_NAME]')
    const file = args[0] || `screenshot-${Date.now()}.png`
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/.test(file)) {
      throw new Error('Screenshot names must be simple .png file names.')
    }
    console.log(await client.screenshot(join(manifest.directory, 'screenshots', file)))
    return
  }
  // A declarative flow from ./flows, run against this session's window, with a dated report written
  // beside the session's screenshots (docs/local-development/agent-drivers.md § Large-surface flow). A failed
  // invariant fails the command after the whole flow has run and the report is on disk.
  if (command === 'flow') {
    if (args.length !== 1 || !/^[a-z0-9-]+$/.test(args[0])) throw new Error('Usage: flow NAME (a file in scripts/agent/flows)')
    const flow = parseFlow(await readFile(join(import.meta.dirname, 'flows', `${args[0]}.json`), 'utf8'))
    const report = await runFlow(client, flow, { fixture: manifest.fixture ?? null, log: (line) => console.log(line) })
    const stamp = report.startedAt.replace(/[:.]/g, '-')
    const base = join(manifest.directory, 'reports', `${flow.name}-${manifest.fixture?.profile ?? 'none'}-${stamp}`)
    await writePrivateJson(`${base}.json`, report)
    console.log(summarizeReport(report))
    console.log(`Report: ${base}.json`)
    if (report.failed) process.exitCode = 1
    return
  }
  if (command === 'replay') {
    if (manifest.fixture?.name !== 'streaming-replay') throw new Error('Start the session with --fixture streaming-replay.')
    const { args: names, load } = takeLoadFlag(args)
    if (names.length !== 1 || !Object.hasOwn(REPLAYS, names[0])) throw new Error(`Usage: replay ${REPLAY_NAMES} [--load [N]]`)
    try {
      await saveReplayReport(manifest, await replayReport(client, manifest, names[0], load))
    } catch (error) {
      if (error.flowReport) await saveReplayReport(manifest, error.flowReport)
      throw error
    }
    return
  }
  if (command === 'replay-ab') {
    if (manifest.fixture?.name !== 'streaming-replay') throw new Error('Start the session with --fixture streaming-replay.')
    const { args: pairs, load } = takeLoadFlag(args)
    const flags = Object.fromEntries(pairs.reduce((entries, value, index) => {
      if (index % 2 === 0) entries.push([value, pairs[index + 1]])
      return entries
    }, []))
    if (pairs.length !== 6 || !Object.hasOwn(REPLAYS, flags['--fixture'] ?? '')) {
      throw new Error(`Usage: replay-ab --base ABSOLUTE_DIR --candidate ABSOLUTE_DIR --fixture ${REPLAY_NAMES} [--load [N]]`)
    }
    const destination = join(desktopRoot, 'dist', 'client')
    const backup = join(manifest.directory, 'renderer-before-replay-ab')
    await cp(destination, backup, { recursive: true })
    const runs = []
    try {
      for (const [index, label] of ['base', 'candidate', 'candidate', 'base'].entries()) {
        await stageRenderer(flags[`--${label}`], destination)
        await client.refresh()
        const report = await replayReport(client, manifest, flags['--fixture'], load)
        report.build = label
        runs.push(report)
        await saveReplayReport(manifest, report, `-${label}-${index + 1}`)
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const path = join(manifest.directory, 'reports', `streaming-replay-ab-${stamp}.json`)
      const spread = Object.fromEntries(['base', 'candidate'].map((label) => {
        const cpu = runs.filter((report) => report.build === label)
          .map((report) => report.stages.find((stage) => stage.name === 'streaming')?.measurement?.processes?.renderer?.cpuMs)
        const percent = cpu.every((value) => typeof value === 'number') && cpu[0] + cpu[1] > 0
          ? Math.abs(cpu[0] - cpu[1]) / ((cpu[0] + cpu[1]) / 2) * 100
          : null
        return [label, { rendererCpuMs: cpu, percent }]
      }))
      const noisy = Object.entries(spread).filter(([, value]) => value.percent === null || value.percent > 10)
      await writePrivateJson(path, { order: ['base', 'candidate', 'candidate', 'base'], spread, noisy: noisy.map(([label]) => label), runs })
      console.log(`A/B report: ${path}`)
      if (noisy.length) {
        console.error(`Streaming renderer CPU spread exceeds 10% or is missing for ${noisy.map(([label]) => label).join(', ')}. Find the noise source before using this comparison.`)
        process.exitCode = 1
      }
    } finally {
      await stageRenderer(backup, destination)
      await rm(backup, { recursive: true, force: true })
      await client.refresh().catch(() => {})
    }
    return
  }
  throw new Error(`Unknown command: ${command}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
