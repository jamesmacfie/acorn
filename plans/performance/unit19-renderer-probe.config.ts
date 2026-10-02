import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { readdirSync, realpathSync } from 'node:fs'

const root = fileURLToPath(new URL('../../', import.meta.url))
export default defineConfig({
  root, plugins: [solid({ hot: false })],
  resolve: { conditions: ['browser', 'development'], dedupe: ['solid-js'], alias: [
    { find: /^solid-js$/, replacement: realpathSync(root + 'packages/client-core/node_modules/solid-js/dist/dev.js') },
    { find: /^solid-js\/web$/, replacement: realpathSync(root + 'packages/client-core/node_modules/solid-js/web/dist/dev.js') },
    { find: /^solid-js\/store$/, replacement: realpathSync(root + 'packages/client-core/node_modules/solid-js/store/dist/dev.js') },
    { find: /^@tanstack\/solid-query$/, replacement: realpathSync(root + 'packages/client-core/node_modules/@tanstack/solid-query/build/dev.js') },
    { find: /^@solidjs\/router$/, replacement: realpathSync(root + 'packages/client-core/node_modules/@solidjs/router/dist/index.jsx') },
    ...readdirSync(root + 'packages/client-core/node_modules/@codemirror').filter(name => name !== 'legacy-modes').map(name => ({
      find: new RegExp('^@codemirror/' + name + '$'), replacement: realpathSync(root + 'packages/client-core/node_modules/@codemirror/' + name + '/dist/index.js'),
    })),
    { find: /^@codemirror\/legacy-modes\/(.*)$/, replacement: realpathSync(root + 'packages/client-core/node_modules/@codemirror/legacy-modes') + '/$1.js' },
    { find: /^codemirror$/, replacement: realpathSync(root + 'packages/client-core/node_modules/codemirror/dist/index.js') },
  ] },
  test: { environment: 'jsdom', include: ['plans/performance/unit19-*-probe.test.tsx'], setupFiles: [root + 'vitest.browser.setup.ts'],
    maxWorkers: 1, server: { deps: { inline: true } }, testTimeout: 30_000 },
})
