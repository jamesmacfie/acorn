#!/usr/bin/env node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { build } from 'vite'

const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--why' || !args[1])) {
  throw new Error('Usage: pnpm --filter @acorn/node measure:service-graph [--why <path fragment>]')
}
const nodeApp = resolve(import.meta.dirname, '..')
const workspace = resolve(nodeApp, '../..')
const entry = resolve(nodeApp, 'src/entries/service.ts')
const scratch = mkdtempSync(join(tmpdir(), 'acorn-service-graph-'))
const chunks = new Map()
const modules = new Map()
const display = id => id.startsWith(`${workspace}/`) ? relative(workspace, id) : id
const bytes = value => `${value.toLocaleString('en')} B`

try {
  await build({
    configFile: join(nodeApp, 'vite.config.ts'),
    root: nodeApp,
    logLevel: 'warn',
    build: { outDir: join(scratch, 'dist') },
    plugins: [{
      name: 'measure-service-graph',
      generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue
          chunks.set(chunk.fileName, {
            modules: Object.entries(chunk.modules).map(([id, module]) => ({ id, renderedLength: module.renderedLength })),
            imports: chunk.imports,
            bytes: Buffer.byteLength(chunk.code),
            entry: chunk.facadeModuleId,
          })
        }
        for (const id of this.getModuleIds()) {
          const info = this.getModuleInfo(id)
          if (info) modules.set(id, { importedIds: info.importedIds, dynamicallyImportedIds: info.dynamicallyImportedIds })
        }
      },
    }],
  })

  // Breadth-first traversal records the shortest static chain even when a module has many callers.
  const parents = new Map([[entry, null]])
  const queue = [entry]
  if (!modules.has(entry)) throw new Error(`The build did not include ${entry}`)
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]
    for (const imported of modules.get(id)?.importedIds ?? []) {
      if (parents.has(imported)) continue
      parents.set(imported, id)
      queue.push(imported)
    }
  }

  const serviceChunk = [...chunks.keys()].find(name => chunks.get(name).entry === entry)
  if (!serviceChunk) throw new Error('The build did not emit the service entry chunk')
  const staticChunks = new Set([serviceChunk])
  for (const name of staticChunks) {
    for (const imported of chunks.get(name).imports) {
      if (chunks.has(imported)) staticChunks.add(imported)
    }
  }
  const lengths = new Map()
  for (const name of staticChunks) {
    for (const { id, renderedLength } of chunks.get(name).modules) {
      if (parents.has(id)) lengths.set(id, (lengths.get(id) ?? 0) + renderedLength)
    }
  }
  const total = [...lengths.values()].reduce((sum, size) => sum + size, 0)
  const emitted = [...staticChunks].reduce((sum, name) => sum + chunks.get(name).bytes, 0)
  console.log(`Service static modules: ${bytes(total)} in ${lengths.size} modules`)
  console.log(`Service static chunks: ${bytes(emitted)} in ${staticChunks.size} chunks (includes imports and chunk glue)`)

  const packages = new Map()
  const folders = new Map()
  const add = (groups, key, size) => groups.set(key, (groups.get(key) ?? 0) + size)
  for (const [id, size] of lengths) {
    const vendor = id.lastIndexOf('/node_modules/')
    if (vendor !== -1) {
      const parts = id.slice(vendor + '/node_modules/'.length).split('/')
      add(packages, parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0], size)
    } else {
      const path = display(id)
      add(folders, /^(apps|packages|plugins)\//.test(path) ? path.split('/').slice(0, 2).join('/') : '(build helpers)', size)
    }
  }
  const descending = entries => [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const print = (title, entries) => {
    console.log(`\n${title}`)
    for (const [name, size] of entries) console.log(`${bytes(size).padStart(13)}  ${display(name)}`)
  }
  print('By npm package', descending(packages))
  print('By workspace folder', descending(folders))
  print('50 largest modules', descending(lengths).slice(0, 50))

  if (args[0] === '--why') {
    const fragment = args[1]
    const target = queue.find(id => id.includes(fragment))
    console.log(`\nStatic import chain for ${JSON.stringify(fragment)}`)
    if (target) {
      const chain = []
      for (let id = target; id !== null; id = parents.get(id)) chain.push(id)
      console.log(chain.reverse().map((id, index) => `${index ? '  -> ' : ''}${display(id)}`).join('\n'))
    } else {
      const matches = [...modules.keys()].filter(id => id.includes(fragment))
      console.log(matches.length ? 'Not statically reachable from service.ts:' : 'No matching module in the build:')
      for (const id of matches) console.log(`  ${display(id)}`)
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
