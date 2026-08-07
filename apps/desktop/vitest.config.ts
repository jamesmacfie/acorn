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
        },
      },
    ],
  },
})
