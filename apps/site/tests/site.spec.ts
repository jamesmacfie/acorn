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

// The specimen stylesheet applies only inside `.acorn-ui`, so a page with specimens draws the site's
// own header, sidebar, and text exactly as a page without them does.
test('specimens leave the site around them unchanged', async ({ page }) => {
  test.skip(!previewBuild, 'The specimen gallery is a lab page, which only a preview build has.')
  const PROPERTIES = ['font-family', 'font-size', 'line-height', 'color', 'background-color', 'margin', 'padding']
  const styles = async (route: string) => {
    await page.goto(route)
    return page.evaluate((properties) => {
      const read = (selector: string) => {
        const style = getComputedStyle(document.querySelector(selector)!)
        return properties.map((property) => style.getPropertyValue(property))
      }
      return {
        header: read('header.header'),
        sidebar: read('#starlight__sidebar'),
        text: read('.sl-markdown-content p'),
      }
    }, PROPERTIES)
  }
  const gallery = await styles('/lab/specimens/')
  expect(await page.locator('.acorn-ui').count()).toBeGreaterThan(0)
  expect(gallery).toEqual(await styles('/docs/'))
})

// The frame around each specimen, not the specimen: what's inside `.acorn-ui` is the app's own markup,
// drawn exactly as the app draws it, so a finding there belongs to the kit.
test('the specimen frames have no serious accessibility violations', async ({ page }) => {
  test.skip(!previewBuild, 'The specimen gallery is a lab page, which only a preview build has.')
  await page.goto('/lab/specimens/')
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('.acorn-ui').analyze()
  expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
})
