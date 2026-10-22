// `pnpm --filter @acorn/relay start`: a relay with a static credential, or checking an account service
// (docs/relay.md § Run your own relay).
import { readFileSync } from 'node:fs'
import { accountAuth, staticAuth } from './auth'
import { startRelay } from './relay'

const env = (name: string): string | undefined => process.env[name]?.trim() || undefined

function fail(message: string): never {
  console.error(`[relay] ${message}`)
  process.exit(1)
}

const log = (line: string): void => console.log(`[relay] ${line}`)
const accountUrl = env('ACORN_RELAY_ACCOUNT_URL')
const credential = env('ACORN_RELAY_CREDENTIAL')
if (accountUrl && credential) fail('Set ACORN_RELAY_ACCOUNT_URL or ACORN_RELAY_CREDENTIAL, not both.')
if (!accountUrl && (!credential || credential.length < 16))
  fail(
    'Set ACORN_RELAY_CREDENTIAL to a secret of at least 16 characters, such as the output of openssl rand -hex 32, or set ACORN_RELAY_ACCOUNT_URL to check an account service.',
  )
const certPath = env('ACORN_RELAY_TLS_CERT')
const keyPath = env('ACORN_RELAY_TLS_KEY')
if (Boolean(certPath) !== Boolean(keyPath)) fail('Set both ACORN_RELAY_TLS_CERT and ACORN_RELAY_TLS_KEY, or neither.')
const host = env('ACORN_RELAY_HOST') ?? '0.0.0.0'
const port = Number(env('ACORN_RELAY_PORT') ?? 8443)

const auth = accountUrl ? await accountAuth({ url: accountUrl, log }) : staticAuth(credential!)
const relay = await startRelay({
  auth,
  host,
  port,
  ...(certPath && keyPath ? { tls: { cert: readFileSync(certPath, 'utf8'), key: readFileSync(keyPath, 'utf8') } } : {}),
  log,
})
console.log(`[relay] listening on ${certPath ? 'wss' : 'ws'}://${host}:${relay.port}`)
if (!certPath)
  console.log('[relay] serving ws://, so put a proxy that terminates TLS in front of it on a public network')

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => void relay.close().then(() => process.exit(0)))
