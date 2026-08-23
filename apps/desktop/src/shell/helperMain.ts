import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { z } from 'zod'
import { createHelper, type Helper } from '@acorn/desktop-helper/main/index.ts'
import type { TokenCipher } from '@acorn/desktop-helper/main/deviceTokenStore.ts'
import { adoptLegacyCustody } from '@acorn/desktop-helper/main/legacyCustody.ts'
import { startHelperServer, type HelperServer } from './helperServer'
import { HELPER_PROTOCOL } from './wire'

// The desktop helper process: the whole custody stack, running under the bundled Node runtime with
// Rust as its supervisor (docs/shell.md § The shell process).
//
// Rust is the only thing that talks to this process directly, and it does so over stdin and stdout in
// lines: one handshake line in, one ready line out, then commands. Never env or argv — the data key is
// in that handshake, and argv is world-readable on every platform this ships to.
//
// The handshake goes in before anything is started, and the command reader is installed before the
// handshake is even read, because Rust can send `stop` while the node is still booting. A helper that
// installed its reader after `service.start` resolved dropped that line and was killed for not
// quitting (docs/future/tauri/node-runtime.md § Spike findings).

// Every line Rust is meant to read carries this key; everything else on stdout is a log.
const TAG = 'acorn-helper'

const handshakeSchema = z.strictObject({
  protocol: z.literal(HELPER_PROTOCOL),
  // 32 bytes of hex. Rust holds it in the OS keychain and it never touches disk on this side; it is
  // what device tokens are encrypted under (docs/future/tauri/architecture.md § Keys and custody).
  dataKey: z.string().regex(/^[0-9a-f]{64}$/),
  // The node's data root, and the helper's own custody root. Two different directories on purpose:
  // fleet.json and the encrypted tokens are this app's, not the node's.
  dataDir: z.string().min(1),
  userDataDir: z.string().min(1),
  serviceEntry: z.string().min(1),
  mcpEntry: z.string().min(1),
  bundledPluginsDir: z.string().min(1).optional(),
  // Where secrets come from, in order, least specific first. The shell decides the list because only
  // it knows whether this is a bundle or a checkout; the helper is the process that has to have them
  // loaded, because it is the one that spawns the node.
  envFiles: z.array(z.string().min(1)),
  version: z.string().min(1),
  isPackaged: z.boolean(),
  // The renderer's origin, checked on the WebSocket upgrade.
  appOrigin: z.string().min(1),
  // An Electron build's custody root and the safeStorage password its device tokens are under, when
  // the shell found both. Adopted once, on a first launch that has no fleet of its own
  // (@acorn/desktop-helper/main/legacyCustody.ts).
  legacy: z.strictObject({ userDataDir: z.string().min(1), safeStorageKey: z.string().min(1) }).optional(),
})
type Handshake = z.infer<typeof handshakeSchema>

const commandSchema = z.strictObject({ command: z.enum(['stop', 'retry']) })

// AES-256-GCM under the key Rust holds, in the shape deviceTokenStore.ts asks for. The blob is
// nonce ‖ tag ‖ ciphertext, self-describing enough that a future key rotation can tell one from
// nothing at all. This is the Tauri answer to Electron's `safeStorage`, and the reason the store
// takes a cipher rather than importing one.
const dataKeyCipher = (dataKey: string): TokenCipher => {
  const key = Buffer.from(dataKey, 'hex')
  return {
    available: () => true,
    encrypt: (value) => {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), body])
    },
    decrypt: (blob) => {
      const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12))
      decipher.setAuthTag(blob.subarray(12, 28))
      return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8')
    },
  }
}

// Anything the shell has to react to. Rust reads these off stdout the same way it reads the ready
// line: `node-replaced` reaches the renderer over the helper socket, but the recovery screen is a
// native dialog, so the crash budget has to reach Rust — and so does each preview tunnel's secret,
// which the shell seeds into the pane's cookie store because wry cannot inject a request header
// (docs/future/tauri/webviews-and-frames.md § Preview pane). This pipe reaches Rust and nothing else,
// which is why a secret may travel on it.
const emit = (event: 'crash-budget-exhausted' | 'tunnel-opened' | 'tunnel-closed', detail?: object): void =>
  console.log(JSON.stringify({ [TAG]: event, ...detail }))

