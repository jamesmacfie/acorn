#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { SourceMap } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'

// Maps the frames of a stack from a packaged, minified build back to source, using the hidden source
// maps a build of the same commit writes (docs/local-development/packaged-stacks.md § Find the source line).
//
//   pnpm --filter @acorn/node locate-stack [--dist <built dist>] < stack.txt
//
// A frame's file is found in the build by its trailing path, so `…/Resources/helper/chunks/crash-AbC.js`
// matches `<dist>/chunks/crash-AbC.js.map`. Chunk names carry a content hash: a frame whose file the
// build lacks came from different code, and it is reported as unmatched rather than guessed at.

const args = process.argv.slice(2)
const distFlag = args.indexOf('--dist')
const dist = resolve(distFlag === -1 ? resolve(import.meta.dirname, '../dist') : args[distFlag + 1])
const repo = resolve(import.meta.dirname, '../../..')
const maps = new Map()

const mapFor = (file) => {
  const parts = file.replace(/^file:\/\//, '').split(/[\\/]/)
  for (let start = 0; start < parts.length; start++) {
    const path = join(dist, ...parts.slice(start)) + '.map'
    if (!existsSync(path)) continue
    if (!maps.has(path)) maps.set(path, { map: new SourceMap(JSON.parse(readFileSync(path, 'utf8'))), dir: dirname(path) })
    return maps.get(path)
  }
  return null
}

// Every frame on a line, because the crash log writes a whole stack on one line.
const FRAME = /((?:file:\/\/)?[^\s()]+?\.[cm]?js):(\d+):(\d+)/g
let unmatched = 0
const locate = (frame, file, line, column) => {
  const found = mapFor(file)
  if (!found) {
    unmatched += 1
    return `${frame} [no map in this build]`
  }
  const origin = found.map.findOrigin(Number(line), Number(column))
  if (!origin.fileName) return `${frame} [no source at that position]`
  const source = relative(repo, resolve(found.dir, origin.fileName))
  return `${frame} [${source}:${origin.lineNumber}:${origin.columnNumber}${origin.name ? ` ${origin.name}` : ''}]`
}
for (const line of readFileSync(0, 'utf8').split('\n')) console.log(line.replace(FRAME, locate))
if (unmatched) console.error(`[locate-stack] ${unmatched} frame(s) had no map in ${dist}. Build the commit the stack came from.`)
