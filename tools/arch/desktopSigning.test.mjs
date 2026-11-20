// Only a tag's protected signing job holds the updater key, and it runs no repository code
// (docs/shell/packaging.md § CI permissions and signing credentials).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const text = (path) => readFileSync(new URL(path, root), 'utf8')
const SECRET = /TAURI_SIGNING_PRIVATE_KEY/

// Each top-level job's text, keyed by its id. The workflow indents jobs by two spaces.
function jobs(workflow) {
  const body = workflow.slice(workflow.indexOf('\njobs:\n'))
  const parts = body.split(/^ {2}([a-z][\w-]*):\n/m).slice(1)
  return Object.fromEntries(parts.flatMap((part, i) => (i % 2 === 0 ? [[part, parts[i + 1]]] : [])))
}

describe('the updater signing key', () => {
  const ci = jobs(text('.github/workflows/ci.yml'))

  it('never reaches the desktop build, which runs repository code', () => {
    expect(text('.github/workflows/build-desktop.yml')).not.toMatch(SECRET)
    expect(ci.package).not.toMatch(SECRET)
  })

  it('reaches one job, which runs for a tag in the release environment', () => {
    expect(Object.keys(ci).filter((id) => SECRET.test(ci[id]))).toEqual(['sign-desktop'])
    expect(ci['sign-desktop']).toContain("    if: startsWith(github.ref, 'refs/tags/v')\n")
    expect(ci['sign-desktop']).toContain('    environment: release\n')
    expect(ci['publish-desktop']).toContain('    needs: sign-desktop\n')
  })

  it('is used by a job that checks out only data and runs no repository code', () => {
    const job = ci['sign-desktop']
    const sparse = job.match(/sparse-checkout: \|\n((?: {12}\S.*\n)+)/)?.[1].trim().split(/\s+/)
    expect(sparse).toEqual(['apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json'])
    expect(job).toContain('sparse-checkout-cone-mode: false')
    // Comments and echoed messages may name repository commands. Nothing else in the job may.
    const commands = job.replace(/^\s*#.*$/gm, '').replace(/echo "[^"]*"/g, '')
    expect(commands).not.toMatch(/\bpnpm\b|\bnode\b|\.\/|\.(?:mjs|js|ts|sh)\b/)
  })

  it('signs with the Tauri CLI version the workspace locks', () => {
    const locked = new Set([...text('pnpm-lock.yaml').matchAll(/'@tauri-apps\/cli@(\d+\.\d+\.\d+)':/g)].map((match) => match[1]))
    expect(locked.size).toBe(1)
    expect(ci['sign-desktop']).toContain(`npx --yes @tauri-apps/cli@${[...locked][0]} signer sign`)
  })
})
