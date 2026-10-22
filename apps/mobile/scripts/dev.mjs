import { resolve } from 'node:path'
import { createServer } from 'vite'

// `pnpm dev:mobile`: Vite's dev server for the phone's web app, with the account service's routes
// proxied to a stand-in on this computer (docs/mobile.md § Run it). The app expects to be served by the
// account website, so `/account` has to answer on its own origin.
//
// Start the stand-in and its relay first with `pnpm dev:account`, and a Node with remote access on
// (`pnpm dev:agent` with `ACORN_ACCOUNT_URL` set, then Settings → Account). `ACORN_ACCOUNT_URL` says
// where the account service is when it isn't on the port `dev:account` uses.

const root = resolve(import.meta.dirname, '..')
const port = Number(process.env.ACORN_MOBILE_PORT ?? 4321)
const account = process.env.ACORN_ACCOUNT_URL ?? 'http://127.0.0.1:48781'

// `changeOrigin` stays off, so the service sees the host the browser used and its session cookie is
// the app's own. The path is a pattern, so Vite's own paths that begin with `/account` don't go along.
const server = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
  server: {
    host: process.env.ACORN_MOBILE_HOST ?? '127.0.0.1',
    port,
    strictPort: true,
    proxy: { '^/account(/|$)': { target: account, changeOrigin: false } },
  },
})
await server.listen()
server.printUrls()
console.log(`Account service  ${account}`)

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void server.close().then(() => process.exit(0)))
