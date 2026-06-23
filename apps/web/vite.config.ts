import { cloudflare } from '@cloudflare/vite-plugin'
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite'

// Single dev server: vite-plugin-solid (SPA + HMR) + @cloudflare/vite-plugin
// (runs the Hono Worker in Miniflare with local D1/KV). Port is pinned so the
// dev OAuth callback stays stable — see docs/local-development.md.
export default defineConfig({
  plugins: [solid(), cloudflare()],
  server: { port: 5173 },
})
