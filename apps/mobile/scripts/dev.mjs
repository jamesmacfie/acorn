import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { createServer } from 'vite'

// `pnpm dev:mobile [-- --node NAME|URL]`: the gateway, and Vite's dev server in front of it.
//
// The gateway checks `Host` and `Origin` against the one address phones open, so it serves the dev
// server's address and the proxy keeps `Host` as the browser sent it. Anything after `--` goes to the
// gateway. It shares this terminal, which is where it prints the sign-in code and asks for a pairing
// code the first time it meets a Node.

const root = resolve(import.meta.dirname, '..')
const appPort = Number(process.env.ACORN_MOBILE_PORT ?? 4321)
const gatewayPort = Number(process.env.ACORN_MOBILE_GATEWAY_PORT ?? 4320)
const gateway = `http://127.0.0.1:${gatewayPort}`

const child = spawn(
  process.execPath,
  [
    '--import',
    'tsx',
    'src/gateway/main.ts',
    '--port',
    String(gatewayPort),
    '--origin',
    `http://127.0.0.1:${appPort}`,
    ...process.argv.slice(2).filter((arg) => arg !== '--'),
  ],
  { cwd: root, stdio: 'inherit' },
)

// Spelled out, because Vite's string shorthand rewrites `Host` to the target's. The paths are patterns,
// because a plain `/node` prefix would also send Vite's own `/node_modules` to the gateway.
const toGateway = { target: gateway, changeOrigin: false }
const server = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
  server: {
    host: '127.0.0.1',
    port: appPort,
    strictPort: true,
    proxy: {
      '^/node(/|$)': toGateway,
      '^/session$': toGateway,
      '^/events$': { ...toGateway, ws: true },
    },
  },
})
await server.listen()
server.printUrls()

child.once('exit', (code) => void server.close().then(() => process.exit(code ?? 0)))
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
