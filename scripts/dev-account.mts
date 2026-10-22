// `pnpm dev:account`: the stand-in account service and a relay that checks it, for trying remote access
// without the hosted service (docs/account-api.md § The stand-in). Start a Node or a `dev:agent` session
// with the printed `ACORN_ACCOUNT_URL`. Every sign-in is approved at once as one test account, unless
// `ACORN_DEV_ACCOUNT_APPROVE=manual`, which waits for you to approve the code with the command it prints.
import { accountAuth } from '../apps/relay/src/auth.ts'
import { startRelay } from '../apps/relay/src/relay.ts'
import { startAccountStub } from '../packages/node-core/src/testkit/accountStub.ts'

// Fixed ports, so `pnpm dev:mobile` and a Node's `ACORN_ACCOUNT_URL` find them again after a restart.
const port = (name: string, fallback: number): number => Number(process.env[name] ?? fallback)
const login = process.env.ACORN_DEV_ACCOUNT_LOGIN ?? 'test-account'
const manual = process.env.ACORN_DEV_ACCOUNT_APPROVE === 'manual'
const account = await startAccountStub({ port: port('ACORN_DEV_ACCOUNT_PORT', 48781), approveAs: manual ? false : login })
const relay = await startRelay({
  auth: await accountAuth({ url: account.url, log: console.log }),
  port: port('ACORN_DEV_RELAY_PORT', 48782),
  log: (line) => console.log(`[relay] ${line}`),
})
account.setRelayUrl(`ws://127.0.0.1:${relay.port}`)

console.log(`Account service  ${account.url}`)
console.log(`Relay            ws://127.0.0.1:${relay.port}`)
console.log('')
console.log(`Start a Node or a session with: ACORN_ACCOUNT_URL=${account.url}`)
console.log('Then open Settings > Account, sign in, and turn on Remote access. Press Ctrl+C to stop.')
if (manual)
  console.log(
    `Approve a sign-in with: curl -X POST ${account.url}/_test/approve -d '{"userCode":"<code>","login":"${login}"}'`,
  )

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => void Promise.all([relay.close(), account.close()]).then(() => process.exit(0)))
