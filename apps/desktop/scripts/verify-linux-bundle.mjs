import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPnpm } from '../../../scripts/run-pnpm.mjs'
import { runtimeBinaryName, sha256, targetTriple } from './node-runtime.mjs'
import { verifyResources, verifyRuntime } from './bundle-inventory.mjs'

export function verifyLinuxBundle(pkg, bundle) {
  const dir = join(bundle, 'appimage')
  const images = readdirSync(dir).filter((name) => name.endsWith('.AppImage'))
  if (images.length !== 1) throw new Error(`Expected exactly one AppImage in ${dir}, found ${images.length}.`)
  const image = join(dir, images[0])
  if (!existsSync(`${image}.sig`)) throw new Error(`${image} has no updater signature.`)

  // Unpack the actual AppImage outside the checkout, for the same reason the Windows check installs
  // its installer: a boot from staged files can resolve a missing package from the development tree.
  // --appimage-extract needs no FUSE, so it works on a CI runner.
  const scratch = mkdtempSync(join(tmpdir(), 'acorn-linux-bundle-'))
  const problems = []
  try {
    execFileSync(image, ['--appimage-extract'], { cwd: scratch, stdio: 'ignore' })
    const bin = join(scratch, 'squashfs-root/usr/bin')
    // Tauri puts Linux resources under usr/lib/<productName>, which is what resource_dir() resolves to.
    const resources = join(scratch, 'squashfs-root/usr/lib/acorn')
    if (!existsSync(join(bin, 'acorn-desktop'))) problems.push('the packaged desktop executable is missing.')
    verifyResources(pkg, resources, (message) => problems.push(message))
    const node = join(bin, 'node')
    verifyRuntime(node, pkg, execFileSync, (message) => problems.push(message))
    const stagedNode = join(pkg, 'src-tauri/binaries', runtimeBinaryName(targetTriple()))
    if (existsSync(node) && sha256(node) !== sha256(stagedNode)) problems.push('the packaged Node runtime differs from the verified staged download.')
    if (problems.length) throw new Error(`Linux bundle verification failed:\n${problems.join('\n')}`)
    runPnpm(['run', 'test:boot'], {
      cwd: pkg,
      stdio: 'inherit',
      env: { ...process.env, ACORN_BOOT_RESOURCES: resources, ACORN_BOOT_NODE: node },
    })
    console.log(`[verify] Linux AppImage and packaged helper boot: ${images[0]}`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
