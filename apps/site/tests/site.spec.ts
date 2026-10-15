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

const featureRoutes = routes.filter((route) => route.startsWith('/features/'))

// Every claim on the landing page and the feature pages links to the docs page that owns it, so a
// renamed page fails here.
// shortcut: preview builds only, because most of those docs pages are drafts until their phases publish
// them; run it on both builds once they're published (docs/future/marketing/08-landing.md).
for (const route of ['/', '/download/', ...featureRoutes]) {
  test(`every link on ${route} goes to a page the build wrote`, async ({ page }) => {
    test.skip(!previewBuild, 'The docs pages these pages link to are drafts, which only a preview build has.')
    await page.goto(route)
    const hrefs = await page
      .locator('main a[href^="/"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')!))
    const built = new Set(routes)
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of new Set(hrefs)) expect(built.has(href), href).toBe(true)
  })
}

// Every plugin on /plugins/ links to its docs page, and those are all published, so this runs on both builds.
test('every link on /plugins/ goes to a page the build wrote', async ({ page }) => {
  await page.goto('/plugins/')
  const hrefs = await page
    .locator('main a[href^="/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')!))
  const built = new Set(routes)
  expect(hrefs.length).toBeGreaterThan(0)
  for (const href of new Set(hrefs)) expect(built.has(href.replace(/#.*$/, '')), href).toBe(true)
})

test('an unknown address offers the docs home and the search box', async ({ page }) => {
  const response = await page.goto('/no-such-page/')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('link', { name: 'docs home' })).toHaveAttribute('href', '/docs/')
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible()
})

// The download page with the fixture releases in apps/site/src/lib/releaseFixtures.ts, because GitHub has none.
test('with no release, the download page says so and puts Build from source first', async ({ page }) => {
  test.skip(!previewBuild, 'The fixture releases are lab pages, which only a preview build has.')
  await page.goto('/lab/download/none/')
  await expect(page.locator('main > .callout').first()).toContainText('acorn has no signed release.')
  await expect(page.locator('main h2').first()).toHaveText('Build from source')
  await expect(page.locator('main a[href*="/releases/download/"]')).toHaveCount(0)
})

test('with a release for every platform, the download page links every file', async ({ page }) => {
  test.skip(!previewBuild, 'The fixture releases are lab pages, which only a preview build has.')
  await page.goto('/lab/download/every-platform/')
  const files = {
    'macOS, Apple silicon': 'acorn_1.0.0_aarch64.dmg',
    'macOS, Intel': 'acorn_1.0.0_x64.dmg',
    'Windows installer': 'acorn_1.0.0_x64-setup.exe',
    'Standalone Node': 'acorn-node-1.0.0.tar.gz',
    Checksums: 'SHA256SUMS',
  }
  for (const [name, file] of Object.entries(files)) {
    await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute('href', new RegExp(`/${file}$`))
  }
  await expect(page.getByText('acorn has no signed release.')).toHaveCount(0)
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
})

test("the download page puts the visitor's platform first", async ({ page }) => {
  test.skip(!previewBuild, 'The fixture releases are lab pages, which only a preview build has.')
  const headings = page.locator('main h2')
  await page.goto('/lab/download/every-platform/')
  const defaultOrder = await headings.allTextContents()
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => ({ platform: 'Linux' }) }),
  )
  await page.goto('/lab/download/every-platform/')
  expect(await headings.allTextContents()).toEqual([
    'Terminal client and command line',
    'Standalone Node',
    'Build from source',
    'Desktop app',
    'Browser extension',
  ])
  expect(defaultOrder).not.toEqual(await headings.allTextContents())
})

test('the changelog feed has an item for every entry on the page', async ({ page, request }) => {
  const feed = await (await request.get('/changelog/rss.xml')).text()
  await page.goto('/changelog/')
  const anchors = await page.locator('article[id]').evaluateAll((entries) => entries.map((entry) => entry.id))
  expect(anchors.length).toBeGreaterThan(0)
  expect([...feed.matchAll(/<guid[^>]*>[^<]*#([^<]+)<\/guid>/g)].map((match) => match[1])).toEqual(anchors)
})

// The star count shows from 100 stars (docs/future/marketing/README.md, owner decision 4).
test('the star button hides the count at 99 stars', async ({ page }) => {
  test.skip(!previewBuild, 'The design gallery is a lab page, which only a preview build has.')
  await page.goto('/lab/design/')
  await expect(page.getByTestId('stars').getByRole('link').nth(0)).toHaveAccessibleName('Star on GitHub')
})

test('the star button shows the count from 100 stars', async ({ page }) => {
  test.skip(!previewBuild, 'The design gallery is a lab page, which only a preview build has.')
  await page.goto('/lab/design/')
  const links = page.getByTestId('stars').getByRole('link')
  await expect(links.nth(1)).toHaveAccessibleName('Star on GitHub 100 stars')
  await expect(links.nth(2)).toHaveAccessibleName('Star on GitHub 1.2k stars')
})

// One page of each template, a marketing page, a docs page, and Starlight's splash page, and every
// feature page, because each draws its own pictures. The plugins page and a plugin's page, for the
// cards and the facts box.
const axeRoutes = [
  '/',
  '/docs/',
  '/no-such-page/',
  '/download/',
  '/changelog/',
  '/plugins/',
  '/docs/built-in-plugins/database/',
]
for (const route of [...axeRoutes, ...featureRoutes]) {
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
// Shell snapshots are the same: the window inside each frame is the app's.
for (const route of ['/lab/specimens/', '/lab/snapshots/']) {
  test(`the frames on ${route} have no serious accessibility violations`, async ({ page }) => {
    test.skip(!previewBuild, 'The galleries are lab pages, which only a preview build has.')
    await page.goto(route)
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('.acorn-ui').analyze()
    expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
  })
}

// The design gallery's own components, around the specimens. Inside a specimen is the kit's markup, as
// above, but the site's own badges and keys also carry `.acorn-ui`, so only the specimens are left out.
for (const route of ['/lab/design/', '/lab/design/docs/', '/lab/design/landing/']) {
  test(`${route} has no serious accessibility violations`, async ({ page }) => {
    test.skip(!previewBuild, 'The design gallery is a lab page, which only a preview build has.')
    await page.goto(route)
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .exclude('.specimen .acorn-ui')
      .analyze()
    expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
  })
}

for (const route of ['/', '/docs/']) {
  test(`picking a theme and style pack on ${route} restyles the page without a reload`, async ({ page }) => {
    await page.goto(route)
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const before = await background()
    await page.getByRole('button', { name: 'Appearance' }).click()
    await page.getByRole('combobox', { name: 'Theme' }).selectOption('dracula')
    await page.getByRole('combobox', { name: 'Style' }).selectOption('cozy')
    expect(await background()).not.toBe(before)
    await expect(page.locator('html')).toHaveAttribute('data-style', 'cozy')
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark')
  })
}

// A saved choice is on <html> by the first frame, so a reload never draws another theme first.
test('a saved theme and style pack apply before the first frame', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('acorn-theme', 'nord')
    localStorage.setItem('acorn-style', 'modern')
    requestAnimationFrame(() => {
      const { theme, style } = document.documentElement.dataset
      Object.assign(window, { firstFrame: { theme, style } })
    })
  })
  await page.goto('/docs/')
  expect(await page.evaluate(() => (window as unknown as { firstFrame: object }).firstFrame)).toEqual({
    theme: 'nord',
    style: 'modern',
  })
})
