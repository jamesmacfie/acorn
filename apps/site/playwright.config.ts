import { defineConfig } from '@playwright/test'

// Tests the site the last `astro build` wrote to dist/.
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  // Playwright's default is half the cores, which is two on CI's four-core runner. Most of these tests
  // only load a page and wait on the browser.
  workers: process.env.CI ? 4 : undefined,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4329',
    // The installed Chrome, so nobody has to download a browser to run these.
    channel: 'chrome',
  },
  webServer: {
    // `--ignore-lock` keeps the server in the foreground. Astro otherwise moves it to the background
    // when it detects a coding agent, and Playwright reads the early exit as a crash.
    command: 'astro preview --ignore-lock --host 127.0.0.1 --port 4329',
    url: 'http://127.0.0.1:4329/',
  },
})
