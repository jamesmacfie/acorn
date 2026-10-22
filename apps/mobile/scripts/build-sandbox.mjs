import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sandboxHeaders } from '../sandbox/headers.mts'

// The folder the sandbox domain serves: the relay page and its script, and the headers to send with every
// response (docs/mobile/phone-setup.md § Serve the sandbox domain). It holds no bundles, because the phone
// app posts the bytes to the page.
const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'dist-sandbox')

rmSync(out, { recursive: true, force: true })
mkdirSync(out)
for (const file of ['worker.html', 'worker-host.js']) copyFileSync(resolve(root, 'sandbox', file), resolve(out, file))
writeFileSync(resolve(out, 'headers.json'), `${JSON.stringify(sandboxHeaders, null, 2)}\n`)