async function boot(handshake: Handshake): Promise<{ helper: Helper; server: HelperServer }> {
  const tokenCipher = dataKeyCipher(handshake.dataKey)
  // Before anything reads the fleet, because everything below it assumes the custody root is whatever
  // it is going to be for this launch.
  if (handshake.legacy) adoptLegacyCustody(handshake.userDataDir, tokenCipher, handshake.legacy)

  for (const file of handshake.envFiles) {
    try {
      process.loadEnvFile(file)
    } catch {
      // Fine if this one is missing: secrets can still come from the other file, the environment, or
      // the keychain.
    }
  }

  let server: HelperServer | null = null
  const helper = createHelper({
    serviceEntry: handshake.serviceEntry,
    service: {
      dataDir: handshake.dataDir,
      version: handshake.version,
      isPackaged: handshake.isPackaged,
      // The bundled Node binary Rust launched this process with. `serviceHost.ts` spawns the service
      // with it, and so do agents and MCP registration, which is the whole point of shipping a real
      // runtime (docs/future/tauri/node-runtime.md).
      hostRuntimePath: process.execPath,
      mcpEntry: handshake.mcpEntry,
      ...(handshake.bundledPluginsDir ? { bundledPluginsDir: handshake.bundledPluginsDir } : {}),
    },
    userDataDir: handshake.userDataDir,
    tokenCipher,
    // Held as a lookup rather than captured, because the listener does not exist yet and there may be
    // no renderer attached when a frame arrives.
    push: {
      frame: (nodeId, frame) => server?.push({ push: 'node-frame', nodeId, frame }),
      status: (status) => server?.push({ push: 'node-status', status }),
    },
    // Electron reloads the window from main; here the renderer is told and reloads itself. Same
    // meaning either way: the node it was talking to has a new endpoint, certificate and token.
    onNodeReplaced: () => server?.push({ push: 'node-replaced' }),
    onCrashBudgetExhausted: () => emit('crash-budget-exhausted'),
    tunnelEvents: {
      opened: (port, secret) => emit('tunnel-opened', { port, secret }),
      closed: (port) => emit('tunnel-closed', { port }),
    },
  })

  await helper.start()
  server = await startHelperServer(helper, { secret: randomBytes(32).toString('hex'), appOrigin: handshake.appOrigin })
  helper.bootComplete()
  return { helper, server }
}

let booted: Promise<{ helper: Helper; server: HelperServer }> | null = null
let stopping = false

const stop = async (code: number): Promise<never> => {
  if (stopping) return new Promise<never>(() => {})
  stopping = true
  try {
    const running = await booted
    await running?.server.close()
    await running?.helper.dispose()
  } catch (error) {
    console.error('[helper] shutdown failed:', error)
  }
  process.exit(code)
}

// One reader for both the handshake and the commands after it, installed before either can arrive.
// Lines queue behind whatever the previous one is still doing, so a `stop` that lands mid-boot waits
// for the boot rather than racing it.
let queue: Promise<unknown> = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  queue = queue.then(async () => {
    if (!booted) {
      const handshake = handshakeSchema.parse(JSON.parse(trimmed))
      booted = boot(handshake)
      const { server } = await booted
      // The ready line. `nodeVersion` is here so Rust can assert the runtime pin it thinks it shipped
      // is the runtime that actually booted (docs/future/tauri/node-runtime.md § Design).
      console.log(JSON.stringify({ [TAG]: 'ready', protocol: HELPER_PROTOCOL, port: server.port, secret: server.secret, nodeVersion: process.version }))
      return
    }
    const { command } = commandSchema.parse(JSON.parse(trimmed))
    if (command === 'stop') return stop(0)
    // The owner's answer to the recovery screen: forgive the spent budget and try once more.
    await (await booted).helper.retry()
  }).catch((error: unknown) => {
    console.error('[helper] failed:', error)
    void stop(1)
  })
})

// A shell that died takes its end of these pipes with it, and the next `console.log` in the drain
// would then throw EPIPE as an unhandled 'error' event and kill this process mid-shutdown — with the
// node still holding the data root's lock, which is the exact failure the process group is there to
// prevent. Nobody is listening is not a fault; the drain below is what matters.
for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {})

// Rust kills the process group, so this is the polite half of that: drain before the escalation lands.
process.once('SIGTERM', () => void stop(0))
process.once('SIGINT', () => void stop(0))
// Rust closing the pipe means the shell is gone. Nothing else can reach this process, so there is no
// reason to keep the node alive holding the data root's lock.
process.stdin.once('end', () => void stop(0))
