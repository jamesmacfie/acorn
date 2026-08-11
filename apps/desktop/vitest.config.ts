import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'

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
          // Several of these boot the WHOLE client graph with `await import('.../activate')`, and
          // what that measures inside the assertion is vite-node transforming a few hundred modules
          // — a dev-tooling cost, not the app's. Under `pnpm test` the repo runs two dozen packages'
          // suites at once, and the default 5s left this sitting on a cliff: adding any module
          // anywhere in client-core would tip it, and the failure read as "your change broke the
          // client graph" rather than "the machine was busy". A real budget instead.
          testTimeout: 30_000,
        },
      },
    ],
  },
})
