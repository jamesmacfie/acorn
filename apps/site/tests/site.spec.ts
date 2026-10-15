import { readdirSync, readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const dist = new URL('../dist/', import.meta.url)
const docsDir = new URL('../src/content/docs/', import.meta.url)
const previewBuild = process.env.ACORN_SITE_PREVIEW === '1'

const filesUnder = (dir: URL) => readdirSync(dir, { recursive: true, encoding: 'utf8' })

// Every page the build wrote, as the route that serves it.
const routes = filesUnder(dist)
  .filter((file) => file.endsWith('index.html'))
  .map((file) => `/${file.replace(/index\.html$/, '')}`)

for (const route of routes) {
  test(`${route} loads without errors`, async ({ page }) => {
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    const response = await page.goto(route)
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1').first()).toBeVisible()
    expect(errors).toEqual([])
  })
}

test('drafts and the lab build only for preview deploys', () => {
  const drafts = filesUnder(docsDir)
    .filter((file) => /\.mdx?$/.test(file) && /^draft: true$/m.test(readFileSync(new URL(file, docsDir), 'utf8')))
    .map((file) => `/${file.replace(/(index)?\.mdx?$/, '')}`.replace(/([^/])$/, '$1/'))
  const built = new Set(routes)
  for (const route of [...drafts, '/lab/']) expect(built.has(route), route).toBe(previewBuild)
})

test('an unknown address offers the docs home and the search box', async ({ page }) => {
  const response = await page.goto('/no-such-page/')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('link', { name: 'docs home' })).toHaveAttribute('href', '/docs/')
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible()
})

// One page of each template: a marketing page, a docs page, and Starlight's splash page.
for (const route of ['/', '/docs/', '/no-such-page/']) {
  test(`${route} has no serious accessibility violations`, async ({ page }) => {
    await page.goto(route)
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
  })
}
