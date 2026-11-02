#!/usr/bin/env node
// The launcher is intentionally free of imports from either host. Help and commands never load the
// terminal renderer; no arguments retain the terminal client's existing attach-or-start lifetime.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const packaged = existsSync(resolve(here, '../dist/cli/cli.js'))
const cli = packaged ? resolve(here, '../dist/cli/cli.js') : resolve(here, '../dist/cli.js')
const tui = packaged ? resolve(here, '../dist/tui/main.js') : resolve(here, '../../tui/dist/main.js')
const argv = process.argv.slice(2)
const remaining = []
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === '--node' || arg === '--task') { i++; continue }
  if (arg.startsWith('--node=') || arg.startsWith('--task=')) continue
  remaining.push(arg)
}

// import() takes a URL. A Windows path such as C:\... reads as one with the scheme c:.
if (!remaining.length) await import(pathToFileURL(tui).href)
else {
  const { main } = await import(pathToFileURL(cli).href)
  process.exitCode = await main(argv)
}
