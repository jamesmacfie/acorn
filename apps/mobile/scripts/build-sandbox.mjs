import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readFrameStyles } from '@acorn/client-core/infra/styles/frameStyles.mts'
import { headerRules } from '../sandbox/headers.mts'

// The folder the sandbox domain serves: the relay page and the frame page with their scripts, the frame's
// stylesheet, and the headers to send (docs/mobile/phone-setup.md § Serve the sandbox domain). It holds no bundles,
// because the phone app posts the bytes to the page.
const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'dist-sandbox')

rmSync(out, { recursive: true, force: true })
mkdirSync(out)
for (const file of ['bundle-check.js', 'worker.html', 'worker-host.js', 'frame.html', 'frame-host.js'])
  copyFileSync(resolve(root, 'sandbox', file), resolve(out, file))
writeFileSync(resolve(out, 'ui.css'), readFrameStyles())
writeFileSync(resolve(out, 'headers.json'), `${JSON.stringify(headerRules, null, 2)}\n`)
