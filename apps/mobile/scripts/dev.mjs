import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { resolve } from 'node:path'
import { build, createServer } from 'vite'
import { sandboxHeaders } from '../sandbox/headers.mts'

// `pnpm dev:mobile`: Vite's dev server for the phone's web app, with the account service's routes
// proxied to a stand-in on this computer (docs/mobile.md § Run it). The app expects to be served by the
// account website, so `/account` has to answer on its own origin.
//
// Start the stand-in and its relay first with `pnpm dev:account`, and a Node with remote access on
// (`pnpm dev:agent` with `ACORN_ACCOUNT_URL` set, then Settings → Account). `ACORN_ACCOUNT_URL` says
// where the account service is when it isn't on the port `dev:account` uses.
//
// It also serves the sandbox domain, on a port of its own, and the probe bundle the sandbox check page
// draws (docs/mobile/phone-setup.md § Try the sandbox). Every name under `localhost` reaches the
// sandbox server, so each bundle gets an origin of its own, as it does on the real domain.

const root = resolve(import.meta.dirname, '..')
const port = Number(process.env.ACORN_MOBILE_PORT ?? 4321)
const sandboxPort = Number(process.env.ACORN_SANDBOX_PORT ?? 4322)
const account = process.env.ACORN_ACCOUNT_URL ?? 'http://127.0.0.1:48781'
const host = process.env.ACORN_MOBILE_HOST ?? '127.0.0.1'

// Vite's build, which builds the probe below, would otherwise set `production` for the dev server too.
process.env.NODE_ENV = 'development'

// The app reads its sandbox domain from the build setting. Anything already set wins, for a check
// against a domain of your own.
process.env.ACORN_SANDBOX_DOMAIN ||= `localhost:${sandboxPort}`

const sandboxFiles = {
  '/worker.html': ['text/html; charset=utf-8', await readFile(resolve(root, 'sandbox/worker.html'))],
  '/worker-host.js': ['text/javascript; charset=utf-8', await readFile(resolve(root, 'sandbox/worker-host.js'))],
}
const sandbox = createHttpServer((request, response) => {
  const file = sandboxFiles[new URL(request.url ?? '/', 'http://sandbox').pathname]
  response.writeHead(file ? 200 : 404, { ...sandboxHeaders, ...(file && { 'content-type': file[0] }) })
  response.end(file?.[1])
})
await new Promise((done) => sandbox.listen(sandboxPort, host, done))

// The probe is one file, built the way a plugin's client is, and handed out under the app's own path.
const built = await build({
  configFile: false,
  root,
  logLevel: 'warn',
  build: {
    write: false,
    target: 'es2022',
    lib: { entry: resolve(root, 'dev/sandboxProbe.ts'), formats: ['es'], fileName: 'sandbox-fixture' },
  },
})
const probe = [built].flat().flatMap((result) => result.output)[0].code

// `changeOrigin` stays off, so the service sees the host the browser used and its session cookie is
// the app's own. The path is a pattern, so Vite's own paths that begin with `/account` don't go along.
const server = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
  plugins: [
    {
      name: 'sandbox-probe-bundle',
      configureServer: ({ middlewares }) => {
        middlewares.use('/app/dev/sandbox-fixture.js', (_request, response) => {
          response.setHeader('content-type', 'text/javascript; charset=utf-8')
          response.end(probe)
        })
      },
    },
  ],
  server: {
    host,
    port,
    strictPort: true,
    proxy: { '^/account(/|$)': { target: account, changeOrigin: false } },
  },
})
await server.listen()
server.printUrls()
console.log(`Account service  ${account}`)
console.log(`Sandbox domain   ${process.env.ACORN_SANDBOX_DOMAIN}  (check page: /app/dev/sandbox)`)

for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => void Promise.all([server.close(), sandbox.close()]).then(() => process.exit(0)))
