import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

// The identity native tools such as Computer Use see for an agent session's window
// (docs/local-development.md § Native control of a session). A raw `target/debug` executable has no
// bundle identifier, so on macOS each session runs the build from inside a small app bundle instead.
// Every session shares this identifier, which is what lets one saved approval cover later sessions
// and rebuilds, and each gets its own bundle path, which is what tells two sessions apart. It is not
// the installed app's `com.acorn.desktop`, so trusting it trusts test builds and nothing else.
export const TEST_APP_ID = 'com.acorn.desktop.agent-test'
export const TEST_APP_NAME = 'Acorn Agent Test'

const escapeXml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function infoPlist({ identifier, name, executable }) {
  const entries = {
    CFBundleIdentifier: identifier,
    CFBundleName: name,
    CFBundleDisplayName: name,
    CFBundleExecutable: executable,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: '0.0.0',
    CFBundleVersion: '0',
    NSHighResolutionCapable: true,
  }
  const body = Object.entries(entries).map(([key, value]) => typeof value === 'boolean'
    ? `  <key>${key}</key>\n  <${value}/>`
    : `  <key>${key}</key>\n  <string>${escapeXml(value)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`
}

/**
 * Wrap the freshly built debug executable in `<session>/Acorn Agent Test.app` and sign it ad hoc,
 * so the bundle and its executable agree. A copy rather than a link: macOS names a process by the
 * path it was executed from, and a symlink resolves back to `target/debug`, which has no identity.
 * On APFS the copy is a clone and costs nothing. Every path the debug shell reads is compiled in from
 * the checkout, so moving the executable changes nothing it loads.
 */
export async function stageTestApp(directory, builtExecutable) {
  const appPath = join(directory, `${TEST_APP_NAME}.app`)
  const name = basename(builtExecutable)
  const executable = join(appPath, 'Contents', 'MacOS', name)
  await rm(appPath, { recursive: true, force: true })
  await mkdir(join(appPath, 'Contents', 'MacOS'), { recursive: true, mode: 0o700 })
  await writeFile(join(appPath, 'Contents', 'Info.plist'), infoPlist({ identifier: TEST_APP_ID, name: TEST_APP_NAME, executable: name }))
  await copyFile(builtExecutable, executable, constants.COPYFILE_FICLONE)
  await run('codesign', ['--force', '--sign', '-', '--identifier', TEST_APP_ID, appPath])
  return { bundleIdentifier: TEST_APP_ID, name: TEST_APP_NAME, appPath, executable }
}

/**
 * Whether a process is the window this session launched: the launcher's own child, running the
 * executable the manifest names. A recorded PID alone is not enough, because a stopped window's PID
 * can be handed to an unrelated process.
 */
export function isSessionApp(processInfo, manifest) {
  if (!processInfo) return false
  if (processInfo.ppid !== manifest.launcherPid) return false
  return !manifest.nativeApp || processInfo.command === manifest.nativeApp.executable
}

async function processInfo(pid) {
  if (!Number.isInteger(pid) || pid < 1 || process.platform === 'win32') return null
  try {
    const { stdout } = await run('ps', ['-o', 'ppid=,comm=', '-p', String(pid)])
    const match = stdout.trim().match(/^(\d+)\s+(.+)$/)
    return match ? { ppid: Number(match[1]), command: match[2] } : null
  } catch {
    return null
  }
}

/** Refuse a session whose recorded window is gone or is no longer the process it launched. */
export async function requireSessionApp(manifest) {
  // Windows has no `ps`, so there the manifest's own liveness check is all there is.
  if (process.platform === 'win32') return
  if (!isSessionApp(await processInfo(manifest.appPid), manifest)) {
    throw new Error(`Agent session ${manifest.name} no longer owns process ${manifest.appPid}. Start the session again.`)
  }
}

/**
 * What a native tool should address for this session, and which other live sessions share its
 * identity. Address the app path: every session shares the identifier, so the identifier alone
 * cannot say which window is meant once a second session is running.
 */
export async function nativeTarget(manifest, active) {
  await requireSessionApp(manifest)
  if (!manifest.nativeApp) {
    throw new Error('This session has no native app identity. Native targeting is only set up on macOS.')
  }
  const sharing = active
    .filter((other) => other.name !== manifest.name && other.nativeApp?.bundleIdentifier === manifest.nativeApp.bundleIdentifier)
    .map((other) => other.name)
  return {
    session: manifest.name,
    pid: manifest.appPid,
    app: manifest.nativeApp.appPath,
    bundleIdentifier: manifest.nativeApp.bundleIdentifier,
    name: manifest.nativeApp.name,
    sharedWith: sharing,
  }
}
