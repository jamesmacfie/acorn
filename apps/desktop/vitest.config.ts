import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'

// TWO projects, not one config with a plugin bolted on.
//
// The `main` project is the config this file used to be, unchanged: Electron main adapters and the client
// conformance suites are plain TS — pure logic + jose's WebCrypto — and they run in the default Node
// environment with no Vite plugins and no setup file. Seven suites depend on that, and adding a JSX
// transform plus three injected globals to all of them to serve one new test would be the wrong trade.
//
// The `client` project exists for the one thing the other cannot do: importing the real client plugin
// list. Those entrypoints reach `.tsx` components, so they need `vite-plugin-solid` — already a
// devDependency here for the renderer build — and Solid's `delegateEvents` runs at module scope and
// wants a `window.document`. That is a THREE-GLOBAL stub (test/client/setup.ts), not a DOM environment:
// nothing here renders a component, and phase3-notes.md's claim that this needed a jsdom decision was
// measured wrong.
//
// Temp-git-repo tests must not inherit the user's global git config (hooks, fsmonitor, templates) — it
// makes them slow and flaky under parallel workers.
const gitEnv = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/**/*.test.ts', 'test/integration/**/*.test.ts'],
          env: gitEnv,
        },
      },
      {
        plugins: [solid()],
        test: {
          name: 'client',
          environment: 'node',
          include: ['test/client/**/*.test.ts'],
          setupFiles: ['./test/client/setup.ts'],
          env: gitEnv,
        },
      },
    ],
  },
})
