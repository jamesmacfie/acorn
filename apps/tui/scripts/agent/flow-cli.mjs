import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { requestSession } from './client.mjs'
import { manifestPath } from './state.mjs'
import { runFlow } from './flow.mjs'

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  const sessionIndex = args.indexOf('--session')
  if (sessionIndex < 0 || !args[sessionIndex + 1]) throw new Error('Usage: flow-cli.mjs --session NAME FLOW')
  const session = args[sessionIndex + 1]
  args.splice(sessionIndex, 2)
  const name = args[0]
  if (args.length !== 1 || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('Give one flow name.')
  const manifest = JSON.parse(await readFile(manifestPath(session), 'utf8'))
  if (manifest.status !== 'ready') throw new Error(`Session ${session} is not ready.`)
  const flow = JSON.parse(await readFile(join(import.meta.dirname, 'flows', `${name}.json`), 'utf8'))
  const { reportPath } = await runFlow(flow, (command, options) => requestSession(manifest, command, options), manifest.directory)
  console.log(`Flow passed. Report: ${reportPath}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
