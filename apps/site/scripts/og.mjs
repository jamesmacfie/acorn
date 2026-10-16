// Draws the social cards (docs/site/agent-outputs.md § Social cards): starts `astro dev`, screenshots
// /lab/og/<card>/ for each card in src/og.ts at 1200 by 630 in the installed Chrome, and writes
// public/og/<card>.png. A maintainer runs it after a page's headline or a sidebar group's title
// changes, and commits the pictures. The site's build never runs a browser.
//
//   pnpm --filter @acorn/site og              every card
//   pnpm --filter @acorn/site og home docs-agents
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { CARDS } from '../src/og.ts'

const SITE = new URL('../', import.meta.url)
const OUT = new URL('../public/og/', import.meta.url)
const PORT = 4331
const BASE = `http://127.0.0.1:${PORT}`

const names = process.argv.slice(2)
const unknown = names.filter((name) => !(name in CARDS))
if (unknown.length > 0) throw new Error(`No card named ${unknown.join(', ')}. The cards are in src/og.ts.`)

// `--ignore-lock` keeps the server in the foreground, as the Playwright config explains.
const server = spawn('pnpm', ['exec', 'astro', 'dev', '--ignore-lock', '--host', '127.0.0.1', '--port', String(PORT)], {
  cwd: fileURLToPath(SITE),
  stdio: ['ignore', 'inherit', 'inherit'],
})

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error('astro dev exited before it answered.')
    try {
      if ((await fetch(`${BASE}/lab/`)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('astro dev did not answer within a minute.')
}

try {
  await waitForServer()
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome' })
  // A new browser in light mode has no choice saved, so the cards draw in the site's light theme.
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: 'light' })
  for (const name of names.length > 0 ? names : Object.keys(CARDS)) {
    await page.goto(`${BASE}/lab/og/${name}/`, { waitUntil: 'networkidle' })
    // The dev server's toolbar floats over the bottom of the page.
    await page.evaluate(() => document.querySelector('astro-dev-toolbar')?.remove())
    await page.evaluate(() => document.fonts.ready)
    await page.locator('.social-card').screenshot({ path: fileURLToPath(new URL(`${name}.png`, OUT)) })
    console.log(`public/og/${name}.png`)
  }
  await browser.close()
} finally {
  server.kill()
}
