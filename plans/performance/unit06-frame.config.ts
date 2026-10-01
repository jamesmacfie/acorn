import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
export default defineConfig({
  root,
  plugins: [solid()],
  resolve: {
    conditions: ['browser', 'development'],
    dedupe: ['solid-js'],
    alias: [
      { find: /^solid-js$/, replacement: root + 'packages/client-core/node_modules/solid-js/dist/dev.js' },
      { find: /^solid-js\/web$/, replacement: root + 'packages/client-core/node_modules/solid-js/web/dist/dev.js' },
      { find: /^solid-js\/store$/, replacement: root + 'packages/client-core/node_modules/solid-js/store/dist/dev.js' },
      { find: /^solid-js\/universal$/, replacement: root + 'packages/client-core/node_modules/solid-js/universal/dist/universal.js' },
      { find: '@solidjs/router', replacement: root + 'packages/client-core/node_modules/@solidjs/router' },
      { find: '@tanstack/solid-query', replacement: root + 'packages/client-core/node_modules/@tanstack/solid-query/build/dev.js' },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['plans/performance/area03-bench.test.tsx'],
    setupFiles: [root + 'vitest.browser.setup.ts'],
    maxWorkers: 1,
    server: { deps: { inline: [/solid-js/, /@solidjs\/router/, /@tanstack\/solid-query/] } },
  },
})
