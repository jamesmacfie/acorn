import { hostname } from 'node:os'
import { custody } from '@acorn/custody/local'
import {
  BROWSER_BRIDGE_PROTOCOL_VERSION,
  CHROME_EXTENSION_ID,
  FIREFOX_EXTENSION_ID,
  NATIVE_REQUEST_MAX_BYTES,
  bridgeRequestSchema,
  type BridgeBrowser,
  type BridgeHostMessage,
} from '@acorn/protocol/extensionBridge.ts'
import { BridgeFailure, createBridge } from './bridge'
import { FrameError, encodeMessage, frameReader } from './framing'

// The native messaging host a browser starts for the extension. Stdout is the frame wire, so nothing
// else may write to it: diagnostics go to stderr, which the browser keeps in its own log.
//
// The registered launcher script runs `native-host.js --browser B --bridge-dir DIR -- <browser args>`.
// `installNativeHost` writes it.

export type HostArgs = { browser: BridgeBrowser; bridgeDir: string; callerArgs: string[] }

export function parseHostArgs(argv: string[]): HostArgs {
  const separator = argv.indexOf('--')
  const own = separator < 0 ? argv : argv.slice(0, separator)
  const value = (name: string) => {
    const at = own.indexOf(name)
    return at < 0 ? undefined : own[at + 1]
  }
  const browser = value('--browser')
  const bridgeDir = value('--bridge-dir')
  if ((browser !== 'chrome' && browser !== 'firefox') || !bridgeDir?.startsWith('/'))
    throw new Error('Usage: native-host.js --browser chrome|firefox --bridge-dir ABSOLUTE -- <browser arguments>')
  return { browser, bridgeDir, callerArgs: separator < 0 ? [] : argv.slice(separator + 1) }
}

// The browser names its caller, each in its own form. The registration's allowlist is the real gate;
// this refuses a launch from anything else, such as another browser using the wrong registration.
//   Chrome:  chrome-extension://<id>/
//   Firefox: <absolute path to the registration file> <extension id>
export function callerRefusal(browser: BridgeBrowser, args: string[]): string | null {
  if (browser === 'chrome') {
    return args.length === 1 && args[0] === `chrome-extension://${CHROME_EXTENSION_ID}/`
      ? null
      : `Chrome started this host for ${JSON.stringify(args)}, not the Acorn extension.`
  }
  return args.length === 2 && args[0]!.startsWith('/') && args[0]!.endsWith('.json') && args[1] === FIREFOX_EXTENSION_ID
    ? null
    : `Firefox started this host for ${JSON.stringify(args)}, not the Acorn extension.`
}

const diagnose = (message: string): void => {
  process.stderr.write(`acorn browser bridge: ${message}\n`)
}

export function runNativeHost(argv: string[]): void {
  let args: HostArgs
  try {
    args = parseHostArgs(argv)
  } catch (error) {
    diagnose(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
  const refusal = callerRefusal(args.browser, args.callerArgs)
  if (refusal) {
    diagnose(refusal)
    process.exit(3)
  }

  const send = (message: BridgeHostMessage): void => {
    for (const frame of encodeMessage(message)) process.stdout.write(frame)
  }
  const bridge = createBridge({
    fleet: custody(args.bridgeDir).fleet,
    deviceName: `Acorn for ${args.browser === 'chrome' ? 'Chrome' : 'Firefox'} on ${hostname()}`,
    status: (status) => send({ v: BROWSER_BRIDGE_PROTOCOL_VERSION, event: 'status', status }),
  })
  const close = (code: number): void => {
    bridge.dispose()
    process.stdout.write('', () => process.exit(code))
  }

  const respond = (value: unknown): void => {
    const parsed = bridgeRequestSchema.safeParse(value)
    if (!parsed.success) {
      const id = (value as { id?: unknown } | null)?.id
      diagnose('Refused a request that does not match the protocol.')
      if (typeof id === 'string' && id.length > 0 && id.length <= 64)
        send({
          v: BROWSER_BRIDGE_PROTOCOL_VERSION,
          id,
          ok: false,
          error: { code: 'bad_request', message: 'The request does not match the bridge protocol.' },
        })
      return
    }
    const { id } = parsed.data
    bridge.handle(parsed.data).then(
      (result) => send({ v: BROWSER_BRIDGE_PROTOCOL_VERSION, id, ok: true, result }),
      (error: unknown) => {
        const failure =
          error instanceof BridgeFailure
            ? error
            : new BridgeFailure('node_error', error instanceof Error ? error.message : String(error))
        send({
          v: BROWSER_BRIDGE_PROTOCOL_VERSION,
          id,
          ok: false,
          error: { code: failure.code, message: failure.message },
        })
      },
    )
  }

  const reader = frameReader(NATIVE_REQUEST_MAX_BYTES)
  process.stdin.on('data', (chunk: Buffer) => {
    let frames
    try {
      frames = reader.push(chunk)
    } catch (error) {
      diagnose(error instanceof FrameError ? error.message : String(error))
      return close(1)
    }
    for (const frame of frames) {
      if (frame.ok) respond(frame.value)
      else diagnose(frame.reason)
    }
  })
  // The browser closes stdin when the extension disconnects or the browser exits.
  process.stdin.on('end', () => {
    if (reader.pendingBytes() > 0) diagnose(`Discarded ${reader.pendingBytes()} bytes of an unfinished frame.`)
    close(0)
  })
}

if (process.argv[1] && /(?:^|\/)native-host\.js$/.test(process.argv[1])) runNativeHost(process.argv.slice(2))
