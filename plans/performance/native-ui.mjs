// Bounded main-renderer driver for the explicitly owned performance automation bundle.
import { resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { PerformanceDriver } from './native-driver.mjs'
import { resolveManifest, refsPath, writePrivateJson } from '../../apps/desktop/scripts/agent/state.mjs'
import { renderSnapshot } from '../../apps/desktop/scripts/agent/webdriver.mjs'

const [name, command, ...args] = process.argv.slice(2)
if (!name?.startsWith('perf-focus-')) throw new Error('Use an isolated perf-focus- session.')
const manifest = await resolveManifest(name)
if (!manifest.executable?.includes('/Acorn Performance Automation.app/Contents/MacOS/')) {
  throw new Error('The session is not the performance automation bundle.')
}
const driver = new PerformanceDriver(manifest.webdriverEndpoint, manifest.webdriverSessionId)
const evidenceRoot = resolve('plans/performance/evidence')
const evidencePath = (file) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(json|png)$/.test(file ?? '')) throw new Error('Use a simple evidence filename.')
  return resolve(evidenceRoot, file)
}
if (command === 'snapshot') {
  const snapshot = await driver.snapshot()
  await writePrivateJson(refsPath(name), { webdriverSessionId: driver.sessionId, refs: snapshot.elements.map(element => element.ref) })
  if (args[0]) await writeFile(evidencePath(args[0]), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' })
  console.log(renderSnapshot(snapshot))
} else if (command === 'click' || command === 'fill') {
  const saved = JSON.parse(await readFile(refsPath(name), 'utf8'))
  if (saved.webdriverSessionId !== driver.sessionId || !saved.refs?.includes(args[0])) throw new Error('Take a fresh snapshot before using a reference.')
  const element = await driver.resolveElement(args[0])
  if (command === 'click') await driver.click(element)
  else {
    if (args.length < 2) throw new Error('Supply the text to fill.')
    await driver.fill(element, args.slice(1).join(' '))
  }
  console.log(`${command} ${args[0]} completed`)
} else if (command === 'screenshot') {
  console.log(await driver.screenshot(evidencePath(args[0])))
} else {
  throw new Error('Use snapshot, click, fill or screenshot.')
}
