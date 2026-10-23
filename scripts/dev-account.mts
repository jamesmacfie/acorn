// `pnpm dev:account`: the stand-in account service and a relay that checks it, for trying remote access
// without the hosted service (docs/account-api/testing.md § The stand-in). Start a Node or a `dev:agent` session
// with the printed `ACORN_ACCOUNT_URL`. Every sign-in is approved at once as one test account, unless
// `ACORN_DEV_ACCOUNT_APPROVE=manual`, which waits for you to approve the code with the command it prints.
import { accountAuth } from '../apps/relay/src/auth.ts'
import { startRelay } from '../apps/relay/src/relay.ts'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startAccountStub } from '../packages/node-core/src/testkit/accountStub.ts'
import { startFakeAcme } from '../packages/node-core/src/testkit/fakeAcme.ts'

// Fixed ports, so `pnpm dev:mobile` and a Node's `ACORN_ACCOUNT_URL` find them again after a restart.
const port = (name: string, fallback: number): number => Number(process.env[name] ?? fallback)
const login = process.env.ACORN_DEV_ACCOUNT_LOGIN ?? 'test-account'
const manual = process.env.ACORN_DEV_ACCOUNT_APPROVE === 'manual'
const account = await startAccountStub({
  port: port('ACORN_DEV_ACCOUNT_PORT', 48781),
  approveAs: manual ? false : login,
})
// Previews: names under `preview.localhost`, which a browser on this computer resolves to loopback, a relay
// listener for them, and an authority that issues a Node's certificate with no internet. A browser accepts the
// certificate only if it trusts that authority, so its CA is written where a script can point at it.
const previewPort = port('ACORN_DEV_PREVIEW_PORT', 48784)
const acme = await startFakeAcme({ lookupTxt: (name) => account.challenges().get(name) })
const caPath = join(tmpdir(), 'acorn-dev-acme-ca.pem')
writeFileSync(caPath, acme.caPem)
const relay = await startRelay({
  auth: await accountAuth({ url: account.url, log: console.log }),
  port: port('ACORN_DEV_RELAY_PORT', 48782),
  preview: { domain: 'preview.localhost', port: previewPort },
  log: (line) => console.log(`[relay] ${line}`),
})
// Where Nodes and phones are told the relay is. It's the relay's own address unless something sits in front of
// it, such as the tunnel a real phone reaches this computer through.
const relayUrl = process.env.ACORN_DEV_RELAY_URL ?? `ws://127.0.0.1:${relay.port}`
account.setRelayUrl(relayUrl)
account.setPreview({ domain: `preview.localhost:${previewPort}`, acmeDirectory: acme.directoryUrl })

console.log(`Account service  ${account.url}`)
console.log(
  `Relay            ws://127.0.0.1:${relay.port}${relayUrl === `ws://127.0.0.1:${relay.port}` ? '' : `, announced as ${relayUrl}`}`,
)
console.log(
  `Previews         https://*.preview.localhost:${relay.previewPort}, certificates from a stand-in authority, CA at ${caPath}`,
)
console.log('')
console.log(`Start a Node or a session with: ACORN_ACCOUNT_URL=${account.url}`)
console.log('Then open Settings > Account, sign in, and turn on Remote access. Press Ctrl+C to stop.')
if (manual)
  console.log(
    `Approve a sign-in with: curl -X POST ${account.url}/_test/approve -d '{"userCode":"<code>","login":"${login}"}'`,
  )

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(
    signal,
    () => void Promise.all([relay.close(), acme.close(), account.close()]).then(() => process.exit(0)),
  )
