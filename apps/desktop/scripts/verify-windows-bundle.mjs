import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPnpm } from '../../../scripts/run-pnpm.mjs'
import { sha256 } from './node-runtime.mjs'
import { verifyResources, verifyRuntime } from './bundle-inventory.mjs'

export function verifyWindowsBundle(pkg, bundle) {
  const nsis = join(bundle, 'nsis')
  const installers = readdirSync(nsis).filter((name) => name.endsWith('-setup.exe'))
  if (installers.length !== 1) throw new Error(`Expected exactly one Windows setup installer in ${nsis}, found ${installers.length}.`)
  const installer = join(nsis, installers[0])
  if (!existsSync(`${installer}.sig`)) throw new Error(`${installer} has no updater signature.`)

  // Install the actual NSIS output outside the checkout. A boot from staged files can accidentally
  // resolve a missing native package from the development node_modules and pass.
  const scratch = mkdtempSync(join(tmpdir(), 'acorn-windows-bundle-'))
  const installed = join(scratch, 'installed')
  const problems = []
  try {
    // NSIS reads the final /D= argument through the end of the command line, without quotes.
    execFileSync(installer, ['/S', `/D=${installed}`], { stdio: 'inherit', windowsVerbatimArguments: true })
    if (!existsSync(join(installed, 'acorn-desktop.exe'))) problems.push('the installed desktop executable is missing.')
    verifyResources(pkg, installed, (message) => problems.push(message))
    const node = join(installed, 'node.exe')
    verifyRuntime(node, pkg, execFileSync, (message) => problems.push(message))
    const stagedNode = join(pkg, 'src-tauri/binaries/node-x86_64-pc-windows-msvc.exe')
    if (existsSync(node) && sha256(node) !== sha256(stagedNode)) problems.push('the installed Node runtime differs from the verified staged download.')
    if (problems.length) throw new Error(`Windows bundle verification failed:\n${problems.join('\n')}`)
    runPnpm(['exec', 'vitest', 'run', '--project', 'shell', 'test/boot.test.ts'], {
      cwd: pkg,
      stdio: 'inherit',
      env: { ...process.env, ACORN_BOOT_RESOURCES: installed, ACORN_BOOT_NODE: node },
    })
    console.log(`[verify] Windows installer and installed helper boot: ${installers[0]}`)
  } finally {
    // NSIS owns shortcuts and uninstall metadata as well as files. Remove all of them after QA.
    const uninstaller = join(installed, 'uninstall.exe')
    if (existsSync(uninstaller)) execFileSync(uninstaller, ['/S', `_?=${installed}`], { stdio: 'inherit', windowsVerbatimArguments: true })
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
}
