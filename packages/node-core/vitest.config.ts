import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Real git is invoked by worktree/status tests; a developer's ~/.gitconfig must not leak in.
    env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    // Dozens of these tests spawn a real subprocess, open a real TLS listener, or run real git, and
    // one worker per core runs them at once. The 5-second default left no margin: on a machine
    // already running acorn the process-spawning tests timed out while passing in isolation, which
    // is the kind of red that teaches people to re-run instead of read.
    testTimeout: 20_000,
    // Hooks get the same budget. hookTimeout defaults to 10s independently of testTimeout, and the
    // heavy setup (minting a certificate, building a bundle, seeding a git repo) lives in beforeAll.
    hookTimeout: 20_000,
  },
})
