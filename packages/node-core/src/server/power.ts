import { spawn } from 'node:child_process'
import type { Socket } from 'node:net'
import type { KeepAwake, KeepAwakeSetting, NodePower } from '@acorn/protocol/api.ts'
import { createLogger } from './telemetry/logger'

// Keeps the computer from sleeping when idle while agents work or workflows run
// (docs/node-distribution/keep-awake.md). Plugins hold leases through the NODE_KEEP_AWAKE capability,
// and this module turns the count into one operating system inhibitor.

const log = createLogger('power')

// Starts the platform's inhibitor and returns its stop. Calls `ended` once if the inhibitor ends on
// its own, which is how a refusal arrives. Never calls it after the stop.
export type Inhibitor = (ended: () => void) => () => void

// Long enough to cover the gap between two agent turns, so the assertion doesn't flap.
const RELEASE_DELAY_MS = 60_000

export function createKeepAwake(options: {
  inhibitor: Inhibitor | null
  readSetting: () => Promise<string | null>
  releaseDelayMs?: number
}): KeepAwake & { stop(): void } {
  let held = 0
  let available = options.inhibitor !== null
  let stopInhibitor: (() => void) | null = null
  let releaseTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const setting = async (): Promise<KeepAwakeSetting> =>
    (await options.readSetting()) === 'never' ? 'never' : 'while-busy'

  const stopNow = () => {
    if (releaseTimer) clearTimeout(releaseTimer)
    releaseTimer = null
    stopInhibitor?.()
    stopInhibitor = null
  }

  // Brings the inhibitor in line with the leases and the preference. The preference has no change
  // notice, so this runs on every lease and on every status read, which Settings makes after a change.
  const reconcile = async (): Promise<KeepAwakeSetting> => {
    const current = await setting()
    if (current === 'never') stopNow()
    else if (held > 0 && !stopInhibitor && available && !stopped && options.inhibitor) {
      stopInhibitor = options.inhibitor(() => {
        stopInhibitor = null
        if (available) log.warn('the operating system refused to keep this computer awake')
        available = false
      })
    }
    return current
  }

  const release = () => {
    held -= 1
    if (held > 0 || !stopInhibitor) return
    releaseTimer = setTimeout(() => {
      releaseTimer = null
      if (held === 0) stopNow()
    }, options.releaseDelayMs ?? RELEASE_DELAY_MS)
    releaseTimer.unref()
  }

  return {
    hold() {
      held += 1
      if (releaseTimer) clearTimeout(releaseTimer)
      releaseTimer = null
      void reconcile().catch((error) => log.warn(`couldn't read the keep-awake setting: ${String(error)}`))
      let released = false
      return () => {
        if (released) return
        released = true
        release()
      }
    },
    async status(): Promise<NodePower> {
      return { setting: await reconcile(), available, held }
    },
    // For the Node's drain.
    stop() {
      stopped = true
      stopNow()
    },
  }
}

// A child process that holds the machine awake until it's killed. `stdin` stays a pipe the child
// blocks on where the inhibitor can't watch the Node's process itself, so it ends when the Node dies.
export function childInhibitor(command: string, args: string[]): Inhibitor {
  return (ended) => {
    let done = false
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
    const end = () => {
      if (done) return
      done = true
      ended()
    }
    child.once('error', end)
    child.once('exit', end)
    // Neither keeps the Node's event loop alive. A piped stdin is a socket, though typed as a stream.
    const stdin = child.stdin as Socket | null
    child.unref()
    stdin?.unref()
    return () => {
      done = true
      child.kill()
    }
  }
}

// ES_CONTINUOUS | ES_SYSTEM_REQUIRED (0x80000001), held until stdin closes. The display may still turn
// off. Written in decimal, because PowerShell 5 reads the hex literal as a negative Int32.
const WINDOWS_SCRIPT = [
  `$k = Add-Type -Name Power -Namespace Acorn -PassThru -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'`,
  `[void]$k::SetThreadExecutionState([uint32]2147483649)`,
  `[void][Console]::In.ReadLine()`,
].join('; ')

export function platformInhibitor(platform: NodeJS.Platform = process.platform): Inhibitor | null {
  switch (platform) {
    case 'darwin':
      // -i stops idle sleep only, so a closed lid or a chosen Sleep still sleeps the Mac.
      return childInhibitor('caffeinate', ['-i', '-w', String(process.pid)])
    case 'linux':
      return childInhibitor('systemd-inhibit', [
        '--what=idle',
        '--who=acorn',
        '--why=Agents or workflows are running',
        '--mode=block',
        'sh',
        '-c',
        'read _',
      ])
    case 'win32':
      return childInhibitor('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64'),
      ])
    default:
      return null
  }
}
