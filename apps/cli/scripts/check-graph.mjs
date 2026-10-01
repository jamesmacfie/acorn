import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dist = resolve(import.meta.dirname, '../dist')
const chunks = join(dist, 'chunks')
const files = [join(dist, 'cli.js'), ...(existsSync(chunks) ? readdirSync(chunks).map((name) => join(chunks, name)) : [])]
const source = files.map((file) => readFileSync(file, 'utf8')).join('\n')
const forbidden = [
  /from\s*['"]solid-js/, /from\s*['"]@acorn\/client-core/, /from\s*['"]@acorn\/plugin-/,
  /(?:from|import\s*\()\s*['"]@acorn\/tui/, /openTerminalRenderer/, /switchToRawMode/,
]
for (const pattern of forbidden) if (pattern.test(source)) throw new Error(`CLI bundle includes a renderer or client plugin edge: ${pattern}`)
