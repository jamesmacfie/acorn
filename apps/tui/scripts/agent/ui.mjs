import { requestSession } from './client.mjs'
import { resolveManifest } from './state.mjs'

function parseArgs(argv) {
  let session = null
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--') continue
    if (argv[index] === '--session') session = argv[++index] ?? ''
    else rest.push(argv[index])
  }
  const [command, ...args] = rest
  if (!command) throw new Error('Usage: agent:ui -- [--session NAME] status|snapshot|press KEY|type TEXT|paste TEXT|resize COLS ROWS|stop')
  return { session, command, args }
}

async function main() {
  const { session, command, args } = parseArgs(process.argv.slice(2))
  const manifest = await resolveManifest(session)
  let payload = {}
  if (command === 'press') {
    if (args.length !== 1) throw new Error('Usage: press KEY')
    payload = { key: args[0] }
  } else if (command === 'type' || command === 'paste') {
    if (!args.length) throw new Error(`Usage: ${command} TEXT`)
    payload = { text: args.join(' ') }
  } else if (command === 'resize') {
    if (args.length !== 2) throw new Error('Usage: resize COLS ROWS')
    payload = { cols: Number(args[0]), rows: Number(args[1]) }
  } else if (args.length || !['status', 'snapshot', 'stop'].includes(command)) {
    throw new Error(`Unknown command or extra arguments: ${command}`)
  }
  const result = await requestSession(manifest, command, payload)
  if (command === 'snapshot') process.stdout.write(`${result.text}\n`)
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
