#!/usr/bin/env node
// Reproducible answer to the editor extraction question in docs/first-party-plugins.md. This builds
// the current pane as one browser file with the same dependency-inlining rule as a loaded frame.
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'
import solid from 'vite-plugin-solid'

const nodeApp = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const editorPane = resolve(nodeApp, '../../plugins/editor/src/client/EditorPane.tsx')
const scratch = mkdtempSync(join(tmpdir(), 'acorn-editor-bundle-'))
const output = join(scratch, 'dist')
const entry = 'virtual:acorn-editor-measure'
const virtualEntry = {
  name: 'acorn-editor-measure-entry',
  resolveId(id) {
    if (id === entry) return `\0${entry}`
  },
  load(id) {
    if (id === `\0${entry}`) return `export { default as EditorPane } from ${JSON.stringify(editorPane)}\n`
  },
}

try {
  await build({
    configFile: false,
    root: nodeApp,
    logLevel: 'warn',
    plugins: [virtualEntry, solid()],
    build: {
      target: 'es2022',
      outDir: output,
      minify: false,
      emptyOutDir: true,
      reportCompressedSize: false,
      rollupOptions: {
        input: entry,
        output: {
          format: 'es',
          entryFileNames: 'editor.js',
          codeSplitting: false,
        },
      },
    },
  })
  const file = join(output, 'editor.js')
  const bytes = statSync(file).size
  const gzipBytes = gzipSync(readFileSync(file)).byteLength
  console.log(`EditorPane standalone bundle: ${bytes.toLocaleString('en')} bytes raw; ${gzipBytes.toLocaleString('en')} bytes gzip`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
