import { existsSync, writeFileSync } from 'node:fs'
import { getDockerService, disposeDocker } from '../../plugins/docker/src/server/dockerService.ts'

const tag = process.argv[2] ?? 'sample'
const destination = new URL(`13-docker-spawn-${tag}.json`, import.meta.url)
if (tag.startsWith('before') && existsSync(destination)) throw new Error('Use another before tag.')
const originalPath = process.env.PATH
// Isolated process environment only. The command cannot resolve a Docker binary, so it cannot
// touch a daemon. This exercises actual ChildProcess error/close event ordering.
process.env.PATH = '/synthetic/empty-path'
const service = getDockerService()
const handles = []
let errors = 0, closes = 0, exits = 0, ends = 0
try {
  for (let index = 0; index < 32; index++) {
    handles.push(service.openStream('logs', `synthetic-${index}`, () => {}, () => { ends++ }))
    const child = [...service.streams].at(-1)
    child.once('error', () => { errors++ })
    child.once('close', () => { closes++ })
    child.once('exit', () => { exits++ })
  }
  await new Promise(resolve => setTimeout(resolve, 100))
  const beforeCap = { errors, closes, exits, ends, trackedFailedChildren: service.streams.size }
  handles.push(service.openStream('logs', 'synthetic-33', () => {}, () => { ends++ }))
  await Promise.resolve()
  const output = { runtime: process.version, owner: 'actual DockerService with real ChildProcess spawn ENOENT; no daemon',
    attemptedStreams: 32, beforeCap, endsAfter33rdAttach: ends, trackedAfter33rdAttach: service.streams.size }
  writeFileSync(destination, JSON.stringify(output, null, 2) + '\n')
  console.log(JSON.stringify(output, null, 2))
} finally {
  for (const handle of handles) handle.stop()
  disposeDocker()
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
}
