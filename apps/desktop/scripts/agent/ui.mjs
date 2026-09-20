import { join } from 'node:path'
import { renderPlace, renderSnapshot, WebDriverClient } from './webdriver.mjs'
import { readJson, refsPath, resolveManifest, writePrivateJson } from './state.mjs'

function parseArgs(argv) {
  let session = null
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--') continue
    if (argv[index] === '--session') session = argv[++index] ?? ''
    else rest.push(argv[index])
  }
  const [command, ...args] = rest
  if (!command) throw new Error('Usage: pnpm dev:agent:ui -- [--session NAME] snapshot|click|fill|scroll|screenshot|status|stop')
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

async function main() {
  const { session, command, args } = parseArgs(process.argv.slice(2))
  const manifest = await resolveManifest(session)

  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
    return
  }
  if (command === 'stop') {
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
  if (command === 'screenshot') {
    if (args.length > 1) throw new Error('Usage: screenshot [FILE_NAME]')
    const file = args[0] || `screenshot-${Date.now()}.png`
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/.test(file)) {
      throw new Error('Screenshot names must be simple .png file names.')
    }
    console.log(await client.screenshot(join(manifest.directory, 'screenshots', file)))
    return
  }
  throw new Error(`Unknown command: ${command}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
